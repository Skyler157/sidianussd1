const { loggingService } = require('../services/logging.service');

class AuthMiddleware {
  // IP Whitelist middleware
  ipWhitelist(req, res, next) {
    const clientIp = req.ip || req.connection.remoteAddress;
    const allowedIPs = process.env.IP_WHITELIST ? 
      process.env.IP_WHITELIST.split(',').map(ip => Buffer.from(ip, 'base64').toString()) : [];
    
    // If no whitelist configured, allow all (for development)
    if (allowedIPs.length === 0) {
      loggingService.warn('No IP whitelist configured, allowing all IPs');
      return next();
    }
    
    // Check if IP is in whitelist
    if (allowedIPs.includes(clientIp)) {
      return next();
    }
    
    loggingService.warn('IP not in whitelist', { 
      ip: clientIp, 
      allowedIPs: allowedIPs.map(ip => this.maskIp(ip)) 
    });
    
    return res.status(401).send('end Unauthorized access');
  }

  // Rate limiting per MSISDN
  async rateLimitByMsisdn(req, res, next) {
    const msisdn = req.body.msisdn;
    if (!msisdn) return next();
    
    const sessionService = require('../services/session.service');
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
    const maxRequests = parseInt(process.env.RATE_LIMIT_PER_MSISDN) || 5;
    
    const rateLimitKey = `rate_limit:${msisdn}`;
    const redis = sessionService.redis;
    
    try {
      const current = await redis.get(rateLimitKey);
      
      if (!current) {
        // First request in window
        await redis.setex(rateLimitKey, windowMs / 1000, 1);
        return next();
      }
      
      const count = parseInt(current, 10);
      
      if (count >= maxRequests) {
        loggingService.warn('Rate limit exceeded', { msisdn, count, maxRequests });
        return res.status(429).send('end Too many requests. Please try again later.');
      }
      
      // Increment count
      await redis.incr(rateLimitKey);
      next();
      
    } catch (error) {
      loggingService.error('Rate limiting error', { error: error.message });
      next(); // Allow request if rate limiting fails
    }
  }

  // Validate USSD request parameters
  validateUssdRequest(req, res, next) {
    const { msisdn, sessionid, shortcode } = req.body;
    
    if (!msisdn || !sessionid) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Missing required parameters: msisdn and sessionid are required' 
      });
    }
    
    // Validate MSISDN format
    if (!/^254[0-9]{9}$/.test(msisdn)) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Invalid MSISDN format. Must be 254XXXXXXXXX' 
      });
    }
    
    // Validate session ID
    if (sessionid.length < 3 || sessionid.length > 50) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Invalid session ID length' 
      });
    }
    
    next();
  }

  // Check session timeout
  async checkSessionTimeout(req, res, next) {
    const { msisdn, sessionid, shortcode } = req.body;
    const sessionService = require('../services/session.service');
    
    try {
      const sessionTime = await sessionService.getSessionTimeElapsed(msisdn, sessionid, shortcode);
      
      if (sessionTime > sessionService.ttl) {
        // Session expired
        await sessionService.clearSession(msisdn, sessionid, shortcode);
        req.sessionExpired = true;
      }
      
      next();
    } catch (error) {
      next(); // Continue even if check fails
    }
  }

  // Mask IP for logging
  maskIp(ip) {
    if (!ip) return 'unknown';
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.***.***`;
    }
    return ip;
  }
}

module.exports = new AuthMiddleware();