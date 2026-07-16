// CI pipeline: checkout -> npm ci/test -> docker build -> push to ECR ->
// auto-trigger the CD pipeline (deploy/Jenkinsfile) against dev. Deploys to
// any higher environment (prod) stay manual — trigger deploy/Jenkinsfile's
// job directly and pick the environment there; this pipeline never does
// that itself.
//
// AWS auth: assumes the agent already has AWS credentials in its ambient
// environment (EC2 instance profile / ECS task role / IRSA) with push
// permission (ecr:GetAuthorizationToken, ecr:BatchCheckLayerAvailability,
// ecr:InitiateLayerUpload, ecr:UploadLayerPart, ecr:CompleteLayerUpload,
// ecr:PutImage) on the ECR repo created by eks-poc/bootstrap. If you use the
// Jenkins Credentials plugin instead, wrap the docker-push stage in
// `withCredentials(...)` / `withAWS(credentials: '...')`.
//
// Assumes this job is a multibranch pipeline (the `when { branch 'main' }`
// guard on the dev-deploy trigger needs BRANCH_NAME to exist) — otherwise
// every build of every branch would auto-deploy to dev.

pipeline {
    // TODO: replace 'nodejs-docker' with your actual Jenkins agent label.
    // Needs: git, Node.js 20, npm, docker CLI (with socket access), awscli v2.
    agent { label 'nodejs-docker' }

    options {
        disableConcurrentBuilds()
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    environment {
        AWS_DEFAULT_REGION = 'eu-west-1'
        // TODO: replace with the ecr_repository_url output from
        // eks-poc/bootstrap, e.g. 123456789012.dkr.ecr.eu-west-1.amazonaws.com/hello-world-app
        ECR_REPOSITORY_URL  = 'REPLACE-with-ecr_repository_url-output-from-bootstrap'
        // TODO: replace with the actual name of the Jenkins job pointed at
        // deploy/Jenkinsfile in this same repo (e.g. a second Pipeline job,
        // or "hello-world-app/deploy" if it's a folder/multibranch setup).
        CD_JOB_NAME = 'hello-world-app-cd'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_SHORT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    // Immutable ECR tags mean every push needs a unique tag,
                    // even across rebuilds of the same commit.
                    env.IMAGE_TAG = "${env.GIT_SHORT_SHA}-${env.BUILD_NUMBER}"
                }
            }
        }

        stage('Install deps') {
            steps {
                sh 'npm ci --no-audit --no-fund'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Docker build') {
            steps {
                sh "docker build -t ${env.ECR_REPOSITORY_URL}:${env.IMAGE_TAG} ."
            }
        }

        stage('Push to ECR') {
            steps {
                sh """
                    set -euo pipefail
                    aws ecr get-login-password --region ${env.AWS_DEFAULT_REGION} \
                        | docker login --username AWS --password-stdin ${env.ECR_REPOSITORY_URL.split('/')[0]}
                    docker push ${env.ECR_REPOSITORY_URL}:${env.IMAGE_TAG}
                """
            }
        }

        stage('Trigger dev deploy') {
            // Only auto-deploy builds of the trunk branch — a feature
            // branch/PR build still pushes an image (useful on its own,
            // e.g. for manual testing) but must not land on dev unasked.
            when {
                branch 'main'
            }
            steps {
                // wait: false — CI finishes as soon as it hands off, it
                // doesn't block on (or reflect the result of) the deploy.
                // The CD job's own build history is the source of truth for
                // whether the dev deploy actually succeeded. Switch to
                // wait: true + propagate: true if you'd rather this CI
                // build go red when the dev deploy fails.
                build job: env.CD_JOB_NAME, wait: false, parameters: [
                    string(name: 'ENVIRONMENT', value: 'dev'),
                    string(name: 'IMAGE_TAG', value: env.IMAGE_TAG)
                ]
            }
        }
    }

    post {
        success {
            script {
                currentBuild.description = "Pushed ${env.ECR_REPOSITORY_URL}:${env.IMAGE_TAG}"
            }
            writeFile file: 'image-tag.txt', text: "${env.IMAGE_TAG}\n"
            archiveArtifacts artifacts: 'image-tag.txt', fingerprint: true
        }
        always {
            sh 'docker rmi "$ECR_REPOSITORY_URL:$IMAGE_TAG" || true'
            cleanWs()
        }
    }
}
