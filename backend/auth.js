const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');
const { saveClient, getClientById } = require('./database');
const { sendRegistrationWebhook } = require('./webhook');
const { setupGmailWatch } = require('./gmail-watch');

const router = express.Router();

// Gmail API scopes
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
];

// Initialize OAuth2 client
const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

/**
 * Initiate OAuth flow
 * Route: GET /auth/google
 */
router.get('/google', (req, res) => {
    try {
        const { email, name, company } = req.query;

        // Generate a unique state parameter for CSRF protection
        const state = uuidv4();

        // Store registration data in session
        req.session.registrationData = {
            email,
            name,
            company: company || '',
            state
        };

        // Generate authorization URL
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline', // Request refresh token
            scope: SCOPES,
            state: state,
            prompt: 'consent' // Force consent screen to get refresh token
        });

        res.redirect(authUrl);
    } catch (error) {
        console.error('Error initiating OAuth flow:', error);
        res.status(500).send('Failed to initiate authentication');
    }
});

/**
 * Handle OAuth callback
 * Route: GET /auth/callback
 */
router.get('/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;

        // Handle authorization errors
        if (error) {
            console.error('OAuth error:', error);
            return res.status(400).send(`Authentication failed: ${error}`);
        }

        // Verify state parameter for CSRF protection
        const registrationData = req.session.registrationData;
        if (!registrationData || registrationData.state !== state) {
            return res.status(400).send('Invalid state parameter. Possible CSRF attack.');
        }

        // Exchange authorization code for tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get user's Gmail address and profile info
        const { google } = require('googleapis');
        const oauth2 = google.oauth2({
            auth: oauth2Client,
            version: 'v2'
        });

        const userInfo = await oauth2.userinfo.get();
        const gmailAddress = userInfo.data.email;

        // Create client record
        const clientId = uuidv4();
        const clientData = {
            clientId,
            email: registrationData.email,
            name: registrationData.name,
            company: registrationData.company,
            gmailAddress,
            tokens: {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expiry_date: tokens.expiry_date
            },
            registeredAt: new Date(),
            lastRenewed: null,
            watchData: null
        };

        // Save to Firestore
        await saveClient(clientData);

        // Set up Gmail watch (don't block on this)
        setupGmailWatch(clientId).catch(err => {
            console.error('Failed to set up Gmail watch:', err);
        });

        // Send registration data to n8n webhook (don't block on this)
        sendRegistrationWebhook(clientData).catch(err => {
            console.error('Failed to send registration webhook:', err);
        });

        // Clear session data
        delete req.session.registrationData;

        // Redirect to success page
        const successUrl = `/success?gmail=${encodeURIComponent(gmailAddress)}&timestamp=${Date.now()}`;
        res.redirect(successUrl);
    } catch (error) {
        console.error('Error in OAuth callback:', error);
        res.status(500).send('Authentication failed. Please try again.');
    }
});

/**
 * Refresh access token
 * Route: POST /auth/refresh
 */
router.post('/refresh', async (req, res) => {
    try {
        const { clientId } = req.body;

        if (!clientId) {
            return res.status(400).json({ error: 'Client ID is required' });
        }

        // Get client data from database
        const client = await getClientById(clientId);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Set up OAuth client with refresh token
        oauth2Client.setCredentials({
            refresh_token: client.tokens.refresh_token
        });

        // Get new access token
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Update client data
        client.tokens.access_token = credentials.access_token;
        client.tokens.expiry_date = credentials.expiry_date;

        // Save updated tokens
        await saveClient(client);

        res.status(200).json({
            success: true,
            message: 'Token refreshed successfully',
            expiry_date: credentials.expiry_date
        });
    } catch (error) {
        console.error('Error refreshing token:', error);
        res.status(500).json({
            error: 'Failed to refresh token',
            message: error.message
        });
    }
});

/**
 * Revoke access
 * Route: POST /auth/revoke
 */
router.post('/revoke', async (req, res) => {
    try {
        const { clientId } = req.body;

        if (!clientId) {
            return res.status(400).json({ error: 'Client ID is required' });
        }

        // Get client data
        const client = await getClientById(clientId);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Revoke the token
        oauth2Client.setCredentials({
            access_token: client.tokens.access_token
        });

        await oauth2Client.revokeCredentials();

        // You might want to delete the client from database here
        // await deleteClient(clientId);

        res.status(200).json({
            success: true,
            message: 'Access revoked successfully'
        });
    } catch (error) {
        console.error('Error revoking access:', error);
        res.status(500).json({
            error: 'Failed to revoke access',
            message: error.message
        });
    }
});

/**
 * Get OAuth client for internal use
 */
function getOAuth2Client() {
    return oauth2Client;
}

module.exports = router;
module.exports.getOAuth2Client = getOAuth2Client;
