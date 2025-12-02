// src/utils/validators.js
class Validators {
  validateMsisdn(msisdn, network = null) {
    if (!msisdn || typeof msisdn !== 'string') return false;
    
    // Clean the number
    const cleanMsisdn = msisdn.replace(/\D/g, '');
    
    // Basic length check
    if (cleanMsisdn.length < 10 || cleanMsisdn.length > 12) {
      return false;
    }
    
    return true;
  }

  validateAmount(amount, rules = {}) {
    if (!amount || typeof amount !== 'string') return false;
    
    // Check if numeric
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return false;
    }
    
    // Apply min/max rules if provided
    if (rules.min !== undefined && numericAmount < rules.min) {
      return false;
    }
    
    if (rules.max !== undefined && numericAmount > rules.max) {
      return false;
    }
    
    return true;
  }

  validateDate(dateString, format = 'DDMMYYYY') {
    if (!dateString || typeof dateString !== 'string') return false;
    
    try {
      const moment = require('moment-timezone');
      let date;
      
      switch (format) {
        case 'DDMMYYYY':
          date = moment(dateString, 'DDMMYYYY', true);
          break;
        case 'YYYY-MM-DD':
          date = moment(dateString, 'YYYY-MM-DD', true);
          break;
        case 'DD/MM/YYYY':
          date = moment(dateString, 'DD/MM/YYYY', true);
          break;
        default:
          date = moment(dateString, true);
      }
      
      return date.isValid();
    } catch (error) {
      console.error('Date validation error:', error);
      return false;
    }
  }

  validatePin(pin) {
    if (!pin || typeof pin !== 'string') return false;
    
    // Check length (4-6 digits)
    if (pin.length < 4 || pin.length > 6) {
      return false;
    }
    
    // Check if all digits
    if (!/^\d+$/.test(pin)) {
      return false;
    }
    
    return true;
  }
}

module.exports = new Validators();