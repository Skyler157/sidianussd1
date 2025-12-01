const { loggingService } = require('../services/logging.service');
const { apiService } = require('../services/api.service');
const { validators } = require('../utils/validators');
const { encryption } = require('../utils/encryption');

class PinModule {
  async processPinOrForgot(response, session, context) {
    try {
      if (response === '1') {
        // Forgot PIN flow
        return {
          nextMenu: 'forgot_pin',
          message: 'To reset your PIN:\n\n1. Visit any Sidian Bank branch\n2. Call 0711058000\n\n0. Back\n00. Exit'
        };
      }

      // Regular PIN validation
      if (!validators.validatePin(response)) {
        return {
          error: true,
          errorMessage: 'PIN must be 4-6 digits',
          retryMenu: 'home'
        };
      }

      // Store PIN attempt
      await session.store(
        session.msisdn,
        session.sessionId,
        session.shortcode,
        'pin_attempt',
        response
      );

      // Login with PIN
      const loginResult = await apiService.login(
        session.customerData,
        session.msisdn,
        session,
        response
      );

      if (loginResult.success) {
        // Update customer data with accounts
        session.customerData.accounts = loginResult.data[3]?.split(',') || [];
        session.customerData.aliases = loginResult.data[3]?.split(',').map(acc => {
          const parts = acc.split('-');
          return parts[1] || parts[0];
        }) || [];
        
        await session.updateSession(
          session.msisdn,
          session.sessionId,
          session.shortcode,
          {
            customerData: session.customerData,
            authStatus: 'authenticated'
          }
        );

        return {
          nextMenu: 'mobilebanking'
        };
      } else {
        // Handle login errors
        let errorMessage = 'Invalid PIN';
        
        if (loginResult.status === '101') {
          // PIN change required
          return {
            nextMenu: 'change_pin_forced',
            message: 'Your PIN has expired. Please enter a new PIN:'
          };
        } else if (loginResult.status === '102') {
          // Account blocked
          return {
            action: 'end',
            message: 'Your account has been blocked due to exceeded PIN attempts. Please visit a branch or call 0711058000.'
          };
        }
        
        return {
          error: true,
          errorMessage: errorMessage,
          retryMenu: 'home'
        };
      }

    } catch (error) {
      loggingService.logError(error, {
        msisdn: session.msisdn,
        module: 'pin'
      });
      
      return {
        action: 'end',
        message: 'Authentication error. Please try again later.'
      };
    }
  }
}

module.exports = new PinModule();