# Claude Code Prompt: Gmail Agent Registration System

## Project Overview
I need to create a complete Gmail agent registration system on Google Cloud that allows clients to authorize Gmail access through a web interface, sends their credentials to n8n via webhook, and automatically maintains Gmail watch subscriptions.

## Technical Requirements

### 1. Gmail API Scopes Required
- `https://www.googleapis.com/auth/gmail.readonly` - Read all emails
- `https://www.googleapis.com/auth/gmail.send` - Send emails
- `https://www.googleapis.com/auth/gmail.compose` - Create drafts
- `https://www.googleapis.com/auth/gmail.modify` - Modify emails (for watch notifications)

### 2. System Architecture
- **Frontend**: Registration page hosted on Google Cloud Run/App Engine
- **Backend**: Node.js/Python API for OAuth flow and webhook handling
- **Database**: Firestore to store client tokens and registration data
- **n8n Integration**: Webhook endpoints to receive registration data
- **Gmail Watch**: Pub/Sub topic for Gmail push notifications

## Implementation Tasks

### Phase 1: Google Cloud Setup
1. Create a new Google Cloud Project
2. Enable required APIs:
   - Gmail API
   - Cloud Run API
   - Firestore API
   - Cloud Pub/Sub API
   - Cloud Scheduler API (for watch renewal)
3. Set up OAuth 2.0 credentials:
   - Create OAuth consent screen
   - Add all required Gmail scopes
   - Create OAuth 2.0 Client ID
   - Set authorized redirect URIs

### Phase 2: Registration Application
Create a Node.js application with the following structure:

```
gmail-agent-registration/
├── frontend/
│   ├── index.html (registration landing page)
│   ├── success.html (registration success page)
│   └── style.css
├── backend/
│   ├── server.js (main server)
│   ├── auth.js (OAuth flow handler)
│   ├── webhook.js (n8n webhook integration)
│   └── database.js (Firestore operations)
├── package.json
├── Dockerfile
└── .env.example
```

Key features to implement:
1. **Landing Page** (`/`):
   - Client information form (name, email, company)
   - "Connect Gmail" button that initiates OAuth flow
   - Clear explanation of permissions requested

2. **OAuth Flow** (`/auth/google` and `/auth/callback`):
   - Redirect to Google OAuth consent
   - Handle callback with authorization code
   - Exchange code for access and refresh tokens
   - Store tokens securely in Firestore

3. **Webhook Handler** (`/webhook/registration-complete`):
   - Format registration data including:
     - Client information
     - Access token
     - Refresh token
     - Gmail address
     - Registration timestamp
   - Send to n8n webhook URL
   - Handle retry logic for failed webhooks

4. **Gmail Watch Setup** (`/gmail/watch/setup`):
   - Create Pub/Sub topic for each client
   - Set up Gmail watch on INBOX label
   - Store watch expiration time

### Phase 3: Database Schema (Firestore)
Create collections:
```javascript
// Collection: 'clients'
{
  clientId: string,
  email: string,
  name: string,
  company: string,
  gmailAddress: string,
  tokens: {
    access_token: string,
    refresh_token: string,
    expiry_date: timestamp
  },
  watchData: {
    historyId: string,
    expiration: timestamp,
    topicName: string
  },
  registeredAt: timestamp,
  lastRenewed: timestamp
}
```

### Phase 4: n8n Webhook Receiver Workflow
Create an n8n workflow that:
1. Receives webhook data at endpoint: `https://your-n8n-instance.com/webhook/gmail-registrations`
2. Validates incoming data
3. Routes to appropriate workflow based on client data
4. Stores client credentials in n8n credentials store
5. Sends confirmation email to client

### Phase 5: Gmail Watch Auto-Renewal System
Create a Cloud Scheduler job and Cloud Function that:
1. Runs every 24 hours
2. Queries Firestore for watches expiring in next 48 hours
3. Renews Gmail watch for each client
4. Updates Firestore with new expiration
5. Sends renewal status to n8n webhook

### Phase 6: n8n Watch Renewal Workflow
Create an n8n workflow that:
1. Triggers daily via cron
2. Fetches all registered clients from database
3. For each client:
   - Checks watch expiration
   - Uses Gmail API to renew watch
   - Updates database with new expiration
   - Logs renewal status

## Security Considerations
1. Encrypt tokens at rest in Firestore
2. Use environment variables for sensitive data
3. Implement HTTPS everywhere
4. Add rate limiting to prevent abuse
5. Implement CSRF protection
6. Validate and sanitize all inputs
7. Use Google Cloud Secret Manager for API keys

## Environment Variables
```env
GOOGLE_CLIENT_ID=your_oauth_client_id
GOOGLE_CLIENT_SECRET=your_oauth_client_secret
GOOGLE_REDIRECT_URI=https://your-app.run.app/auth/callback
N8N_WEBHOOK_URL=https://your-n8n.com/webhook/gmail-registrations
N8N_RENEWAL_WEBHOOK_URL=https://your-n8n.com/webhook/gmail-watch-renewal
FIRESTORE_PROJECT_ID=your-project-id
PUBSUB_TOPIC_PREFIX=gmail-watch-
SESSION_SECRET=random_session_secret
ENCRYPTION_KEY=32_byte_encryption_key
```

## Deployment Instructions
1. Build and deploy to Google Cloud Run:
   ```bash
   gcloud run deploy gmail-agent-registration \
     --source . \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars-from-file .env
   ```

2. Set up custom domain (optional)
3. Configure Cloud Scheduler for watch renewal
4. Test complete flow with test account

## Testing Checklist
- [ ] OAuth flow completes successfully
- [ ] Tokens are stored securely in Firestore
- [ ] n8n webhook receives complete data
- [ ] Gmail watch is established
- [ ] Watch renewal works automatically
- [ ] Error handling for expired tokens
- [ ] Client can re-authorize if needed

## Additional Features to Consider
1. Dashboard for viewing registered clients
2. Manual watch renewal button
3. Token refresh endpoint
4. Webhook retry queue
5. Client deregistration flow
6. Analytics and monitoring
7. Multi-language support

Please help me build this complete system step by step, starting with the Google Cloud project setup and OAuth configuration, then moving through each phase systematically. Ensure all code follows best practices for security and scalability.