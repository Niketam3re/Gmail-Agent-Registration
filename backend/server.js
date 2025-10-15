require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./auth');
const webhookRoutes = require('./webhook');
const { setupGmailWatch } = require('./gmail-watch');

const app = express();
const PORT = process.env.PORT || 8080;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// CORS configuration
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/auth', limiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Require HTTPS in production
        httpOnly: true,
        maxAge: 1000 * 60 * 60 // 1 hour
    }
}));

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/webhook', webhookRoutes);

// Gmail watch endpoints
app.post('/gmail/watch/setup', async (req, res) => {
    try {
        const { clientId } = req.body;

        if (!clientId) {
            return res.status(400).json({ error: 'Client ID is required' });
        }

        const watchData = await setupGmailWatch(clientId);
        res.status(200).json({
            success: true,
            message: 'Gmail watch set up successfully',
            data: watchData
        });
    } catch (error) {
        console.error('Error setting up Gmail watch:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to set up Gmail watch',
            message: error.message
        });
    }
});

// Pub/Sub push notification endpoint for Gmail watch
app.post('/pubsub/push', express.json(), async (req, res) => {
    try {
        const message = req.body.message;

        if (!message || !message.data) {
            return res.status(400).json({ error: 'Invalid Pub/Sub message' });
        }

        // Decode the Pub/Sub message
        const data = Buffer.from(message.data, 'base64').toString();
        const notification = JSON.parse(data);

        console.log('Received Gmail notification:', notification);

        // Process the notification (implement your logic here)
        // You might want to:
        // 1. Fetch the new messages using the historyId
        // 2. Send them to n8n for processing
        // 3. Update your database

        // Acknowledge the message
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing Pub/Sub message:', error);
        res.status(500).json({ error: 'Failed to process notification' });
    }
});

// Serve frontend pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/success', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/success.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`Gmail Agent Registration Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Visit: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
