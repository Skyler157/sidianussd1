require('dotenv').config();

// Add error handlers at the VERY TOP
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

class USSDApp {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 7000;
        console.log('USSD App initializing...');
    }

    async initialize() {
        try {
            console.log('Connecting to services...');
            
            // Redis auto-connects in constructor
            const redisService = require('./src/config/redis');
            
            // Wait a bit for Redis to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Test Redis connection
            try {
                const testResult = await redisService.testConnection();
                console.log('Redis test:', testResult ? 'PASSED' : 'FAILED');
            } catch (error) {
                console.log('Redis test error (continuing):', error.message);
            }

            // Load configurations
            console.log('Loading menu configurations...');
            const menuService = require('./src/services/menu.service');
            await menuService.loadConfigurations();
            console.log('Configurations loaded');

            console.log('Application initialized successfully');
            return true;
            
        } catch (error) {
            console.error('Failed to initialize application:', error.message);
            console.error('Stack:', error.stack);
            // Continue anyway - the app might still work with degraded functionality
            return false;
        }
    }

    setupMiddleware() {
        console.log('Setting up middleware...');
        
        // Security middleware
        this.app.use(helmet());
        this.app.use(cors());
        this.app.use(compression());

        // Request parsing
        this.app.use(express.json({ limit: '10kb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10kb' }));

        // Request logging
        this.app.use((req, res, next) => {
            const startTime = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - startTime;
                console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
            });
            next();
        });
        
        console.log('Middleware setup complete');
    }

    setupRoutes() {
        console.log('Setting up routes...');
        
        // Import controllers here to avoid circular dependencies
        const healthController = require('./src/controllers/health.controller');
        
        // Health check endpoint
        this.app.get('/api/health', healthController.check);
        
        // Metrics endpoint
        this.app.get('/api/metrics', healthController.metrics);
        
        // USSD endpoint - load ussdController here
        this.app.post('/api/ussd', async (req, res) => {
            try {
                const ussdController = require('./src/controllers/ussd.controller');
                await ussdController.handleRequest(req, res);
            } catch (error) {
                console.error('USSD endpoint error:', error);
                res.status(500).send('end System error. Please try again.');
            }
        });

        // Redis info endpoint (protected)
        this.app.get('/api/redis/info', this.adminAuth, async (req, res) => {
            try {
                const redisService = require('./src/config/redis');
                const info = await redisService.healthCheck();
                res.json(info);
            } catch (error) {
                res.status(500).json({ status: 'error', message: error.message });
            }
        });

        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                status: 'error',
                message: 'Endpoint not found'
            });
        });
        
        console.log('Routes setup complete');
    }

    adminAuth(req, res, next) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }
        const token = authHeader.split(' ')[1];
        const adminToken = process.env.ADMIN_TOKEN || 'admin123';
        if (token !== adminToken) {
            return res.status(401).json({ status: 'error', message: 'Invalid token' });
        }
        next();
    }

    async start() {
        console.log(`Starting USSD Server on port ${this.port}...`);
        
        // Setup middleware first
        this.setupMiddleware();
        
        // Initialize services
        await this.initialize();
        
        // Setup routes
        this.setupRoutes();
        
        // Start server
        this.server = this.app.listen(this.port, process.env.HOST || '0.0.0.0', () => {
            console.log(`✓ USSD Server started successfully`);
            console.log(`  Host: ${process.env.HOST || '0.0.0.0'}`);
            console.log(`  Port: ${this.port}`);
            console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`  Timezone: ${process.env.TIMEZONE || 'Africa/Nairobi'}`);
            console.log('\n  Endpoints:');
            console.log(`  - Health: http://localhost:${this.port}/api/health`);
            console.log(`  - USSD: http://localhost:${this.port}/api/ussd (POST)`);
            console.log('\n=== Server is ready ===');
        });

        // Handle server errors
        this.server.on('error', (error) => {
            console.error('Server error:', error.message);
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${this.port} is already in use`);
                process.exit(1);
            }
        });
    }

    async stop() {
        console.log('Shutting down server...');
        try {
            const redisService = require('./src/config/redis');
            await redisService.disconnect();
            console.log('Redis disconnected');
        } catch (error) {
            console.error('Error disconnecting Redis:', error.message);
        }
        if (this.server) {
            this.server.close();
        }
        console.log('Server stopped');
        process.exit(0);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM signal');
    if (app) app.stop();
});

process.on('SIGINT', () => {
    console.log('Received SIGINT signal');
    if (app) app.stop();
});

// Start the application
const app = new USSDApp();
app.start().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
});

module.exports = app.app;