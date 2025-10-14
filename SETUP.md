# Gmail Agent Registration System - Setup Guide

Complete step-by-step setup instructions for deploying the Gmail Agent Registration System.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Google Cloud Project Setup](#google-cloud-project-setup)
3. [OAuth 2.0 Configuration](#oauth-20-configuration)
4. [Environment Configuration](#environment-configuration)
5. [Deployment](#deployment)
6. [n8n Configuration](#n8n-configuration)
7. [Testing](#testing)
8. [Production Checklist](#production-checklist)

---

## Prerequisites

### Required Tools

- Google Cloud account with billing enabled
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed
- [Node.js 18+](https://nodejs.org/) installed
- n8n instance (cloud or self-hosted)
- Git (for version control)

### Required Knowledge

- Basic understanding of OAuth 2.0
- Familiarity with Google Cloud Platform
- Basic command line usage

---

## Google Cloud Project Setup

### 1. Create a New Project

```bash
# Set your desired project ID
export PROJECT_ID="gmail-agent-registration-prod"

# Create the project
gcloud projects create $PROJECT_ID --name="Gmail Agent Registration"

# Set as active project
gcloud config set project $PROJECT_ID

# Link billing account (replace BILLING_ACCOUNT_ID)
gcloud beta billing projects link $PROJECT_ID --billing-account=BILLING_ACCOUNT_ID
```

### 2. Enable Required APIs

```bash
gcloud services enable \
  gmail.googleapis.com \
  run.googleapis.com \
  firestore.googleapis.com \
  pubsub.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com
```

### 3. Initialize Firestore

```bash
# Create Firestore database in Native mode
gcloud firestore databases create --region=us-central1

# Create indexes (if needed)
# gcloud firestore indexes composite create --collection-group=clients \
#   --field-config field-path=watchData.expiration,order=ASCENDING
```

---

## OAuth 2.0 Configuration

### 1. Configure OAuth Consent Screen

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Navigate to **APIs & Services > OAuth consent screen**
4. Choose **External** (or Internal for Google Workspace)
5. Fill in application information:
   - **App name**: Gmail Agent Registration
   - **User support email**: your-email@example.com
   - **Developer contact**: your-email@example.com
6. Click **Save and Continue**

### 2. Add Scopes

1. Click **Add or Remove Scopes**
2. Add these Gmail API scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
3. Click **Update** and **Save and Continue**

### 3. Add Test Users (for development)

1. In the OAuth consent screen, scroll to **Test users**
2. Add email addresses that will test the application
3. Click **Save and Continue**

### 4. Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth 2.0 Client ID**
3. Select **Web application**
4. Configure:
   - **Name**: Gmail Agent Web Client
   - **Authorized JavaScript origins**: Leave empty for now
   - **Authorized redirect URIs**:
     - For local: `http://localhost:8080/auth/callback`
     - For production: `https://your-app.run.app/auth/callback` (add after deployment)
5. Click **Create**
6. **Save the Client ID and Client Secret** - you'll need these!

---

## Environment Configuration

### 1. Clone Repository

```bash
git clone <your-repo-url>
cd gmail-agent-registration
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Environment File

```bash
cp .env.example .env
```

### 4. Configure .env File

Edit `.env` with your values:

```env
# Server Configuration
PORT=8080
NODE_ENV=production

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=https://your-app.run.app/auth/callback

# Google Cloud Project
FIRESTORE_PROJECT_ID=gmail-agent-registration-prod

# Pub/Sub Configuration
PUBSUB_TOPIC_PREFIX=gmail-watch-

# n8n Webhook URLs
N8N_WEBHOOK_URL=https://your-n8n.com/webhook/gmail-registrations
N8N_RENEWAL_WEBHOOK_URL=https://your-n8n.com/webhook/gmail-watch-renewal

# Security - GENERATE RANDOM STRINGS!
SESSION_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)

# CORS (Optional)
ALLOWED_ORIGINS=https://yourdomain.com
```

### 5. Generate Secure Keys

```bash
# Generate SESSION_SECRET
openssl rand -base64 32

# Generate ENCRYPTION_KEY
openssl rand -base64 32
```

Copy these values into your `.env` file.

---

## Deployment

### Option 1: Automated Deployment (Recommended)

```bash
# Make deploy script executable
chmod +x deploy.sh

# Run deployment
PROJECT_ID=gmail-agent-registration-prod ./deploy.sh
```

### Option 2: Manual Deployment

#### Deploy Cloud Run Service

```bash
gcloud run deploy gmail-agent-registration \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars-from-file .env \
  --platform managed \
  --memory 512Mi
```

#### Deploy Cloud Function

```bash
cd functions

gcloud functions deploy renewGmailWatches \
  --runtime nodejs18 \
  --trigger-topic watch-renewal-trigger \
  --region us-central1 \
  --entry-point renewGmailWatches \
  --set-env-vars FIRESTORE_PROJECT_ID=$PROJECT_ID,...
```

#### Set Up Cloud Scheduler

```bash
# Create Pub/Sub topic
gcloud pubsub topics create watch-renewal-trigger

# Create App Engine app (required for scheduler)
gcloud app create --region=us-central1

# Create scheduler job
gcloud scheduler jobs create pubsub watch-renewal-job \
  --schedule="0 0 * * *" \
  --topic=watch-renewal-trigger \
  --message-body='{"action":"renew"}' \
  --location=us-central1
```

### 3. Update OAuth Redirect URI

After deployment, get your service URL:

```bash
gcloud run services describe gmail-agent-registration \
  --region us-central1 \
  --format="value(status.url)"
```

Update OAuth credentials:
1. Go to **APIs & Services > Credentials**
2. Click on your OAuth 2.0 Client ID
3. Add to **Authorized redirect URIs**: `https://your-service-url.run.app/auth/callback`
4. Click **Save**

---

## n8n Configuration

### 1. Create Registration Webhook Workflow

1. In n8n, create a new workflow
2. Add a **Webhook** node:
   - Method: POST
   - Path: `gmail-registrations`
   - Response Mode: Last Node
3. Add processing nodes (e.g., store in database, send notification)
4. Activate the workflow
5. Copy the webhook URL to `N8N_WEBHOOK_URL` in `.env`

### 2. Create Renewal Webhook Workflow

1. Create another workflow
2. Add a **Webhook** node:
   - Method: POST
   - Path: `gmail-watch-renewal`
3. Add logging/notification nodes
4. Activate the workflow
5. Copy the webhook URL to `N8N_RENEWAL_WEBHOOK_URL` in `.env`

### 3. Redeploy with Updated Webhooks

```bash
gcloud run services update gmail-agent-registration \
  --region us-central1 \
  --set-env-vars-from-file .env
```

---

## Testing

### 1. Test Health Endpoint

```bash
curl https://your-service-url.run.app/health
```

### 2. Test Registration Flow

1. Visit `https://your-service-url.run.app`
2. Fill in the registration form
3. Click "Connect Gmail Account"
4. Complete Google OAuth consent
5. Verify redirect to success page

### 3. Test Webhooks

```bash
# Test registration webhook
curl -X POST https://your-service-url.run.app/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"webhookType": "registration"}'

# Test renewal webhook
curl -X POST https://your-service-url.run.app/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"webhookType": "renewal"}'
```

### 4. Test Watch Renewal

```bash
# Manually trigger
gcloud scheduler jobs run watch-renewal-job --location=us-central1
```

### 5. Check Firestore

1. Go to Firestore console
2. Verify `clients` collection has your test registration
3. Check that tokens are encrypted (not readable)

---

## Production Checklist

### Security

- [ ] OAuth consent screen published (not in testing mode)
- [ ] SESSION_SECRET is a random 32+ character string
- [ ] ENCRYPTION_KEY is a random 32+ character string
- [ ] `.env` file is in `.gitignore`
- [ ] HTTPS enforced on all endpoints
- [ ] CORS properly configured
- [ ] Rate limiting enabled

### Infrastructure

- [ ] Cloud Run service deployed successfully
- [ ] Cloud Function deployed successfully
- [ ] Cloud Scheduler job running daily
- [ ] Firestore database created
- [ ] All required Pub/Sub topics exist
- [ ] Monitoring and logging configured

### OAuth & APIs

- [ ] All required Gmail API scopes added
- [ ] Redirect URIs match exactly
- [ ] OAuth credentials secured
- [ ] API quotas reviewed

### n8n Integration

- [ ] Registration webhook workflow active
- [ ] Renewal webhook workflow active
- [ ] Webhooks tested and receiving data
- [ ] Error handling configured

### Testing

- [ ] Complete registration flow tested
- [ ] Token refresh tested
- [ ] Watch setup tested
- [ ] Watch renewal tested
- [ ] Webhook delivery confirmed
- [ ] Error scenarios tested

### Monitoring

- [ ] Cloud Run logs accessible
- [ ] Cloud Functions logs accessible
- [ ] Uptime monitoring configured
- [ ] Alert policies created
- [ ] Cost monitoring enabled

---

## Troubleshooting

### Common Issues

**OAuth Error: redirect_uri_mismatch**
- Ensure redirect URI in OAuth config exactly matches your Cloud Run URL
- Check for http vs https
- Verify no trailing slashes

**Webhook Not Receiving Data**
- Verify n8n workflow is activated
- Check webhook URL is publicly accessible
- Review Cloud Run logs for errors

**Watch Renewal Failing**
- Check tokens haven't been revoked
- Verify Cloud Scheduler job is enabled
- Review Cloud Function logs

### Getting Help

- Check Cloud Run logs: `gcloud run services logs read gmail-agent-registration`
- Check Function logs: `gcloud functions logs read renewGmailWatches`
- Review Firestore for data consistency
- Test individual endpoints with curl

---

## Next Steps

1. Set up monitoring dashboards
2. Configure backup strategies
3. Implement additional security measures
4. Scale resources based on usage
5. Add custom domain (optional)

---

For more information, see [README.md](./README.md) and [CLAUDE.md](./CLAUDE.md).
