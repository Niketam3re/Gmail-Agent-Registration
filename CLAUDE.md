# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Gmail Agent Registration System built on Google Cloud Platform. It provides a web-based OAuth flow for clients to authorize Gmail access, stores credentials in Firestore, sends registration data to n8n via webhooks, and automatically maintains Gmail watch subscriptions using Pub/Sub.

## Architecture

### Core Components

1. **Frontend** (Cloud Run/App Engine hosted)
   - Registration landing page with OAuth initiation
   - Success page after registration completion

2. **Backend API** (Node.js/Python)
   - OAuth 2.0 flow handlers (`/auth/google`, `/auth/callback`)
   - Webhook integration with n8n (`/webhook/registration-complete`)
   - Gmail watch setup and management (`/gmail/watch/setup`)

3. **Data Layer**
   - Firestore collection `clients` stores:
     - Client info (name, email, company, gmailAddress)
     - Encrypted tokens (access_token, refresh_token, expiry_date)
     - Watch metadata (historyId, expiration, topicName)

4. **Gmail Watch System**
   - Cloud Pub/Sub topics per client (prefix: `gmail-watch-`)
   - Cloud Scheduler job for 24-hour renewal checks
   - Cloud Function to renew watches expiring within 48 hours

5. **n8n Integration**
   - Registration webhook: receives client data and tokens
   - Renewal webhook: receives watch renewal status updates

### Gmail API Scopes

The system requires these scopes:
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/gmail.modify`

## Development Commands

### Local Development

```bash
# Install dependencies
npm install

# Run development server (assumes backend/server.js)
npm run dev

# Run with environment variables
node backend/server.js
```

### Testing

```bash
# Test OAuth flow (requires valid credentials)
npm test

# Test webhook integration
npm run test:webhook

# Test watch renewal
npm run test:watch-renewal
```

### Deployment

```bash
# Deploy to Google Cloud Run
gcloud run deploy gmail-agent-registration \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars-from-file .env

# Deploy watch renewal Cloud Function
gcloud functions deploy renewGmailWatches \
  --runtime nodejs18 \
  --trigger-topic watch-renewal-trigger \
  --region us-central1

# Set up Cloud Scheduler for watch renewal
gcloud scheduler jobs create pubsub watch-renewal-job \
  --schedule "0 */24 * * *" \
  --topic watch-renewal-trigger \
  --message-body "{}"
```

## Required Environment Variables

All sensitive configuration should be in `.env` (never committed):

```env
GOOGLE_CLIENT_ID=              # OAuth 2.0 Client ID
GOOGLE_CLIENT_SECRET=          # OAuth 2.0 Client Secret
GOOGLE_REDIRECT_URI=           # https://your-app.run.app/auth/callback
N8N_WEBHOOK_URL=               # Registration webhook endpoint
N8N_RENEWAL_WEBHOOK_URL=       # Watch renewal webhook endpoint
FIRESTORE_PROJECT_ID=          # GCP project ID
PUBSUB_TOPIC_PREFIX=           # Prefix for watch topics (e.g., "gmail-watch-")
SESSION_SECRET=                # Random secret for session management
ENCRYPTION_KEY=                # 32-byte key for token encryption
```

## Security Architecture

1. **Token Storage**: All OAuth tokens MUST be encrypted at rest in Firestore using the ENCRYPTION_KEY
2. **API Keys**: Use Google Cloud Secret Manager for sensitive credentials
3. **HTTPS Only**: All endpoints must enforce HTTPS
4. **CSRF Protection**: Implement for all state-changing operations
5. **Input Validation**: Sanitize all user inputs before storage/processing
6. **Rate Limiting**: Protect OAuth endpoints from abuse

## File Structure

```
gmail-agent-registration/
├── frontend/
│   ├── index.html           # Registration landing page
│   ├── success.html         # Post-registration success page
│   └── style.css
├── backend/
│   ├── server.js            # Main Express/Fastify server
│   ├── auth.js              # OAuth 2.0 flow handlers
│   ├── webhook.js           # n8n webhook integration logic
│   └── database.js          # Firestore CRUD operations
├── functions/
│   └── watch-renewal.js     # Cloud Function for watch renewal
├── package.json
├── Dockerfile
└── .env.example
```

## Key Implementation Details

### OAuth Flow
1. User clicks "Connect Gmail" on landing page
2. Backend redirects to Google OAuth consent screen with required scopes
3. Callback receives authorization code
4. Exchange code for access + refresh tokens
5. Store encrypted tokens in Firestore
6. Send registration data to n8n webhook
7. Set up Gmail watch on INBOX

### Watch Renewal Logic
- Watches expire after 7 days
- Cloud Scheduler triggers renewal check every 24 hours
- Renew any watches expiring within 48 hours
- Update Firestore with new expiration timestamp
- Notify n8n of renewal status via webhook

### Webhook Retry Strategy
If n8n webhook fails:
1. Retry with exponential backoff (3 attempts)
2. Log failure to Firestore
3. Continue with watch setup (don't block registration)
4. n8n can query for missed registrations via API

## GCP Services Required

Enable these APIs in your GCP project:
- Gmail API
- Cloud Run API
- Firestore API (Native mode)
- Cloud Pub/Sub API
- Cloud Scheduler API
- Secret Manager API (for production credentials)

## Common Development Patterns

### Adding New OAuth Scopes
1. Update scope list in `backend/auth.js`
2. Update OAuth consent screen in GCP Console
3. Users must re-authorize to grant new permissions

### Adding New Client Fields
1. Update Firestore schema in `backend/database.js`
2. Update registration form in `frontend/index.html`
3. Update webhook payload in `backend/webhook.js`
4. Update n8n workflow to handle new fields
