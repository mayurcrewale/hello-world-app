// CI pipeline: checkout -> npm ci/test -> docker build -> push to ECR ->
// auto-trigger the CD pipeline (Deployment/Jenkinsfile) against dev. Deploys to
// any higher environment (prod) stay manual — trigger Deployment/Jenkinsfile's
// job directly and pick the environment there; this pipeline never does
// that itself.
//
// Every branch builds, tests, and pushes an image to ECR. Only the trunk
// branch (TRUNK_BRANCH below) gets: a real release tag (v<package.json
// version>), a pushed git tag, and an auto-triggered dev deploy. Every
// other branch (feature/*, PRs, ...) gets a snapshot tag
// (v<version>-snapshot.<build number>) instead — useful for testing a
// branch's image without it colliding with, or ever being mistaken for, a
// real release.
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
// Assumes this job is a multibranch pipeline (the trunk-only stages compare
// against BRANCH_NAME, which needs to exist) — otherwise every build of
// every branch would be treated as trunk.

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
        // The registry host is stable across all repos/apps in this
        // account -- only the repository name (derived from this repo's
        // own name in the Checkout stage below) varies.
        ECR_REGISTRY = '664874245394.dkr.ecr.ap-south-1.amazonaws.com'
        // TODO: replace with the actual name of the Jenkins job pointed at
        // Deployment/Jenkinsfile in this same repo (e.g. a second Pipeline job,
        // or "hello-world-app/deploy" if it's a folder/multibranch setup).
        CD_JOB_NAME = 'hello-world-app-cd'

        // Same Jenkins credential used by eks-poc's Terraform pipeline
        // (Username with password: access key ID / secret access key).
        // No session token needed -- jenkins-user has long-lived static
        // credentials, not an STS-assumed role.
        AWS_CREDS             = credentials('aws-poc-creds')
        AWS_ACCESS_KEY_ID     = "${env.AWS_CREDS_USR}"
        AWS_SECRET_ACCESS_KEY = "${env.AWS_CREDS_PSW}"

        // The one branch whose builds get a real release version, a git
        // tag, and an auto-triggered dev deploy. Every other branch
        // (feature/*, PRs, etc) still builds/tests/pushes an image -- just
        // tagged as a snapshot, and without touching git tags or dev.
        TRUNK_BRANCH = 'main'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_SHORT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()

                    // Derived from the actual SCM remote rather than
                    // hardcoded, so this Jenkinsfile works unmodified if
                    // copied into another repo -- the ECR repo name always
                    // matches the git repo name.
                    env.REPO_NAME = sh(
                        script: "basename -s .git \$(git config --get remote.origin.url)",
                        returnStdout: true
                    ).trim()
                    env.ECR_REPOSITORY_URL = "${env.ECR_REGISTRY}/${env.REPO_NAME}"
                    // package.json's version is the single source of truth
                    // for the release version — bump it yourself
                    // (`npm version patch/minor/major`) before a
                    // release-worthy push.
                    env.APP_VERSION = sh(script: "node -p \"require('./package.json').version\"", returnStdout: true).trim()

                    // Trunk builds get the real, clean release tag. Every
                    // other branch gets a snapshot tag suffixed with the
                    // build number (always unique, so it never collides or
                    // needs the "already released" guard below) -- these
                    // images are for testing a feature branch's changes,
                    // never meant to be long-lived or promoted as-is.
                    if (env.BRANCH_NAME == env.TRUNK_BRANCH) {
                        env.IMAGE_TAG = "v${env.APP_VERSION}"
                    } else {
                        env.IMAGE_TAG = "v${env.APP_VERSION}-snapshot.${env.BUILD_NUMBER}"
                    }
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
            // Only meaningful for real release tags — snapshot tags always
            // include the build number, so they can never collide.
            when {
                expression { env.BRANCH_NAME == env.TRUNK_BRANCH }
            }
            steps {
                script {
                    def alreadyInEcr = sh(
                        script: """
                            aws ecr describe-images --region ${env.AWS_DEFAULT_REGION} \
                                --repository-name ${env.REPO_NAME} \
                                --image-ids imageTag=${env.IMAGE_TAG} >/dev/null 2>&1
                        """,
                        returnStatus: true
                    ) == 0
                    if (alreadyInEcr) {
                        error("${env.IMAGE_TAG} has already been pushed to ECR — bump the version in package.json (e.g. `npm version patch`) before pushing again.")
                    }

                    // Also check the git tag independently of ECR -- they
                    // can drift apart (e.g. an ECR image removed/replaced
                    // outside this pipeline while the tag, once pushed,
                    // stays forever), and a stale git tag alone is enough
                    // to fail the "Tag release in git" stage later after
                    // already spending a full build/push on this version.
                    def tagAlreadyPushed = sh(
                        script: "git ls-remote --exit-code --tags origin refs/tags/${env.IMAGE_TAG} >/dev/null 2>&1",
                        returnStatus: true
                    ) == 0
                    if (tagAlreadyPushed) {
                        error("${env.IMAGE_TAG} already exists as a git tag — bump the version in package.json (e.g. `npm version patch`) before pushing again.")
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
                        | docker login --username AWS --password-stdin ${env.ECR_REGISTRY}
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
                expression { env.BRANCH_NAME == env.TRUNK_BRANCH }
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
            when {
                expression { env.BRANCH_NAME == env.TRUNK_BRANCH }
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
