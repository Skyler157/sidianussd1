const { validationResult, body } = require('express-validator');
const { loggingService } = require('../services/logging.service');
const { validators } = require('../utils/validators');

class ValidatorMiddleware {
  // Validate USSD request body
  ussdRequestValidation = [
    body('msisdn')
      .trim()
      .notEmpty().withMessage('MSISDN is required')
      .matches(/^254[0-9]{9}$/).withMessage('Invalid MSISDN format. Must be 254XXXXXXXXX'),
    
    body('sessionid')
      .trim()
      .notEmpty().withMessage('Session ID is required')
      .isLength({ min: 3, max: 50 }).withMessage('Session ID must be 3-50 characters'),
    
    body('shortcode')
      .optional()
      .trim()
      .matches(/^[0-9]{3,6}$/).withMessage('Invalid shortcode format'),
    
    body('response')
      .optional()
      .trim()
      .isLength({ max: 500 }).withMessage('Response too long'),
    
    this.handleValidationErrors
  ];

  // Validate amount input
  validateAmount(min = 1, max = 1000000) {
    return [
      body('amount')
        .trim()
        .notEmpty().withMessage('Amount is required')
        .custom(value => validators.validateAmount(value, { min, max }))
        .withMessage(`Amount must be between ${min} and ${max}`),
      this.handleValidationErrors
    ];
  }

  // Validate MSISDN input
  validateMsisdn() {
    return [
      body('msisdn')
        .trim()
        .notEmpty().withMessage('Mobile number is required')
        .custom(value => validators.validateMsisdn(value))
        .withMessage('Invalid mobile number format'),
      this.handleValidationErrors
    ];
  }

  // Validate PIN input
  validatePin() {
    return [
      body('pin')
        .trim()
        .notEmpty().withMessage('PIN is required')
        .custom(value => validators.validatePin(value))
        .withMessage('PIN must be 4-6 digits'),
      this.handleValidationErrors
    ];
  }

  // Validate date input
  validateDate() {
    return [
      body('date')
        .trim()
        .notEmpty().withMessage('Date is required')
        .custom(value => validators.validateDate(value))
        .withMessage('Invalid date format (DDMMYYYY)'),
      this.handleValidationErrors
    ];
  }

  // Handle validation errors
  handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map(err => err.msg);
      loggingService.warn('Validation failed', {
        errors: errorMessages,
        path: req.path,
        method: req.method
      });
      
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errorMessages
      });
    }
    
    next();
  }

  // Custom validator for business rules
  validateBusinessRule(ruleType, field) {
    return (req, res, next) => {
      const value = req.body[field];
      const businessRules = require('../../config/business-rules.json');
      
      const rule = businessRules[ruleType];
      if (!rule) {
        return next();
      }
      
      // Implement specific business rule validation
      switch (ruleType) {
        case 'transactionLimits':
          // Validate against transaction limits
          if (value && rule[field]) {
            const amount = parseInt(value, 10);
            const limits = rule[field];
            
            if (amount < limits.minAmount) {
              return res.status(400).json({
                status: 'error',
                message: `Amount must be at least ${limits.minAmount}`
              });
            }
            
            if (amount > limits.maxAmount) {
              return res.status(400).json({
                status: 'error',
                message: `Amount cannot exceed ${limits.maxAmount}`
              });
            }
          }
          break;
          
        case 'validationRules':
          // Apply validation rules
          if (value && rule[field]) {
            const validationRule = rule[field];
            
            if (validationRule.pattern && !new RegExp(validationRule.pattern).test(value)) {
              return res.status(400).json({
                status: 'error',
                message: `Invalid ${field} format`
              });
            }
          }
          break;
      }
      
      next();
    };
  }

  // Sanitize input data
  sanitizeInput(req, res, next) {
    // Sanitize all string fields
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = this.sanitizeString(req.body[key]);
      }
    });
    
    next();
  }

  sanitizeString(str) {
    if (!str) return str;
    
    // Remove HTML tags
    str = str.replace(/<[^>]*>/g, '');
    
    // Remove script tags
    str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Escape special characters
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;'
    };
    
    return str.replace(/[&<>"'/]/g, match => escapeMap[match]);
  }
}

module.exports = new ValidatorMiddleware();