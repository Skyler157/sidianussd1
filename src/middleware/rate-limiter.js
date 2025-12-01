const rateLimit = require('express-rate-limit');
const { loggingService } = require('../services/logging.service');

class RateLimiter {
  constructor() {
    this.globalLimiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10000,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: false,
      handler: (req, res) => {
        loggingService.warn('Global rate limit exceeded', {
          ip: req.ip,
          url: req.url,
          method: req.method
        });
        res.status(429).json({
          status: 'error',
          message: 'Too many requests. Please try again later.'
        });
      }
    });

    this.apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100,
      message: 'Too many API requests from this IP, please try again later.',
      skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/api/health' || req.path === '/api/metrics';
      }
    });
  }

  // Apply global rate limiting
  global() {
    return this.globalLimiter;
  }

  // Apply API-specific rate limiting
  api() {
    return this.apiLimiter;
  }

  // Custom rate limiter for specific endpoints
  createCustomLimiter(windowMs, max, keyGenerator = (req) => req.ip) {
    return rateLimit({
      windowMs,
      max,
      keyGenerator,
      message: 'Rate limit exceeded',
      standardHeaders: true
    });
  }
}

module.exports = new RateLimiter();