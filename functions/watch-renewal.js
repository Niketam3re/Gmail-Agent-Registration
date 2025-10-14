/**
 * Cloud Function for Gmail Watch Renewal
 *
 * This function is triggered by Cloud Scheduler every 24 hours
 * to renew Gmail watches that are expiring within the next 48 hours.
 *
 * Deploy with:
 * gcloud functions deploy renewGmailWatches \
 *   --runtime nodejs18 \
 *   --trigger-topic watch-renewal-trigger \
 *   --region us-central1 \
 *   --set-env-vars FIRESTORE_PROJECT_ID=your-project-id,...
 */

const { Firestore } = require('@google-cloud/firestore');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const { PubSub } = require('@google-cloud/pubsub');

// Initialize services
const firestore = new Firestore({
    projectId: process.env.FIRESTORE_PROJECT_ID,
});

const pubsub = new PubSub({
    projectId: process.env.FIRESTORE_PROJECT_ID,
});

const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
);

const CLIENTS_COLLECTION = 'clients';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const PUBSUB_TOPIC_PREFIX = process.env.PUBSUB_TOPIC_PREFIX || 'gmail-watch-';
const N8N_RENEWAL_WEBHOOK_URL = process.env.N8N_RENEWAL_WEBHOOK_URL;

/**
 * Decrypt sensitive data
 */
function decrypt(ciphertext) {
    if (!ENCRYPTION_KEY) {
        return ciphertext;
    }
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}

/**
 * Decrypt client tokens
 */
function decryptTokens(encryptedTokens) {
    if (!encryptedTokens) return null;
    return {
        access_token: decrypt(encryptedTokens.access_token),
        refresh_token: encryptedTokens.refresh_token ? decrypt(encryptedTokens.refresh_token) : null,
        expiry_date: encryptedTokens.expiry_date
    };
}

/**
 * Create Pub/Sub topic if it doesn't exist
 */
async function createPubSubTopic(topicName) {
    try {
        const topic = pubsub.topic(topicName);
        const [exists] = await topic.exists();

        if (!exists) {
            await pubsub.createTopic(topicName);
            console.log(`Created Pub/Sub topic: ${topicName}`);
        }

        return topicName;
    } catch (error) {
        console.error('Error creating Pub/Sub topic:', error);
        throw error;
    }
}

/**
 * Renew Gmail watch for a client
 */
async function renewWatch(client) {
    try {
        console.log(`Renewing watch for client: ${client.clientId}`);

        // Decrypt tokens
        const tokens = decryptTokens(client.tokens);

        // Set up OAuth client
        oauth2Client.setCredentials(tokens);

        // Initialize Gmail API
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Get topic name
        const topicName = client.watchData?.topicName || `${PUBSUB_TOPIC_PREFIX}${client.clientId}`;
        const fullTopicName = `projects/${process.env.FIRESTORE_PROJECT_ID}/topics/${topicName}`;

        // Ensure topic exists
        await createPubSubTopic(topicName);

        // Renew watch
        const watchResponse = await gmail.users.watch({
            userId: 'me',
            requestBody: {
                topicName: fullTopicName,
                labelIds: ['INBOX'],
                labelFilterAction: 'include'
            }
        });

        // Update database
        const clientRef = firestore.collection(CLIENTS_COLLECTION).doc(client.clientId);
        await clientRef.update({
            watchData: {
                historyId: watchResponse.data.historyId,
                expiration: new Date(parseInt(watchResponse.data.expiration)),
                topicName: topicName
            },
            lastRenewed: new Date(),
            updatedAt: new Date()
        });

        console.log(`Watch renewed successfully for ${client.gmailAddress}`);

        return {
            success: true,
            clientId: client.clientId,
            gmailAddress: client.gmailAddress,
            newExpiration: new Date(parseInt(watchResponse.data.expiration)),
            renewedAt: new Date()
        };
    } catch (error) {
        console.error(`Failed to renew watch for ${client.clientId}:`, error.message);

        return {
            success: false,
            clientId: client.clientId,
            gmailAddress: client.gmailAddress,
            error: error.message,
            renewedAt: new Date()
        };
    }
}

/**
 * Send renewal results to n8n
 */
async function sendRenewalWebhook(results) {
    if (!N8N_RENEWAL_WEBHOOK_URL) {
        console.log('N8N_RENEWAL_WEBHOOK_URL not configured. Skipping webhook.');
        return;
    }

    try {
        const payload = {
            event: 'watch_renewal_batch',
            timestamp: new Date().toISOString(),
            data: {
                totalProcessed: results.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results: results
            }
        };

        await axios.post(N8N_RENEWAL_WEBHOOK_URL, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        console.log('Renewal webhook sent to n8n successfully');
    } catch (error) {
        console.error('Failed to send renewal webhook:', error.message);
    }
}

/**
 * Main Cloud Function entry point
 */
exports.renewGmailWatches = async (message, context) => {
    console.log('Starting Gmail watch renewal process...');

    try {
        // Get clients with watches expiring in next 48 hours
        const expirationThreshold = new Date();
        expirationThreshold.setHours(expirationThreshold.getHours() + 48);

        const snapshot = await firestore.collection(CLIENTS_COLLECTION)
            .where('watchData.expiration', '<=', expirationThreshold)
            .get();

        if (snapshot.empty) {
            console.log('No watches need renewal at this time');
            return { success: true, message: 'No watches to renew' };
        }

        console.log(`Found ${snapshot.size} watches that need renewal`);

        // Process renewals
        const renewalPromises = [];
        snapshot.forEach(doc => {
            const client = doc.data();
            renewalPromises.push(renewWatch(client));
        });

        const results = await Promise.all(renewalPromises);

        // Send results to n8n
        await sendRenewalWebhook(results);

        // Log summary
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        console.log(`Renewal complete: ${successful} successful, ${failed} failed`);

        return {
            success: true,
            totalProcessed: results.length,
            successful,
            failed,
            results
        };
    } catch (error) {
        console.error('Error in watch renewal process:', error);
        throw error;
    }
};

/**
 * HTTP trigger version for manual invocation
 */
exports.renewGmailWatchesHTTP = async (req, res) => {
    try {
        const result = await exports.renewGmailWatches(null, null);
        res.status(200).json(result);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
