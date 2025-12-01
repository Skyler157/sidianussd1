// src/services/cache.service.js
const redisService = require('../config/redis');

class CacheService {
  constructor() {
    this.prefix = 'cache:';
  }

  async get(key) {
    try {
      const data = await redisService.get(this.prefix + key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error.message);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 300) {
    try {
      await redisService.set(
        this.prefix + key,
        JSON.stringify(value),
        ttlSeconds
      );
      return true;
    } catch (error) {
      console.error('Cache set error:', error.message);
      return false;
    }
  }

  async delete(key) {
    try {
      await redisService.del(this.prefix + key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error.message);
      return false;
    }
  }

  async clearPattern(pattern) {
    try {
      // Note: Redis cluster doesn't support KEYS command
      // For production, use SCAN or maintain a key index
      console.warn('Pattern clearing not available in Redis cluster');
      return false;
    } catch (error) {
      console.error('Cache clear error:', error.message);
      return false;
    }
  }

  async healthCheck() {
    try {
      const testKey = 'health_test_' + Date.now();
      const testValue = { test: true, timestamp: Date.now() };
      
      await this.set(testKey, testValue, 5);
      const retrieved = await this.get(testKey);
      await this.delete(testKey);
      
      const success = retrieved && retrieved.test === true;
      return {
        healthy: success,
        message: success ? 'Cache service is working' : 'Cache test failed'
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
}

module.exports = new CacheService();