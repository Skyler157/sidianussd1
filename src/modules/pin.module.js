// src/modules/pin.module.js
const apiService = require('../services/api.service');

class PinModule {
  async processPinOrForgot(inputValue, session, context) {
    if (!inputValue) {
      return null; 
    }

    // Handle "1" for forgot PIN - go to forgot_pin_info menu
    if (inputValue === '1') {
      return {
        nextMenu: 'forgot_pin_info'
      };
    }

    // PIN validation - 0000 is a valid 4-digit PIN
    if (inputValue.length < 4 || inputValue.length > 6 || !/^\d+$/.test(inputValue)) {
      return {
        action: 'con',
        message: 'PIN must be 4-6 digits\n\nEnter PIN:',
        retryMenu: 'home'
      };
    }

    // Store PIN attempt
    await session.store('pin_attempt', inputValue);

    console.log('Calling login API for customer:', session.customerData?.customerid);

    try {
      // Login with PIN
      const loginResult = await apiService.login(
        session.customerData,
        session.msisdn,
        session,
        inputValue
      );

      console.log('Login API response:', {
        success: loginResult.success,
        status: loginResult.status,
        code: loginResult.code
      });

      if (loginResult.success) {
        // Update customer data with accounts if available
        if (loginResult.data?.ACCOUNTS) {
          const accounts = loginResult.data.ACCOUNTS.split(',').filter(a => a.trim());

          // Update session customer data
          const updatedCustomerData = {
            ...session.customerData,
            accounts: accounts
          };

          await session.updateSession({
            customerData: updatedCustomerData
          });

          // Also update local session object
          session.customerData = updatedCustomerData;
        }

        // Store authentication data
        await session.store('loginData', loginResult.data);
        await session.store('authStatus', 'authenticated');
        await session.updateSession({ authStatus: 'authenticated' });

        return {
          nextMenu: 'main_menu'
        };

      } else {
        // Handle specific error codes
        const errorCode = loginResult.status || loginResult.code;
        let errorMessage = 'Invalid PIN. Please try again.';

        switch (errorCode) {
          case '101':
            return {
              action: 'con',
              message: 'Your PIN has expired. Please enter a new PIN:',
              nextMenu: 'change_pin_forced'
            };
          case '102':
            return {
              action: 'end',
              message: 'Your account has been blocked. Please visit a branch.'
            };
          case '091':
            errorMessage = 'Invalid Login Password';
            break;
          default:
            if (loginResult.error) {
              errorMessage = loginResult.error;
            }
        }

        return {
          action: 'con',
          message: errorMessage + '\n\nEnter PIN:',
          retryMenu: 'home'
        };
      }
    } catch(error) {
      console.error('PinModule error:', error);
      return {
        action: 'con',
        message: 'Authentication error. Please try again later.\n\nEnter PIN:',
        retryMenu: 'home'
      };
    }
  }

  async validateCurrentPin(pinInput, session, context) {
    // Simple PIN validation - 4-6 digits
    if (!pinInput || pinInput.length < 4 || pinInput.length > 6 || !/^\d+$/.test(pinInput)) {
      return false;
    }

    try {
      const loginResult = await apiService.login(
        session.customerData,
        session.msisdn,
        session,
        pinInput
      );
      return loginResult.success;
    } catch (error) {
      console.error('PIN validation error:', error);
      return false;
    }
  }

  // This method is kept for backward compatibility but not used directly anymore
  async processForgotPin(session, context) {
    // Redirect to forgot_pin_info menu instead of showing direct message
    return {
      nextMenu: 'forgot_pin_info'
    };
  }
}

module.exports = new PinModule();