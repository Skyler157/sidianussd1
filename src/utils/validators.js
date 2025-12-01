const moment = require('moment-timezone');

class Validators {
  // Validate MSISDN
  validateMsisdn(msisdn, network = null) {
    if (!msisdn || typeof msisdn !== 'string') return false;
    
    // Check length
    if (msisdn.length !== 10) return false;
    
    // Check if all digits
    if (!/^\d+$/.test(msisdn)) return false;
    
    // Check prefix based on network
    if (network === 'Telkom') {
      return msisdn.startsWith('07');
    }
    
    // Default: Safaricom/Airtel
    return msisdn.startsWith('07') || msisdn.startsWith('01');
  }

  // Validate amount
  validateAmount(amount, rules = {}) {
    if (!amount || typeof amount !== 'string') return false;
    
    // Check if all digits
    if (!/^\d+$/.test(amount)) return false;
    
    const amountNum = parseInt(amount, 10);
    
    // Check min amount
    const minAmount = rules.min || 1;
    if (amountNum < minAmount) return false;
    
    // Check max amount
    const maxAmount = rules.max || 1000000;
    if (amountNum > maxAmount) return false;
    
    return true;
  }

  // Validate PIN
  validatePin(pin) {
    if (!pin || typeof pin !== 'string') return false;
    
    // PIN should be 4-6 digits
    return /^\d{4,6}$/.test(pin);
  }

  // Validate date
  validateDate(dateStr, format = 'DDMMYYYY') {
    if (!dateStr || typeof dateStr !== 'string') return false;
    
    const date = moment(dateStr, format, true);
    if (!date.isValid()) return false;
    
    // Check if date is not in the future
    if (date.isAfter(moment(), 'day')) return false;
    
    // Check if date is within reasonable past (e.g., not older than 10 years)
    if (date.isBefore(moment().subtract(10, 'years'), 'day')) return false;
    
    return true;
  }

  // Validate account number
  validateAccountNumber(account) {
    if (!account || typeof account !== 'string') return false;
    
    // Basic account number validation
    // Adjust based on your bank's account number format
    return /^[0-9]{8,15}$/.test(account);
  }

  // Validate email
  validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Validate ID number (Kenyan)
  validateIdNumber(id) {
    if (!id || typeof id !== 'string') return false;
    
    // Kenyan ID validation (basic)
    return /^[0-9]{8,9}$/.test(id);
  }

  // Check if response is a navigation command
  isNavigationCommand(response) {
    if (!response || typeof response !== 'string') return false;
    
    const navCommands = ['0', '00', '000', '99', '98', 'back', 'home', 'exit'];
    return navCommands.includes(response.toLowerCase());
  }

  // Validate menu selection
  validateMenuSelection(selection, maxOptions) {
    if (!selection || typeof selection !== 'string') return false;
    
    const selectionNum = parseInt(selection, 10);
    return !isNaN(selectionNum) && selectionNum >= 0 && selectionNum <= maxOptions;
  }

  // Check if string contains only numbers
  isNumeric(str) {
    if (!str || typeof str !== 'string') return false;
    return /^\d+$/.test(str);
  }

  // Check if string contains only letters and spaces
  isAlpha(str) {
    if (!str || typeof str !== 'string') return false;
    return /^[A-Za-z\s]+$/.test(str);
  }

  // Check if string is alphanumeric
  isAlphanumeric(str) {
    if (!str || typeof str !== 'string') return false;
    return /^[A-Za-z0-9\s]+$/.test(str);
  }

  // Validate transaction reference
  validateTransactionReference(ref) {
    if (!ref || typeof ref !== 'string') return false;
    
    // Transaction reference should be alphanumeric and 8-20 chars
    return /^[A-Za-z0-9]{8,20}$/.test(ref);
  }

  // Check if amount is within daily limit
  checkDailyLimit(amount, dailyTotal, limit) {
    const newTotal = (dailyTotal || 0) + parseInt(amount, 10);
    return newTotal <= limit;
  }

  // Check if transaction count is within daily limit
  checkDailyCount(currentCount, limit) {
    return (currentCount || 0) < limit;
  }
}

module.exports = new Validators();