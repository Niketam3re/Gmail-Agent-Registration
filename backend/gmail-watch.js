const { google } = require('googleapis');
const { PubSub } = require('@google-cloud/pubsub');
const { getClientById, updateWatchData } = require('./database');
const { getOAuth2Client } = require('./auth');

const pubsub = new PubSub({
    projectId: process.env.FIRESTORE_PROJECT_ID,
});

const PUBSUB_TOPIC_PREFIX = process.env.PUBSUB_TOPIC_PREFIX || 'gmail-watch-';

/**
 * Create a Pub/Sub topic if it doesn't exist
 */
async function createPubSubTopic(topicName) {
    try {
        const topic = pubsub.topic(topicName);
        const [exists] = await topic.exists();

        if (!exists) {
            await pubsub.createTopic(topicName);
            console.log(`Created Pub/Sub topic: ${topicName}`);
        } else {
            console.log(`Pub/Sub topic already exists: ${topicName}`);
        }

        return topicName;
    } catch (error) {
        console.error('Error creating Pub/Sub topic:', error);
        throw error;
    }
}

/**
 * Set up Gmail watch for a client
 */
async function setupGmailWatch(clientId) {
    try {
        // Get client data
        const client = await getClientById(clientId);
        if (!client) {
            throw new Error('Client not found');
        }

        // Set up OAuth client with tokens
        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials(client.tokens);

        // Initialize Gmail API
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Create Pub/Sub topic for this client
        const topicName = `${PUBSUB_TOPIC_PREFIX}${clientId}`;
        await createPubSubTopic(topicName);

        // Full topic name in the format required by Gmail API
        const fullTopicName = `projects/${process.env.FIRESTORE_PROJECT_ID}/topics/${topicName}`;

        // Set up watch on Gmail
        const watchResponse = await gmail.users.watch({
            userId: 'me',
            requestBody: {
                topicName: fullTopicName,
                labelIds: ['INBOX'], // Watch inbox only, can be modified
                labelFilterAction: 'include'
            }
        });

        console.log('Gmail watch set up successfully:', watchResponse.data);

        // Store watch data in database
        const watchData = {
            historyId: watchResponse.data.historyId,
            expiration: new Date(parseInt(watchResponse.data.expiration)),
            topicName: topicName
        };

        await updateWatchData(clientId, watchData);

        return {
            success: true,
            watchData,
            message: 'Gmail watch set up successfully'
        };
    } catch (error) {
        console.error('Error setting up Gmail watch:', error);
        throw error;
    }
}

/**
 * Renew Gmail watch for a client
 */
async function renewGmailWatch(clientId) {
    try {
        console.log(`Renewing Gmail watch for client: ${clientId}`);

        // Get client data
        const client = await getClientById(clientId);
        if (!client) {
            throw new Error('Client not found');
        }

        // Set up OAuth client with tokens
        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials(client.tokens);

        // Initialize Gmail API
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Get the existing topic name
        const topicName = client.watchData?.topicName || `${PUBSUB_TOPIC_PREFIX}${clientId}`;
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

        console.log(`Watch renewed successfully for client ${clientId}`);

        // Update watch data in database
        const watchData = {
            historyId: watchResponse.data.historyId,
            expiration: new Date(parseInt(watchResponse.data.expiration)),
            topicName: topicName
        };

        await updateWatchData(clientId, watchData);

        return {
            success: true,
            clientId,
            gmailAddress: client.gmailAddress,
            watchData,
            renewedAt: new Date()
        };
    } catch (error) {
        console.error(`Error renewing watch for client ${clientId}:`, error);
        return {
            success: false,
            clientId,
            error: error.message,
            renewedAt: new Date()
        };
    }
}

/**
 * Stop Gmail watch for a client
 */
async function stopGmailWatch(clientId) {
    try {
        // Get client data
        const client = await getClientById(clientId);
        if (!client) {
            throw new Error('Client not found');
        }

        // Set up OAuth client with tokens
        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials(client.tokens);

        // Initialize Gmail API
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Stop watch
        await gmail.users.stop({
            userId: 'me'
        });

        console.log(`Gmail watch stopped for client ${clientId}`);

        // Clear watch data in database
        await updateWatchData(clientId, null);

        return {
            success: true,
            message: 'Gmail watch stopped successfully'
        };
    } catch (error) {
        console.error('Error stopping Gmail watch:', error);
        throw error;
    }
}

/**
 * Get message history since a specific historyId
 */
async function getMessageHistory(clientId, historyId) {
    try {
        const client = await getClientById(clientId);
        if (!client) {
            throw new Error('Client not found');
        }

        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials(client.tokens);

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Get history
        const response = await gmail.users.history.list({
            userId: 'me',
            startHistoryId: historyId,
            historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']
        });

        return {
            success: true,
            history: response.data.history || [],
            historyId: response.data.historyId
        };
    } catch (error) {
        console.error('Error getting message history:', error);
        throw error;
    }
}

/**
 * Get full message details
 */
async function getMessage(clientId, messageId) {
    try {
        const client = await getClientById(clientId);
        if (!client) {
            throw new Error('Client not found');
        }

        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials(client.tokens);

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        const response = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full'
        });

        return {
            success: true,
            message: response.data
        };
    } catch (error) {
        console.error('Error getting message:', error);
        throw error;
    }
}

module.exports = {
    setupGmailWatch,
    renewGmailWatch,
    stopGmailWatch,
    getMessageHistory,
    getMessage,
    createPubSubTopic
};
