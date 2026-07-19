pipeline {
    agent any

    tools {
        nodejs 'NodeJS-20'   // Manage Jenkins -> Tools -> NodeJS installations
    }

    options {
        disableConcurrentBuilds()
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    environment {
        DOCKERHUB_CREDS = credentials('docker-hub-creds')
        IMAGE_NAME      = 'mayur21486/hello-world-app'   // <-- set this
        CD_JOB_NAME     = 'hello-world-app-cd'                  // <-- match your CD job name
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.APP_VERSION = sh(script: "node -p \"require('./package.json').version\"", returnStdout: true).trim()
                    env.IMAGE_TAG = "v${env.APP_VERSION}"
                }
            }
        }
        stage('Debug workspace') {
            steps {
                sh 'pwd && ls -la && git status || echo "not a git repo"'
            }
        }
        stage('Install deps') {
            steps { sh 'npm ci --no-audit --no-fund' }
        }

        stage('Test') {
            steps { sh 'npm test' }
        }

        stage('Docker build') {
            steps { sh "docker build -t ${env.IMAGE_NAME}:${env.IMAGE_TAG} ." }
        }

        stage('Push to Docker Hub') {
            steps {
                sh """
                    set -euo pipefail
                    echo "\$DOCKERHUB_CREDS_PSW" | docker login -u "\$DOCKERHUB_CREDS_USR" --password-stdin
                    docker push ${env.IMAGE_NAME}:${env.IMAGE_TAG}
                """
            }
        }

        stage('Trigger dev deploy') {
            when { branch 'main' }
            steps {
                build job: env.CD_JOB_NAME, wait: false, parameters: [
                    string(name: 'ENVIRONMENT', value: 'dev'),
                    string(name: 'IMAGE_TAG', value: env.IMAGE_TAG)
                ]
            }
        }
    }

    post {
        success {
            script { currentBuild.description = "Pushed ${env.IMAGE_NAME}:${env.IMAGE_TAG}" }
            writeFile file: 'image-tag.txt', text: "${env.IMAGE_TAG}\n"
            archiveArtifacts artifacts: 'image-tag.txt', fingerprint: true
        }
        always {
            sh "docker rmi ${env.IMAGE_NAME}:${env.IMAGE_TAG} || true"
            sh 'docker logout || true'
            cleanWs()
        }
    }
}