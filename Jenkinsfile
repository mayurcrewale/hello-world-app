// CI pipeline: checkout -> npm ci/test -> docker build -> push to ECR ->
// auto-trigger the CD pipeline (deploy/Jenkinsfile) against dev. Deploys to
// any higher environment (prod) stay manual — trigger deploy/Jenkinsfile's
// job directly and pick the environment there; this pipeline never does
// that itself.
//
// AWS auth: static access key/secret bound via Jenkins Credentials (see the
// `environment` block below) -- the same "aws-poc-creds" credential used by
// eks-poc's Terraform pipeline. Needs push permission
// (ecr:GetAuthorizationToken, ecr:BatchCheckLayerAvailability,
// ecr:InitiateLayerUpload, ecr:UploadLayerPart, ecr:CompleteLayerUpload,
// ecr:PutImage) on the ECR repo created by eks-poc/bootstrap.
//
// Git auth: a separate "github-pat" credential (GitHub username / a PAT
// with `repo` scope) is used only by the "Tag release in git" stage, to
// push a release tag back to this repo.
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
        AWS_DEFAULT_REGION = 'ap-south-1'
        // TODO: replace with the ecr_repository_url output from
        // eks-poc/bootstrap, e.g. 123456789012.dkr.ecr.eu-west-1.amazonaws.com/hello-world-app
        ECR_REPOSITORY_URL  = '664874245394.dkr.ecr.ap-south-1.amazonaws.com/hello-world-app'
        // TODO: replace with the actual name of the Jenkins job pointed at
        // deploy/Jenkinsfile in this same repo (e.g. a second Pipeline job,
        // or "hello-world-app/deploy" if it's a folder/multibranch setup).
        CD_JOB_NAME = 'hello-world-app-cd'

        // Same Jenkins credential used by eks-poc's Terraform pipeline
        // (Username with password: access key ID / secret access key).
        // No session token needed -- jenkins-user has long-lived static
        // credentials, not an STS-assumed role.
        AWS_CREDS             = credentials('aws-poc-creds')
        AWS_ACCESS_KEY_ID     = "${env.AWS_CREDS_USR}"
        AWS_SECRET_ACCESS_KEY = "${env.AWS_CREDS_PSW}"
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

        stage('Tag release in git') {
            // Only tag builds that actually get deployed — same guard as
            // the deploy trigger below, so feature-branch/test builds don't
            // litter the repo with tags. Immutable link between "what's
            // running" (the ECR image tag) and the exact source it was
            // built from, independent of package.json possibly changing
            // later or main moving on — useful for rollback: `git checkout
            // <tag>` always gets you back to that exact release's source.
            //
            // Requires a "github-pat" Jenkins credential (Username with
            // password: GitHub username / a Personal Access Token with
            // `repo` scope) with push access to this repo.
            when {
                branch 'dev-deploy' // TEMP: matches the trigger guard below
            }
            steps {
                withCredentials([usernamePassword(credentialsId: 'github-pat', usernameVariable: 'GIT_USER', passwordVariable: 'GIT_TOKEN')]) {
                    sh """
                        set -euo pipefail
                        git tag ${env.IMAGE_TAG}
                        git push "https://\${GIT_USER}:\${GIT_TOKEN}@github.com/mayurcrewale/hello-world-app.git" ${env.IMAGE_TAG}
                    """
                }
            }
        }

        stage('Trigger dev deploy') {
            // TEMP: 'dev-deploy' instead of 'main' while testing the
            // pipeline on this branch — switch back to 'main' before this
            // becomes the trunk-triggered auto-deploy for real.
            when {
                branch 'dev-deploy'
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
