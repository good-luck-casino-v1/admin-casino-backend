pipeline {
    agent {
        kubernetes {
            yaml '''
                apiVersion: v1
                kind: Pod
                spec:
                  containers:
                  - name: docker
                    image: docker:24-dind
                    securityContext:
                      privileged: true
                    env:
                    - name: DOCKER_TLS_CERTDIR
                      value: ""
                    resources:
                      requests:
                        memory: "512Mi"
                        cpu: "250m"
                      limits:
                        memory: "1Gi"
                        cpu: "500m"
                  - name: kubectl
                    image: alpine/k8s:1.28.3
                    command: [cat]
                    tty: true
            '''
        }
    }

    environment {
        REGISTRY_URL = 'registry.gitlab.com'
        REGISTRY_PATH = 'jssrinfotech/admin-casino-backend'
        IMAGE_NAME = 'admin-backend'
        K8S_NAMESPACE = 'luck-casino-prod'
        K8S_DEPLOYMENT = 'admin-casino-backend'
        CONTAINER_NAME = 'admin-backend'
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {
        stage('Checkout') {
            steps {
                script {
                    checkout scm
                    echo "✅ Code checked out"
                }
            }
        }

        stage('Initialize') {
            steps {
                script {
                    env.GIT_COMMIT_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    env.BUILD_TAG = "prod-${new Date().format('yyyyMMdd-HHmm')}-${env.GIT_COMMIT_SHORT}"
                    env.FULL_IMAGE_NAME = "${env.REGISTRY_URL}/${env.REGISTRY_PATH}/${env.IMAGE_NAME}"
                    echo """
                    ================================
                    🚀 Backend Deployment Pipeline
                    ================================
                    Deployment: ${env.K8S_DEPLOYMENT}
                    Namespace: ${env.K8S_NAMESPACE}
                    Container: ${env.CONTAINER_NAME}
                    
                    📦 Image Details:
                    • Versioned: ${env.FULL_IMAGE_NAME}:${env.BUILD_TAG}
                    • Latest: ${env.FULL_IMAGE_NAME}:latest
                    
                    📝 Git Commit: ${env.GIT_COMMIT_SHORT}
                    🏗️  Build Number: ${BUILD_NUMBER}
                    ================================
                    """
                }
            }
        }

        stage('Build & Push Image') {
            steps {
                container('docker') {
                    withCredentials([usernamePassword(
                        credentialsId: 'gitlab-jssr-infotech',
                        usernameVariable: 'REGISTRY_USER',
                        passwordVariable: 'REGISTRY_PASS'
                    )]) {
                        sh '''
                            echo "⏳ Waiting for Docker daemon..."
                            timeout 60 sh -c 'until docker info > /dev/null 2>&1; do sleep 2; done'
                            echo "✅ Docker daemon ready"
                            
                            echo "🔐 Logging into GitLab registry..."
                            echo "$REGISTRY_PASS" | docker login $REGISTRY_URL -u "$REGISTRY_USER" --password-stdin
                            
                            echo "🏗️  Building Docker images..."
                            docker build -t ${FULL_IMAGE_NAME}:${BUILD_TAG} -t ${FULL_IMAGE_NAME}:latest .
                            
                            echo "📤 Pushing versioned tag..."
                            docker push ${FULL_IMAGE_NAME}:${BUILD_TAG}
                            
                            echo "📤 Pushing latest tag..."
                            docker push ${FULL_IMAGE_NAME}:latest
                            
                            echo "✅ Images pushed successfully!"
                        '''
                    }
                }
            }
        }

        stage('Deploy to K8s') {
            steps {
                container('kubectl') {
                    withCredentials([file(credentialsId: 'kubeconfig-prod', variable: 'KUBECONFIG')]) {
                        sh '''
                            echo "🔧 Configuring kubectl..."
                            chmod 600 $KUBECONFIG
                            
                            echo "🚀 Updating deployment..."
                            kubectl set image deployment/${K8S_DEPLOYMENT} \
                                ${CONTAINER_NAME}=${FULL_IMAGE_NAME}:${BUILD_TAG} \
                                -n ${K8S_NAMESPACE}
                            
                            echo "⏳ Waiting for rollout to complete..."
                            kubectl rollout status deployment/${K8S_DEPLOYMENT} \
                                -n ${K8S_NAMESPACE} \
                                --timeout=5m
                            
                            echo "✅ Deployment successful!"
                            
                            echo ""
                            echo "📊 Current deployment status:"
                            kubectl get deployment ${K8S_DEPLOYMENT} -n ${K8S_NAMESPACE}
                            
                            echo ""
                            echo "🔍 Running pods:"
                            kubectl get pods -n ${K8S_NAMESPACE} -l app=admin-casino-backend
                        '''
                    }
                }
            }
        }
    }

    post {
        always {
            script {
                try {
                    container('docker') {
                        sh 'docker image prune -f || true'
                    }
                } catch (Exception e) {
                    echo "Cleanup skipped: ${e.getMessage()}"
                }
            }
        }
        success {
            echo """
            ========================================
            ✅ BACKEND DEPLOYMENT SUCCESSFUL!
            ========================================
            Build Number: ${BUILD_NUMBER}
            Git Commit: ${env.GIT_COMMIT_SHORT}
            
            🏷️  Images:
            • ${env.FULL_IMAGE_NAME}:${env.BUILD_TAG}
            • ${env.FULL_IMAGE_NAME}:latest
            
            🎯 Deployed to: ${env.K8S_NAMESPACE}
            📦 Deployment: ${env.K8S_DEPLOYMENT}
            
            🌐 API URL: https://admin.api.goodluck24bet.com
            ========================================
            """
        }
        failure {
            echo """
            ========================================
            ❌ BACKEND DEPLOYMENT FAILED!
            ========================================
            Build Number: ${BUILD_NUMBER}
            Git Commit: ${env.GIT_COMMIT_SHORT ?: 'Unknown'}
            
            Check the console output above for details.
            ========================================
            """
        }
    }
}
