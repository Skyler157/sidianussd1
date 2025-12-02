// src/utils/encryption.js
class Encryption {
  async decryptPin(encryptedPin) {
    // For now, just return the input as-is (no decryption)
    console.log('PIN decryption disabled, returning as-is:', encryptedPin?.substring(0, 3) + '***');
    return encryptedPin;
  }
  
  async encryptPin(pin) {
    return pin; // Stub for now
  }
}

module.exports = new Encryption();