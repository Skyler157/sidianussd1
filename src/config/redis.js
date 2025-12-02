const redis = require('redis');

class RedisService {
    constructor() {
        console.log('[Redis] Initializing Redis cluster...');
        
        // Start with one node, cluster will discover others
        this.client = redis.createCluster({
            rootNodes: [
                {
                    socket: {
                        host: process.env.REDIS_HOST || '172.17.40.25',
                        port: parseInt(process.env.REDIS_PORT) || 6380
                    }
                }
            ],
            defaults: {
                socket: {
                    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT) || 10000
                },
                password: process.env.REDIS_PASSWORD || 'bitnami123'
            },
            useReplicas: true 
        });

        this.isReady = false;
        this.connectionPromise = null;
        
        this.client.on('ready', () => {
            this.isReady = true;
            console.log('[Redis] Cluster ready');
        });

        this.client.on('error', (err) => {
            this.isReady = false;
            console.error('[Redis] Error:', err.message);
        });

        this.client.on('nodeAdded', () => {
            console.log('[Redis] Node added to cluster');
        });

        // Connect immediately and store the promise
        this.connectionPromise = this.client.connect().catch(err => {
            console.error('[Redis] Connection failed:', err.message);
            throw err;
        });
    }

    // Wait for connection to be ready
    async waitForConnection(timeout = 10000) {
        if (this.isReady) {
            return true;
        }
        
        if (this.connectionPromise) {
            // Wait for the initial connection
            try {
                await Promise.race([
                    this.connectionPromise,
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Redis connection timeout')), timeout)
                    )
                ]);
                return true;
            } catch (error) {
                console.error('[Redis] Wait for connection failed:', error.message);
                return false;
            }
        }
        
        // If no connection promise yet, wait a bit
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.isReady;
    }

    async set(key, value, ttlSeconds = null) {
        try {
            await this.waitForConnection();
            if (ttlSeconds) {
                return await this.client.set(key, value, { EX: ttlSeconds });
            }
            return await this.client.set(key, value);
        } catch (err) {
            console.error('[Redis] SET error:', err.message);
            throw err;
        }
    }

    async get(key) {
        try {
            await this.waitForConnection();
            return await this.client.get(key);
        } catch (err) {
            console.error('[Redis] GET error:', err.message);
            throw err;
        }
    }

    async del(key) {
        try {
            await this.waitForConnection();
            return await this.client.del(key);
        } catch (err) {
            console.error('[Redis] DEL error:', err.message);
            throw err;
        }
    }

    async healthCheck() {
        try {
            await this.waitForConnection();
            await this.client.set('health_check', 'test', { EX: 1 });
            return { status: 'healthy', message: 'Redis Cluster is ready' };
        } catch (err) {
            return { status: 'error', message: err.message };
        }
    }

    async testConnection() {
        try {
            await this.waitForConnection();
            const testKey = 'redis_test_' + Math.random().toString(36).substring(7);
            const testValue = 'test_value';

            await this.set(testKey, testValue, 5);
            const retrieved = await this.get(testKey);
            await this.del(testKey);

            const success = retrieved === testValue;
            if (success) {
                console.log('[Redis] Connection test PASSED');
            } else {
                console.error('[Redis] Connection test FAILED - value mismatch');
            }
            return success;
        } catch (err) {
            console.error('[Redis] Connection test failed:', err.message);
            return false;
        }
    }

    async disconnect() {
        try {
            await this.waitForConnection();
            await this.client.quit();
            console.log('[Redis] Disconnected');
        } catch (err) {
            console.error('[Redis] Disconnect error:', err.message);
        }
    }
}

module.exports = new RedisService();