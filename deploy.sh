#!/bin/bash

# Gmail Agent Registration System - Deployment Script
# This script automates the deployment of the entire system to Google Cloud Platform

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${PROJECT_ID:-""}
REGION=${REGION:-"us-central1"}
SERVICE_NAME="gmail-agent-registration"
FUNCTION_NAME="renewGmailWatches"

echo -e "${GREEN}=== Gmail Agent Registration System - Deployment Script ===${NC}\n"

# Check if PROJECT_ID is set
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}ERROR: PROJECT_ID environment variable is not set${NC}"
    echo "Usage: PROJECT_ID=your-project-id ./deploy.sh"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}ERROR: .env file not found${NC}"
    echo "Please copy .env.example to .env and configure it with your settings"
    exit 1
fi

echo -e "${YELLOW}Using Project ID: ${PROJECT_ID}${NC}"
echo -e "${YELLOW}Using Region: ${REGION}${NC}\n"

# Set gcloud project
echo -e "${GREEN}[1/7] Setting gcloud project...${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "\n${GREEN}[2/7] Enabling required Google Cloud APIs...${NC}"
gcloud services enable \
    gmail.googleapis.com \
    run.googleapis.com \
    firestore.googleapis.com \
    pubsub.googleapis.com \
    cloudscheduler.googleapis.com \
    cloudfunctions.googleapis.com \
    cloudbuild.googleapis.com

echo -e "${GREEN}APIs enabled successfully${NC}"

# Create Firestore database if it doesn't exist
echo -e "\n${GREEN}[3/7] Checking Firestore database...${NC}"
if ! gcloud firestore databases describe --format="value(name)" 2>/dev/null; then
    echo "Creating Firestore database in Native mode..."
    gcloud firestore databases create --region=$REGION
    echo -e "${GREEN}Firestore database created${NC}"
else
    echo -e "${GREEN}Firestore database already exists${NC}"
fi

# Deploy Cloud Run service
echo -e "\n${GREEN}[4/7] Deploying Cloud Run service...${NC}"
gcloud run deploy $SERVICE_NAME \
    --source . \
    --region $REGION \
    --allow-unauthenticated \
    --set-env-vars-from-file .env \
    --platform managed \
    --memory 512Mi \
    --cpu 1 \
    --timeout 300 \
    --min-instances 0 \
    --max-instances 10

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)")
echo -e "${GREEN}Service deployed at: ${SERVICE_URL}${NC}"

# Create Pub/Sub topic for watch renewal
echo -e "\n${GREEN}[5/7] Setting up Pub/Sub topic...${NC}"
if ! gcloud pubsub topics describe watch-renewal-trigger 2>/dev/null; then
    gcloud pubsub topics create watch-renewal-trigger
    echo -e "${GREEN}Pub/Sub topic created${NC}"
else
    echo -e "${GREEN}Pub/Sub topic already exists${NC}"
fi

# Deploy Cloud Function
echo -e "\n${GREEN}[6/7] Deploying Cloud Function for watch renewal...${NC}"
cd functions
gcloud functions deploy $FUNCTION_NAME \
    --runtime nodejs18 \
    --trigger-topic watch-renewal-trigger \
    --region $REGION \
    --entry-point renewGmailWatches \
    --memory 256MB \
    --timeout 540s \
    --set-env-vars FIRESTORE_PROJECT_ID=$PROJECT_ID,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET,ENCRYPTION_KEY=$ENCRYPTION_KEY,PUBSUB_TOPIC_PREFIX=$PUBSUB_TOPIC_PREFIX,N8N_RENEWAL_WEBHOOK_URL=$N8N_RENEWAL_WEBHOOK_URL
cd ..
echo -e "${GREEN}Cloud Function deployed${NC}"

# Set up Cloud Scheduler
echo -e "\n${GREEN}[7/7] Setting up Cloud Scheduler...${NC}"

# Check if App Engine app exists (required for Cloud Scheduler)
if ! gcloud app describe 2>/dev/null; then
    echo "Creating App Engine app (required for Cloud Scheduler)..."
    gcloud app create --region=$REGION || true
fi

# Create or update scheduler job
if gcloud scheduler jobs describe watch-renewal-job --location=$REGION 2>/dev/null; then
    echo "Updating existing Cloud Scheduler job..."
    gcloud scheduler jobs update pubsub watch-renewal-job \
        --location=$REGION \
        --schedule="0 0 * * *" \
        --topic=watch-renewal-trigger \
        --message-body='{"action":"renew"}'
else
    echo "Creating Cloud Scheduler job..."
    gcloud scheduler jobs create pubsub watch-renewal-job \
        --location=$REGION \
        --schedule="0 0 * * *" \
        --topic=watch-renewal-trigger \
        --message-body='{"action":"renew"}'
fi

echo -e "${GREEN}Cloud Scheduler job configured (runs daily at midnight)${NC}"

# Summary
echo -e "\n${GREEN}=== Deployment Complete! ===${NC}\n"
echo -e "${YELLOW}Service URL:${NC} ${SERVICE_URL}"
echo -e "${YELLOW}Region:${NC} ${REGION}"
echo -e "${YELLOW}Project:${NC} ${PROJECT_ID}\n"

echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Update your OAuth 2.0 redirect URI to: ${SERVICE_URL}/auth/callback"
echo "2. Visit: ${SERVICE_URL} to test the registration flow"
echo "3. Configure your n8n webhooks to receive registration data"
echo "4. Monitor logs with: gcloud run services logs read $SERVICE_NAME --region $REGION"
echo ""
echo -e "${GREEN}Deployment successful!${NC}"
