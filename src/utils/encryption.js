const crypto = require('crypto');
const CryptoJS = require('crypto-js');

class Encryption {
  constructor() {
    this.key = Buffer.from(process.env.ENCRYPTION_KEY || 'default-key-32-bytes-long-here!', 'utf8');
    this.iv = Buffer.from(process.env.IV_KEY || 'default-iv-16-bytes', 'utf8');
    this.algorithm = 'aes-256-cbc';
  }

  // Encrypt PIN (matching PHP encryption)
  encryptPin(pin) {
    if (!pin) return null;
    
    try {
      // Use AES-256-CBC to match PHP encryption
      const cipher = crypto.createCipheriv(this.algorithm, this.key, this.iv);
      let encrypted = cipher.update(pin, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      return encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
      return null;
    }
  }

  // Decrypt PIN
  decryptPin(encryptedPin) {
    if (!encryptedPin) return null;
    
    try {
      // Decrypt using AES-256-CBC
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, this.iv);
      let decrypted = decipher.update(encryptedPin, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      return encryptedPin; // Return as-is if decryption fails
    }
  }

  // Mask PIN in logs
  maskPin(pin) {
    if (!pin) return '';
    if (pin.length <= 4) return '****';
    return `${pin.substring(0, 2)}**${pin.substring(pin.length - 2)}`;
  }

  // Generate unique transaction ID
  generateTransactionId() {
    return crypto.randomBytes(16).toString('hex');
  }

  // Hash data for verification
  hashData(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Verify data integrity
  verifyHash(data, hash) {
    return this.hashData(data) === hash;
  }
}

module.exports = new Encryption();