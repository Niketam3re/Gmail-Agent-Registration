const { Firestore } = require('@google-cloud/firestore');
const CryptoJS = require('crypto-js');

// Initialize Firestore
const firestore = new Firestore({
    projectId: process.env.FIRESTORE_PROJECT_ID,
});

const CLIENTS_COLLECTION = 'clients';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

/**
 * Encrypt sensitive data
 */
function encrypt(text) {
    if (!ENCRYPTION_KEY) {
        console.warn('WARNING: ENCRYPTION_KEY not set. Data will not be encrypted!');
        return text;
    }
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

/**
 * Decrypt sensitive data
 */
function decrypt(ciphertext) {
    if (!ENCRYPTION_KEY) {
        console.warn('WARNING: ENCRYPTION_KEY not set. Returning data as-is.');
        return ciphertext;
    }
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}

/**
 * Encrypt client tokens before storage
 */
function encryptTokens(tokens) {
    return {
        access_token: encrypt(tokens.access_token),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        expiry_date: tokens.expiry_date
    };
}

/**
 * Decrypt client tokens after retrieval
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
 * Save or update client in Firestore
 */
async function saveClient(clientData) {
    try {
        const clientRef = firestore.collection(CLIENTS_COLLECTION).doc(clientData.clientId);

        // Encrypt tokens before saving
        const dataToSave = {
            ...clientData,
            tokens: encryptTokens(clientData.tokens),
            updatedAt: new Date()
        };

        await clientRef.set(dataToSave, { merge: true });
        console.log(`Client ${clientData.clientId} saved successfully`);

        return clientData;
    } catch (error) {
        console.error('Error saving client to Firestore:', error);
        throw new Error('Failed to save client data');
    }
}

/**
 * Get client by ID
 */
async function getClientById(clientId) {
    try {
        const clientRef = firestore.collection(CLIENTS_COLLECTION).doc(clientId);
        const doc = await clientRef.get();

        if (!doc.exists) {
            return null;
        }

        const data = doc.data();

        // Decrypt tokens before returning
        return {
            ...data,
            tokens: decryptTokens(data.tokens)
        };
    } catch (error) {
        console.error('Error getting client from Firestore:', error);
        throw new Error('Failed to retrieve client data');
    }
}

/**
 * Get client by Gmail address
 */
async function getClientByGmail(gmailAddress) {
    try {
        const snapshot = await firestore.collection(CLIENTS_COLLECTION)
            .where('gmailAddress', '==', gmailAddress)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return null;
        }

        const doc = snapshot.docs[0];
        const data = doc.data();

        // Decrypt tokens before returning
        return {
            ...data,
            tokens: decryptTokens(data.tokens)
        };
    } catch (error) {
        console.error('Error getting client by Gmail:', error);
        throw new Error('Failed to retrieve client data');
    }
}

/**
 * Get all clients
 */
async function getAllClients() {
    try {
        const snapshot = await firestore.collection(CLIENTS_COLLECTION).get();

        const clients = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            clients.push({
                ...data,
                tokens: decryptTokens(data.tokens)
            });
        });

        return clients;
    } catch (error) {
        console.error('Error getting all clients:', error);
        throw new Error('Failed to retrieve clients');
    }
}

/**
 * Get clients with expiring watches
 * @param {number} hoursFromNow - Get watches expiring within this many hours
 */
async function getClientsWithExpiringWatches(hoursFromNow = 48) {
    try {
        const expirationThreshold = new Date();
        expirationThreshold.setHours(expirationThreshold.getHours() + hoursFromNow);

        const snapshot = await firestore.collection(CLIENTS_COLLECTION)
            .where('watchData.expiration', '<=', expirationThreshold)
            .get();

        const clients = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            clients.push({
                ...data,
                tokens: decryptTokens(data.tokens)
            });
        });

        return clients;
    } catch (error) {
        console.error('Error getting clients with expiring watches:', error);
        throw new Error('Failed to retrieve clients with expiring watches');
    }
}

/**
 * Update watch data for a client
 */
async function updateWatchData(clientId, watchData) {
    try {
        const clientRef = firestore.collection(CLIENTS_COLLECTION).doc(clientId);

        await clientRef.update({
            watchData,
            lastRenewed: new Date(),
            updatedAt: new Date()
        });

        console.log(`Watch data updated for client ${clientId}`);
        return true;
    } catch (error) {
        console.error('Error updating watch data:', error);
        throw new Error('Failed to update watch data');
    }
}

/**
 * Delete a client
 */
async function deleteClient(clientId) {
    try {
        const clientRef = firestore.collection(CLIENTS_COLLECTION).doc(clientId);
        await clientRef.delete();

        console.log(`Client ${clientId} deleted successfully`);
        return true;
    } catch (error) {
        console.error('Error deleting client:', error);
        throw new Error('Failed to delete client');
    }
}

/**
 * Update client tokens
 */
async function updateClientTokens(clientId, tokens) {
    try {
        const clientRef = firestore.collection(CLIENTS_COLLECTION).doc(clientId);

        await clientRef.update({
            tokens: encryptTokens(tokens),
            updatedAt: new Date()
        });

        console.log(`Tokens updated for client ${clientId}`);
        return true;
    } catch (error) {
        console.error('Error updating tokens:', error);
        throw new Error('Failed to update tokens');
    }
}

/**
 * Get statistics
 */
async function getStats() {
    try {
        const snapshot = await firestore.collection(CLIENTS_COLLECTION).get();
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        let total = 0;
        let registeredToday = 0;
        let registeredThisWeek = 0;
        let activeWatches = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            total++;

            if (data.registeredAt && data.registeredAt.toDate() >= oneDayAgo) {
                registeredToday++;
            }

            if (data.registeredAt && data.registeredAt.toDate() >= oneWeekAgo) {
                registeredThisWeek++;
            }

            if (data.watchData && data.watchData.expiration && data.watchData.expiration.toDate() > now) {
                activeWatches++;
            }
        });

        return {
            totalClients: total,
            registeredToday,
            registeredThisWeek,
            activeWatches
        };
    } catch (error) {
        console.error('Error getting stats:', error);
        throw new Error('Failed to retrieve statistics');
    }
}

module.exports = {
    saveClient,
    getClientById,
    getClientByGmail,
    getAllClients,
    getClientsWithExpiringWatches,
    updateWatchData,
    deleteClient,
    updateClientTokens,
    getStats,
    encrypt,
    decrypt
};
