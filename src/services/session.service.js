// src/services/session.service.js
const { v4: uuidv4 } = require('uuid');
const moment = require('moment-timezone');
const redisService = require('../config/redis');

class SessionService {
  constructor() {
    this.ttl = parseInt(process.env.REDIS_TTL) || 300;
    this.timezone = process.env.TIMEZONE || 'Africa/Nairobi';
    this.sessionPrefix = process.env.REDIS_SESSION_PREFIX || 'ussd:session';
  }

  async store(msisdn, sessionId, shortcode, key, value) {
    try {
      await this.ensureConnection();
      const sessionKey = this.getSessionKey(msisdn, sessionId, shortcode);
      const dataKey = `${sessionKey}:${key}`;
      
      await redisService.set(dataKey, JSON.stringify(value), this.ttl);
      return value;
    } catch (error) {
      console.error('Store error:', error.message);
      throw error;
    }
  }

  // ... keep other methods the same
  async ensureConnection() {
    const maxRetries = 3;
    const retryDelay = 1000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const connected = await redisService.waitForConnection(5000);
        if (connected) {
          return true;
        }
      } catch (error) {
        console.log(`Redis connection attempt ${attempt}/${maxRetries} failed:`, error.message);
      }
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    throw new Error('Redis is not ready after multiple retries');
  }

  async createSession(msisdn, sessionId, shortcode) {
    try {
      await this.ensureConnection();
      const sessionKey = this.getSessionKey(msisdn, sessionId, shortcode);
      const now = moment().tz(this.timezone);
      
      const sessionData = {
        sessionId,
        msisdn,
        shortcode,
        currentMenu: 'home',
        customerData: null,
        authStatus: 'pending',
        transactionData: {},
        menuHistory: ['home'],
        flowState: {},
        sessionStart: now.format('YYYY-MM-DD HH:mm:ss'),
        lastActivity: now.format('YYYY-MM-DD HH:mm:ss'),
        sessionEnd: now.add(this.ttl, 'seconds').format('YYYY-MM-DD HH:mm:ss'),
        createdAt: Date.now(),
        transactionCount: 0,
        lastTransaction: null
      };
      
      await redisService.set(sessionKey, JSON.stringify(sessionData), this.ttl);
      
      const startKey = `${sessionKey}:start`;
      await redisService.set(startKey, Date.now().toString(), this.ttl);
      
      console.log('Session created for:', this.maskMsisdn(msisdn));
      return sessionData;
      
    } catch (error) {
      console.error('Failed to create session:', error.message);
      throw error;
    }
  }

  async getSession(msisdn, sessionId, shortcode) {
    try {
      await this.ensureConnection();
      const sessionKey = this.getSessionKey(msisdn, sessionId, shortcode);
      const sessionData = await redisService.get(sessionKey);
      
      if (!sessionData) return null;
      
      const session = JSON.parse(sessionData);
      session.lastActivity = moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss');
      
      await redisService.set(sessionKey, JSON.stringify(session), this.ttl);
      
      return session;
    } catch (error) {
      console.error('Get session error:', error.message);
      return null;
    }
  }

  async updateSession(msisdn, sessionId, shortcode, updates) {
    try {
      await this.ensureConnection();
      const sessionKey = this.getSessionKey(msisdn, sessionId, shortcode);
      const sessionData = await redisService.get(sessionKey);
      
      if (!sessionData) return null;
      
      const session = JSON.parse(sessionData);
      Object.assign(session, updates);
      session.lastActivity = moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss');
      
      await redisService.set(sessionKey, JSON.stringify(session), this.ttl);
      
      return session;
    } catch (error) {
      console.error('Update session error:', error.message);
      return null;
    }
  }

  async grab(msisdn, sessionId, shortcode, key) {
    try {
      await this.ensureConnection();
      const sessionKey = this.getSessionKey(msisdn, sessionId, shortcode);
      const dataKey = `${sessionKey}:${key}`;
      
      const data = await redisService.get(dataKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Grab error:', error.message);
      return null;
    }
  }

  async possess(msisdn, sessionId, shortcode, key) {
    try {
      await this.ensureConnection();
      const sessionKey = this.getSessionKey(msisdn, sessionId, shortcode);
      const dataKey = `${sessionKey}:${key}`;
      
      const data = await redisService.get(dataKey);
      return data !== null;
    } catch (error) {
      console.error('Possess error:', error.message);
      return false;
    }
  }

  async blank(msisdn, sessionId, shortcode, keys) {
    try {
      await this.ensureConnection();
      const sessionKey = this.getSessionKey(msisdn, sessionId, shortcode);
      
      if (Array.isArray(keys)) {
        for (const key of keys) {
          await redisService.del(`${sessionKey}:${key}`);
        }
      } else {
        await redisService.del(`${sessionKey}:${keys}`);
      }
      return true;
    } catch (error) {
      console.error('Blank error:', error.message);
      return false;
    }
  }

  async clearSession(msisdn, sessionId, shortcode) {
    try {
      await this.ensureConnection();
      const sessionKey = this.getSessionKey(msisdn, sessionId, shortcode);
      
      await redisService.del(sessionKey);
      await redisService.del(`${sessionKey}:start`);
      return true;
    } catch (error) {
      console.error('Clear session error:', error.message);
      return false;
    }
  }

  async getSessionTimeElapsed(msisdn, sessionId, shortcode) {
    try {
      await this.ensureConnection();
      const sessionKey = this.getSessionKey(msisdn, sessionId, shortcode);
      const startKey = `${sessionKey}:start`;
      
      const startTime = await redisService.get(startKey);
      if (!startTime) return 0;
      
      return Math.floor((Date.now() - parseInt(startTime)) / 1000);
    } catch (error) {
      console.error('Get session time error:', error.message);
      return 0;
    }
  }

  getSessionKey(msisdn, sessionId, shortcode) {
    return `${this.sessionPrefix}:${msisdn}:${sessionId}:${shortcode || 'default'}`;
  }

  generateUniqueId() {
    return uuidv4();
  }

  maskMsisdn(msisdn) {
    if (!msisdn || msisdn.length < 4) return msisdn;
    return `${msisdn.substring(0, 3)}****${msisdn.substring(msisdn.length - 3)}`;
  }

  async incrementTransactionCount(msisdn, sessionId, shortcode) {
    try {
      const session = await this.getSession(msisdn, sessionId, shortcode);
      if (session) {
        session.transactionCount = (session.transactionCount || 0) + 1;
        session.lastTransaction = moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss');
        await this.updateSession(msisdn, sessionId, shortcode, session);
      }
    } catch (error) {
      console.error('Increment transaction count error:', error.message);
    }
  }

  async getTransactionCount(msisdn, sessionId, shortcode) {
    try {
      const session = await this.getSession(msisdn, sessionId, shortcode);
      return session ? session.transactionCount || 0 : 0;
    } catch (error) {
      console.error('Get transaction count error:', error.message);
      return 0;
    }
  }

  async healthCheck() {
    try {
      const redisHealth = await redisService.healthCheck();
      return {
        healthy: redisHealth.status === 'healthy',
        redis: redisHealth,
        service: 'session'
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        service: 'session'
      };
    }
  }
}

const sessionService = new SessionService();
module.exports = sessionService;