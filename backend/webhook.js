const express = require('express');
const axios = require('axios');

const router = express.Router();

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_RENEWAL_WEBHOOK_URL = process.env.N8N_RENEWAL_WEBHOOK_URL;

// Retry configuration
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000; // 2 seconds

/**
 * Delay helper for retry logic
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send registration data to n8n webhook with retry logic
 */
async function sendRegistrationWebhook(clientData, attempt = 1) {
    if (!N8N_WEBHOOK_URL) {
        console.warn('N8N_WEBHOOK_URL not configured. Skipping webhook.');
        return { success: false, reason: 'Webhook URL not configured' };
    }

    try {
        // Prepare webhook payload
        const payload = {
            event: 'client_registered',
            timestamp: new Date().toISOString(),
            data: {
                clientId: clientData.clientId,
                name: clientData.name,
                email: clientData.email,
                company: clientData.company,
                gmailAddress: clientData.gmailAddress,
                registeredAt: clientData.registeredAt,
                // Include tokens for n8n to store as credentials
                tokens: {
                    access_token: clientData.tokens.access_token,
                    refresh_token: clientData.tokens.refresh_token,
                    expiry_date: clientData.tokens.expiry_date
                }
            }
        };

        console.log(`Sending registration webhook to n8n (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})...`);

        const response = await axios.post(N8N_WEBHOOK_URL, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 second timeout
        });

        console.log(`Registration webhook sent successfully: ${clientData.clientId}`);
        return {
            success: true,
            status: response.status,
            data: response.data
        };
    } catch (error) {
        console.error(`Registration webhook failed (attempt ${attempt}):`, error.message);

        // Retry logic
        if (attempt < MAX_RETRY_ATTEMPTS) {
            const delayTime = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
            console.log(`Retrying in ${delayTime}ms...`);
            await delay(delayTime);
            return sendRegistrationWebhook(clientData, attempt + 1);
        }

        // All retries exhausted
        console.error('Registration webhook failed after all retry attempts');
        return {
            success: false,
            error: error.message,
            attempts: attempt
        };
    }
}

/**
 * Send watch renewal notification to n8n
 */
async function sendRenewalWebhook(renewalData, attempt = 1) {
    if (!N8N_RENEWAL_WEBHOOK_URL) {
        console.warn('N8N_RENEWAL_WEBHOOK_URL not configured. Skipping renewal webhook.');
        return { success: false, reason: 'Renewal webhook URL not configured' };
    }

    try {
        const payload = {
            event: 'watch_renewed',
            timestamp: new Date().toISOString(),
            data: renewalData
        };

        console.log(`Sending renewal webhook to n8n (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})...`);

        const response = await axios.post(N8N_RENEWAL_WEBHOOK_URL, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        console.log(`Renewal webhook sent successfully for client ${renewalData.clientId}`);
        return {
            success: true,
            status: response.status,
            data: response.data
        };
    } catch (error) {
        console.error(`Renewal webhook failed (attempt ${attempt}):`, error.message);

        if (attempt < MAX_RETRY_ATTEMPTS) {
            const delayTime = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            console.log(`Retrying in ${delayTime}ms...`);
            await delay(delayTime);
            return sendRenewalWebhook(renewalData, attempt + 1);
        }

        console.error('Renewal webhook failed after all retry attempts');
        return {
            success: false,
            error: error.message,
            attempts: attempt
        };
    }
}

/**
 * Manual webhook test endpoint
 * Route: POST /webhook/test
 */
router.post('/test', async (req, res) => {
    try {
        const { webhookType } = req.body;

        const testPayload = {
            event: webhookType === 'renewal' ? 'watch_renewed' : 'client_registered',
            timestamp: new Date().toISOString(),
            test: true,
            data: {
                message: 'This is a test webhook from Gmail Agent Registration System'
            }
        };

        const webhookUrl = webhookType === 'renewal' ? N8N_RENEWAL_WEBHOOK_URL : N8N_WEBHOOK_URL;

        if (!webhookUrl) {
            return res.status(400).json({
                success: false,
                error: 'Webhook URL not configured'
            });
        }

        const response = await axios.post(webhookUrl, testPayload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        res.status(200).json({
            success: true,
            message: 'Test webhook sent successfully',
            response: {
                status: response.status,
                data: response.data
            }
        });
    } catch (error) {
        console.error('Test webhook failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send test webhook',
            message: error.message
        });
    }
});

/**
 * Receive webhook from n8n (if needed for bidirectional communication)
 * Route: POST /webhook/receive
 */
router.post('/receive', express.json(), async (req, res) => {
    try {
        console.log('Received webhook from n8n:', req.body);

        // Process the webhook data based on event type
        const { event, data } = req.body;

        switch (event) {
            case 'email_processed':
                console.log('Email processed notification:', data);
                // Handle email processing notification
                break;

            case 'workflow_completed':
                console.log('Workflow completed notification:', data);
                // Handle workflow completion
                break;

            default:
                console.log('Unknown event type:', event);
        }

        res.status(200).json({
            success: true,
            message: 'Webhook received and processed'
        });
    } catch (error) {
        console.error('Error processing incoming webhook:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process webhook'
        });
    }
});

/**
 * Webhook status endpoint
 * Route: GET /webhook/status
 */
router.get('/status', (req, res) => {
    res.status(200).json({
        registrationWebhook: {
            configured: !!N8N_WEBHOOK_URL,
            url: N8N_WEBHOOK_URL ? `${N8N_WEBHOOK_URL.substring(0, 30)}...` : null
        },
        renewalWebhook: {
            configured: !!N8N_RENEWAL_WEBHOOK_URL,
            url: N8N_RENEWAL_WEBHOOK_URL ? `${N8N_RENEWAL_WEBHOOK_URL.substring(0, 30)}...` : null
        },
        retryConfig: {
            maxAttempts: MAX_RETRY_ATTEMPTS,
            initialDelayMs: RETRY_DELAY_MS
        }
    });
});

module.exports = router;
module.exports.sendRegistrationWebhook = sendRegistrationWebhook;
module.exports.sendRenewalWebhook = sendRenewalWebhook;
