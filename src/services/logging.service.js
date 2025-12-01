const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const moment = require('moment-timezone');
// REMOVE: const { sessionService } = require('./session.service');

class LoggingService {
  constructor() {
    this.timezone = process.env.TIMEZONE || 'Africa/Nairobi';
    this.logPath = process.env.LOG_PATH || './logs';
    this.setupLogger();
  }

  setupLogger() {
    // Custom format for USSD logs
    const ussdFormat = winston.format.combine(
      winston.format.timestamp({
        format: () => moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss')
      }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaString = Object.keys(meta).length > 0 
          ? ` ${JSON.stringify(this.maskSensitiveData(meta))}` 
          : '';
        return `${timestamp} - ${message}${metaString}`;
      })
    );

    // Create logger instance
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: ussdFormat,
      transports: [
        // Console transport (development)
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            ussdFormat
          ),
          silent: process.env.NODE_ENV === 'production'
        }),

        // Daily rotate file for all logs
        new DailyRotateFile({
          filename: path.join(this.logPath, 'ussd-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: process.env.LOG_MAX_SIZE || '20m',
          maxFiles: process.env.LOG_MAX_FILES || '30d',
          format: ussdFormat
        }),

        // Error log file
        new winston.transports.File({
          filename: path.join(this.logPath, 'error.log'),
          level: 'error',
          format: ussdFormat
        }),

        // USSD transaction log (separate file)
        new DailyRotateFile({
          filename: path.join(this.logPath, 'transactions-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '50m',
          maxFiles: '90d',
          level: 'info',
          format: ussdFormat
        })
      ]
    });

    // Handle uncaught exceptions
    this.logger.exceptions.handle(
      new winston.transports.File({ 
        filename: path.join(this.logPath, 'exceptions.log') 
      })
    );
  }

  // Mask sensitive information in logs
  maskSensitiveData(data) {
    if (!data || typeof data !== 'object') return data;
    
    const masked = { ...data };
    
    // Mask PINs
    if (masked.pin) masked.pin = '[MASKED]';
    if (masked.response && typeof masked.response === 'string') {
      masked.response = masked.response.replace(
        /(OLDPIN|NEWPIN|TMPIN|TRXMPIN|LOGINMPIN):([^:]+):/gi,
        '$1:[MASKED]:'
      );
    }
    
    // Mask MSISDN - ADD THIS HELPER METHOD
    if (masked.msisdn) {
      masked.msisdn = this.maskMsisdn(masked.msisdn);
    }
    
    // Mask customer data
    if (masked.customer) {
      masked.customer = { ...masked.customer };
      if (masked.customer.customerid) {
        masked.customer.customerid = `CID${masked.customer.customerid.substring(0, 3)}***`;
      }
    }
    
    return masked;
  }

  // ADD THIS HELPER METHOD
  maskMsisdn(msisdn) {
    if (!msisdn || msisdn.length < 4) return msisdn;
    return `${msisdn.substring(0, 3)}****${msisdn.substring(msisdn.length - 3)}`;
  }

  // Standard log methods
  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  // Specialized USSD logging methods - UPDATE MSISDN MASKING
  logSessionStart(msisdn, sessionId, shortcode) {
    this.info('SESSION STARTED', {
      msisdn: this.maskMsisdn(msisdn), // Use local method
      sessionId,
      shortcode,
      timestamp: moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss')
    });
  }

  logSessionEnd(msisdn, sessionId, shortcode, duration, transactionCount) {
    this.info('SESSION ENDED', {
      msisdn: this.maskMsisdn(msisdn), // Use local method
      sessionId,
      shortcode,
      duration: `${duration} seconds`,
      transactionCount,
      timestamp: moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss')
    });
  }

  logMenuDisplay(msisdn, menuName, action, messageSize, sessionTimeElapsed) {
    this.info('MENU DISPLAYED', {
      msisdn: this.maskMsisdn(msisdn), // Use local method
      menu: menuName,
      action,
      menuSize: `${messageSize} bytes`,
      sessionTimeElapsed: `${sessionTimeElapsed} seconds`
    });
  }

  logTransaction(msisdn, transactionType, amount, status, reference = null) {
    this.info('TRANSACTION PROCESSED', {
      msisdn: this.maskMsisdn(msisdn), // Use local method
      type: transactionType,
      amount,
      status,
      reference: reference || 'N/A',
      timestamp: moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss')
    });
  }

  logAPIRequest(service, msisdn, sessionId, data, url) {
    this.info('API REQUEST', {
      service,
      msisdn: this.maskMsisdn(msisdn), // Use local method
      sessionId,
      request: this.maskSensitiveData({ data }).data,
      url
    });
  }

  logAPIResponse(service, msisdn, response, processingTime, status) {
    this.info('API RESPONSE', {
      service,
      msisdn: this.maskMsisdn(msisdn), // Use local method
      response: this.maskSensitiveData({ response }).response,
      processingTime: `${processingTime}ms`,
      status
    });
  }

  logError(error, context = {}) {
    this.error('ERROR OCCURRED', {
      error: error.message,
      stack: error.stack,
      ...this.maskSensitiveData(context)
    });
  }

  // Performance logging
  logPerformance(operation, duration, meta = {}) {
    if (duration > 1000) { // Log only slow operations (>1 second)
      this.warn('PERFORMANCE WARNING', {
        operation,
        duration: `${duration}ms`,
        ...meta
      });
    }
  }

  // Audit logging for security
  logAudit(event, user, details = {}) {
    this.info('AUDIT LOG', {
      event,
      user: this.maskMsisdn(user), // Use local method
      timestamp: moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss'),
      ...this.maskSensitiveData(details)
    });
  }
}

module.exports = new LoggingService();