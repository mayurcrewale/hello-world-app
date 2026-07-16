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
    // TEMP for first test run: runs on whatever executor is available.
    // Swap back to `agent { label 'nodejs-docker' }` once you have a
    // dedicated agent with git, Node.js 20, npm, docker CLI, awscli v2.
    agent any

    // Requires a NodeJS installation named exactly "NodeJS-20" configured
    // under Manage Jenkins -> Tools. Puts node/npm on PATH for every stage.
    // Doesn't help with `docker` — that still needs installing separately.
    tools {
        nodejs 'NodeJS-20'
    }

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
                    // package.json's version is the single source of truth
                    // for the release version — bump it yourself
                    // (`npm version patch/minor/major`) before a
                    // release-worthy push. Not derived from git-sha/build
                    // number anymore.
                    env.APP_VERSION = sh(script: "node -p \"require('./package.json').version\"", returnStdout: true).trim()
                    env.IMAGE_TAG = "v${env.APP_VERSION}"
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

        stage('Check version not already released') {
            steps {
                script {
                    def alreadyPushed = sh(
                        script: """
                            aws ecr describe-images --region ${env.AWS_DEFAULT_REGION} \
                                --repository-name ${env.ECR_REPOSITORY_URL.split('/')[1]} \
                                --image-ids imageTag=${env.IMAGE_TAG} >/dev/null 2>&1
                        """,
                        returnStatus: true
                    ) == 0
                    if (alreadyPushed) {
                        error("${env.IMAGE_TAG} has already been pushed to ECR — bump the version in package.json (e.g. `npm version patch`) before pushing again.")
                    }
                }
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
