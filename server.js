// server.js
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

class USSDApp {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 7000;
        this.host = process.env.HOST || '172.17.50.13';
        this.initialized = false;
    }

    async initialize() {
        try {
            if (this.initialized) return true;

            console.log('[Redis] Initializing Redis cluster...');
            const redisService = require('./src/config/redis');
            await redisService.waitForConnection(10000);

            console.log('Loading menu configurations...');
            const menuService = require('./src/services/menu.service');
            let retries = 3;
            while (retries > 0) {
                try {
                    await menuService.loadConfigurations();
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Config load failed, ${retries} retries left:`, error.message);
                    if (retries > 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } else {
                        throw error;
                    }
                }
            }

            this.initialized = true;
            return true;
        } catch (error) {
            console.error('Initialization error:', error.message);
            this.initialized = false;
            return false;
        }
    }

    setupMiddleware() {
        this.app.use(helmet());
        this.app.use(cors());
        this.app.use(compression());
        this.app.use(express.json({ limit: '10kb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10kb' }));
    }

    setupRoutes() {
        const healthController = require('./src/controllers/health.controller');
        const ussdController = require('./src/controllers/ussd.controller');

        // Health check
        this.app.get('/api/health', (req, res) => healthController.check(req, res));

        // USSD endpoint
        this.app.post('/api/ussd', async (req, res) => {
            try {
                // Ensure system is initialized
                if (!this.initialized) {
                    await this.initialize();
                }

                await ussdController.handleRequest(req, res);
            } catch (error) {
                console.error('USSD endpoint error:', error);
                res.status(500).send('end System error');
            }
        });

        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({ error: 'Endpoint not found' });
        });
    }

    async start() {
        console.log('Starting USSD Server...');

        this.setupMiddleware();

        // Initialize before setting up routes
        const initSuccess = await this.initialize();
        if (!initSuccess) {
            console.error('Failed to initialize system');
            process.exit(1);
        }

        this.setupRoutes();

        this.server = this.app.listen(this.port, this.host, () => {
            console.log(`Server running on ${this.host}:${this.port}`);
            console.log(`USSD: POST http://${this.host}:${this.port}/api/ussd`);
            console.log(`Health: GET http://${this.host}:${this.port}/api/health`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
    }

    async shutdown() {
        console.log('Shutting down server...');
        if (this.server) {
            this.server.close(() => {
                console.log('Server closed');
                process.exit(0);
            });
        }
    }
}

// Start application
const app = new USSDApp();
app.start().catch(error => {
    console.error('Failed to start:', error);
    process.exit(1);
});

module.exports = app.app;