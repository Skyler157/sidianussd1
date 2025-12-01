const { loggingService } = require('../services/logging.service');
const { apiService } = require('../services/api.service');
const { validators } = require('../utils/validators');

class AirtimeModule {
  async processAirtimeConfirmation(response, session, context) {
    try {
      if (response !== '1') {
        return {
          nextMenu: 'mobilebanking',
          message: 'Airtime purchase cancelled.'
        };
      }

      // Get stored data
      const network = context.network || await session.grab(session.msisdn, session.sessionId, session.shortcode, 'network');
      const merchantId = context.merchantId || await session.grab(session.msisdn, session.sessionId, session.shortcode, 'merchantId');
      const amount = context.airtime_amount || await session.grab(session.msisdn, session.sessionId, session.shortcode, 'airtime_amount');
      const airtimeMode = await session.grab(session.msisdn, session.sessionId, session.shortcode, 'airtime_mode');
      
      let mobileNumber;
      if (airtimeMode === 'own') {
        mobileNumber = session.msisdn;
      } else if (airtimeMode === 'other') {
        // In real implementation, you'd ask for number first
        mobileNumber = await session.grab(session.msisdn, session.sessionId, session.shortcode, 'airtime_recipient');
      }
      
      // Validate
      if (!validators.validateMsisdn(mobileNumber)) {
        return {
          error: true,
          errorMessage: 'Invalid mobile number',
          retryMenu: 'airtime'
        };
      }

      // Get PIN from session
      const pin = await session.grab(session.msisdn, session.sessionId, session.shortcode, 'transaction_pin');
      
      if (!pin) {
        return {
          nextMenu: 'pin',
          store: { redirectAfterPin: 'airtime_confirm' }
        };
      }

      // Make API call
      const result = await apiService.airtimePurchase(
        merchantId,
        session.customerData.accounts[0], // First account
        mobileNumber,
        amount,
        pin,
        session
      );

      if (result.success) {
        // Log transaction
        loggingService.logTransaction(
          session.msisdn,
          'airtime_purchase',
          amount,
          'success',
          result.data[2] // Reference
        );

        return {
          action: 'end',
          message: `Airtime purchase successful!\n\nNetwork: ${network}\nAmount: KES ${amount}\nReference: ${result.data[2] || 'N/A'}\n\nThank you for using Sidian Bank.`
        };
      } else {
        return {
          action: 'con',
          message: `Airtime purchase failed: ${result.message}\n\n1. Try again\n2. Cancel`
        };
      }

    } catch (error) {
      loggingService.logError(error, {
        msisdn: session.msisdn,
        module: 'airtime'
      });
      
      return {
        action: 'end',
        message: 'Sorry, we encountered an error processing your airtime purchase. Please try again later.'
      };
    }
  }

  async validateAirtimeAmount(amount, context) {
    const min = 10;
    const max = 5000;
    
    if (!validators.validateAmount(amount, { min, max })) {
      return `Amount must be between KES ${min} and KES ${max}`;
    }
    
    // Check daily limits
    const dailySpent = await this.getDailyAirtimeSpent(context.customer.customerid);
    const dailyLimit = 10000; // From business rules
    
    if (dailySpent + parseInt(amount) > dailyLimit) {
      return `Daily airtime limit exceeded. You can only purchase KES ${dailyLimit - dailySpent} more today.`;
    }
    
    return true;
  }

  async getDailyAirtimeSpent(customerId) {
    // In real implementation, query Redis/database for daily transactions
    return 0;
  }
}

module.exports = new AirtimeModule();