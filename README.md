# Gmail Agent Registration System

A complete Gmail OAuth registration system built on Google Cloud Platform. This system allows clients to authorize Gmail access through a web interface, stores credentials securely in Firestore, sends registration data to n8n via webhooks, and automatically maintains Gmail watch subscriptions.

## Features

- Web-based Gmail OAuth 2.0 registration flow
- Secure token encryption and storage in Firestore
- Automatic Gmail watch setup with Pub/Sub notifications
- n8n webhook integration for workflow automation
- Automated watch renewal via Cloud Functions and Cloud Scheduler
- Health monitoring and status endpoints
- Secure session management and CSRF protection

## Architecture

- **Frontend**: HTML/CSS registration pages
- **Backend**: Node.js/Express API server
- **Database**: Google Cloud Firestore
- **Messaging**: Google Cloud Pub/Sub
- **Automation**: Cloud Functions + Cloud Scheduler
- **Deployment**: Google Cloud Run (containerized)

## Prerequisites

1. Google Cloud Project with billing enabled
2. Node.js 18+ installed locally for development
3. gcloud CLI installed and authenticated
4. n8n instance (for webhook integration)

## Quick Start

### 1. Clone and Install

```bash
cd gmail-agent-registration
npm install
```

### 2. Set Up Google Cloud Project

```bash
# Set your project ID
export PROJECT_ID=your-project-id
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  gmail.googleapis.com \
  run.googleapis.com \
  firestore.googleapis.com \
  pubsub.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudfunctions.googleapis.com

# Initialize Firestore in Native mode
gcloud firestore databases create --region=us-central1
```

### 3. Configure OAuth 2.0

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services > Credentials**
3. Click **Create Credentials > OAuth 2.0 Client ID**
4. Configure OAuth consent screen:
   - Add Gmail API scopes (gmail.readonly, gmail.send, gmail.compose, gmail.modify)
   - Add test users (for development)
5. Create OAuth Client:
   - Application type: Web application
   - Authorized redirect URIs: `https://your-app.run.app/auth/callback`
6. Save Client ID and Client Secret

### 4. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your actual values
nano .env
```

Required environment variables:
- `GOOGLE_CLIENT_ID`: OAuth 2.0 Client ID
- `GOOGLE_CLIENT_SECRET`: OAuth 2.0 Client Secret
- `GOOGLE_REDIRECT_URI`: Your callback URL
- `FIRESTORE_PROJECT_ID`: Your GCP project ID
- `N8N_WEBHOOK_URL`: Your n8n registration webhook
- `SESSION_SECRET`: Random 32-character string
- `ENCRYPTION_KEY`: Random 32-character encryption key

### 5. Deploy to Cloud Run

```bash
# Deploy the main application
gcloud run deploy gmail-agent-registration \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars-from-file .env

# Note the service URL provided after deployment
# Update GOOGLE_REDIRECT_URI in .env and OAuth config with this URL
```

### 6. Deploy Cloud Function for Watch Renewal

```bash
# Deploy the watch renewal function
gcloud functions deploy renewGmailWatches \
  --runtime nodejs18 \
  --trigger-topic watch-renewal-trigger \
  --region us-central1 \
  --entry-point renewGmailWatches \
  --source ./functions \
  --set-env-vars FIRESTORE_PROJECT_ID=$PROJECT_ID,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET,ENCRYPTION_KEY=$ENCRYPTION_KEY,N8N_RENEWAL_WEBHOOK_URL=$N8N_RENEWAL_WEBHOOK_URL
```

### 7. Set Up Cloud Scheduler

```bash
# Create the Pub/Sub topic
gcloud pubsub topics create watch-renewal-trigger

# Create Cloud Scheduler job (runs daily at midnight)
gcloud scheduler jobs create pubsub watch-renewal-job \
  --schedule="0 0 * * *" \
  --topic=watch-renewal-trigger \
  --message-body='{"action":"renew"}' \
  --location=us-central1
```

## Local Development

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Run development server
npm run dev

# Access at http://localhost:8080
```

## Testing

### Test OAuth Flow

1. Navigate to `http://localhost:8080` (or your Cloud Run URL)
2. Fill in registration form
3. Click "Connect Gmail Account"
4. Complete Google OAuth consent
5. Verify redirect to success page

### Test Webhook Integration

```bash
# Test registration webhook
curl -X POST http://localhost:8080/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"webhookType": "registration"}'

# Test renewal webhook
curl -X POST http://localhost:8080/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"webhookType": "renewal"}'
```

### Test Watch Renewal

```bash
# Manually trigger watch renewal
gcloud scheduler jobs run watch-renewal-job --location=us-central1

# Or use HTTP trigger
curl https://us-central1-$PROJECT_ID.cloudfunctions.net/renewGmailWatchesHTTP
```

## API Endpoints

### Public Endpoints

- `GET /` - Registration landing page
- `GET /success` - Registration success page
- `GET /auth/google` - Initiate OAuth flow
- `GET /auth/callback` - OAuth callback handler
- `GET /health` - Health check endpoint

### Protected Endpoints

- `POST /auth/refresh` - Refresh access token
- `POST /auth/revoke` - Revoke access
- `POST /gmail/watch/setup` - Set up Gmail watch
- `POST /pubsub/push` - Pub/Sub notification handler
- `POST /webhook/test` - Test webhook
- `GET /webhook/status` - Webhook configuration status

## n8n Workflow Integration

### Registration Webhook Payload

```json
{
  "event": "client_registered",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "clientId": "uuid-here",
    "name": "John Doe",
    "email": "john@example.com",
    "company": "Acme Corp",
    "gmailAddress": "john.gmail@gmail.com",
    "registeredAt": "2024-01-15T10:30:00.000Z",
    "tokens": {
      "access_token": "ya29...",
      "refresh_token": "1//...",
      "expiry_date": 1705318200000
    }
  }
}
```

### Renewal Webhook Payload

```json
{
  "event": "watch_renewal_batch",
  "timestamp": "2024-01-15T00:00:00.000Z",
  "data": {
    "totalProcessed": 10,
    "successful": 9,
    "failed": 1,
    "results": [
      {
        "success": true,
        "clientId": "uuid-here",
        "gmailAddress": "user@gmail.com",
        "newExpiration": "2024-01-22T00:00:00.000Z",
        "renewedAt": "2024-01-15T00:00:00.000Z"
      }
    ]
  }
}
```

## Security

- All OAuth tokens are encrypted at rest using AES encryption
- HTTPS enforced in production
- CSRF protection via state parameter
- Session secrets rotated regularly
- Rate limiting on authentication endpoints
- Helmet.js security headers
- Non-root Docker container user

## Monitoring

### Check Application Health

```bash
curl https://your-app.run.app/health
```

### View Logs

```bash
# Cloud Run logs
gcloud run services logs read gmail-agent-registration --region us-central1

# Cloud Functions logs
gcloud functions logs read renewGmailWatches --region us-central1
```

### Firestore Statistics

Access via API (implement custom endpoint) or Cloud Console.

## Troubleshooting

### OAuth Errors

- Verify OAuth consent screen is configured
- Check redirect URI matches exactly
- Ensure all required scopes are added
- For production, publish OAuth app

### Watch Renewal Failures

- Check token hasn't been revoked
- Verify Pub/Sub topics exist
- Ensure Cloud Scheduler job is running
- Check function logs for errors

### Webhook Failures

- Verify n8n webhook URLs are accessible
- Check n8n workflow is active
- Review retry logs in application

## Project Structure

```
gmail-agent-registration/
├── backend/
│   ├── server.js           # Main Express server
│   ├── auth.js             # OAuth flow handlers
│   ├── database.js         # Firestore operations
│   ├── webhook.js          # n8n webhook integration
│   └── gmail-watch.js      # Gmail watch management
├── frontend/
│   ├── index.html          # Registration page
│   ├── success.html        # Success page
│   └── style.css           # Styles
├── functions/
│   ├── watch-renewal.js    # Cloud Function
│   └── package.json        # Function dependencies
├── package.json            # Main dependencies
├── Dockerfile              # Container configuration
├── .env.example            # Environment template
├── .gitignore              # Git ignore rules
├── CLAUDE.md               # Claude Code guidance
└── README.md               # This file
```

## License

MIT

## Support

For issues, please check:
1. Application logs in Cloud Run
2. Function logs in Cloud Functions
3. Firestore database state
4. n8n webhook receipts
