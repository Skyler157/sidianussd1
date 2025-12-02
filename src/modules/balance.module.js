// src/modules/balance.module.js
const apiService = require('../services/api.service');

class BalanceModule {
  async processBalanceRequest(inputValue, session, context) {
    const accounts = context.customer?.accounts || [];

    // Initial render - show account list
    if (!inputValue) {
      if (accounts.length === 0) {
        return {
          action: 'con',
          message: 'No accounts found.\n\n0. Back\n00. Exit',
          retryMenu: 'my_account'
        };
      }

      let message = 'Select Account:\n';
      accounts.forEach((account, index) => {
        message += `${index + 1}. ${this.formatAccountNumber(account)}\n`;
      });
      message += '\n0. Back\n00. Exit';

      return {
        action: 'con',
        message: message
      };
    }

    // Validate selection (only numbers 1-9)
    if (!/^\d+$/.test(inputValue)) {
      return {
        action: 'con',
        message: 'Invalid selection. Please enter a number.\n\n0. Back\n00. Exit',
        retryMenu: 'balance'
      };
    }

    const key = parseInt(inputValue) - 1;
    
    if (key < 0 || key >= accounts.length) {
      return {
        action: 'con',
        message: 'Invalid account selection.\n\n0. Back\n00. Exit',
        retryMenu: 'balance'
      };
    }

    // Store selected account
    const selectedAccount = accounts[key];
    await session.store('balance_selected_account', selectedAccount);

    // Move to PIN entry
    return {
      nextMenu: 'balance_pin'
    };
  }

  async processBalancePin(inputValue, session, context) {
    const customer = context.customer || {};
    const customerName = customer.firstname || customer.lastname || 'Customer';
    
    // Get stored account
    const selectedAccount = await session.grab('balance_selected_account');

    // Initial render - show PIN prompt
    if (!inputValue) {
      if (!selectedAccount) {
        return {
          action: 'con',
          message: 'No account selected.\n\n0. Back\n00. Exit',
          retryMenu: 'balance'
        };
      }

      return {
        action: 'con',
        message: `Enter your PIN to check balance for account ${this.formatAccountNumber(selectedAccount)}:\n\n0. Back\n00. Exit`
      };
    }

    // Validate PIN format
    if (inputValue.length < 4 || inputValue.length > 6 || !/^\d+$/.test(inputValue)) {
      return {
        action: 'con',
        message: 'PIN must be 4-6 digits\n\nEnter your PIN:\n\n0. Back\n00. Exit',
        retryMenu: 'balance_pin'
      };
    }

    // Store PIN attempt
    await session.store('balance_pin_attempt', inputValue);

    // Verify PIN with login API
    try {
      const loginResult = await apiService.login(
        session.customerData,
        session.msisdn,
        session,
        inputValue
      );

      if (loginResult.success) {
        // PIN is valid, proceed to fetch balance
        return await this.fetchBalance(session, context);
      } else {
        // PIN is invalid
        const errorMsg = loginResult.error || 'Invalid PIN';
        return {
          action: 'con',
          message: `${errorMsg}\n\nEnter your PIN:\n\n0. Back\n00. Exit`,
          retryMenu: 'balance_pin'
        };
      }
    } catch (error) {
      return {
        action: 'con',
        message: 'PIN verification failed. Please try again.\n\nEnter your PIN:\n\n0. Back\n00. Exit',
        retryMenu: 'balance_pin'
      };
    }
  }

  async fetchBalance(session, context) {
    try {
      const selectedAccount = await session.grab('balance_selected_account');
      const customer = context.customer || {};
      const customerId = customer.customerid;
      const msisdn = session.msisdn;
      const customerName = customer.firstname || customer.lastname || 'Customer';

      if (!selectedAccount || !customerId) {
        throw new Error('Missing account or customer ID');
      }

      const data = `MERCHANTID:BALANCE:BANKACCOUNTID:${selectedAccount}:CUSTOMERID:${customerId}:MOBILENUMBER:${msisdn}`;
      const balanceResult = await apiService.call('B-', data, session);

      // Clear stored data
      await session.blank('balance_selected_account');
      await session.blank('balance_pin_attempt');

      return this.handleBalanceResponse(balanceResult, customerName);

    } catch (error) {
      // Clear stored data on error too
      await session.blank('balance_selected_account');
      await session.blank('balance_pin_attempt');
      
      return this.handleBalanceError(error, context);
    }
  }

  handleBalanceResponse(balanceResult, customerName) {
    if (balanceResult.success || balanceResult.status === '000' || balanceResult.status === 'OK') {
      const message = balanceResult.data.MESSAGE || balanceResult.data.DATA || '';
      let formattedMessage = this.parsePipeSeparatedResponse(message);

      if (!formattedMessage) {
        formattedMessage = 'Balance inquiry successful.';
      }

      return {
        action: 'con',
        message: `${formattedMessage}\n\n0. Back\n00. Exit`,
        nextMenu: 'main_menu'
      };
    } else {
      const errorMsg = balanceResult.error || balanceResult.message || 'Service temporarily unavailable';
      return {
        action: 'con',
        message: `Dear ${customerName}, ${errorMsg}\n\n0. Back\n00. Exit`,
        nextMenu: 'main_menu'
      };
    }
  }

  parsePipeSeparatedResponse(message) {
    if (!message || !message.includes('|')) {
      return message;
    }

    const parts = message.split('|');
    let result = '';

    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i] && parts[i + 1]) {
        result += `${parts[i]}: ${parts[i + 1]}\n`;
      }
    }

    return result.trim();
  }

  handleBalanceError(error, context) {
    const customer = context.customer || {};
    const customerName = customer.firstname || customer.lastname || 'Customer';

    return {
      action: 'con',
      message: `Dear ${customerName}, sorry the service is temporarily unavailable. Please try again later.\n\n0. Back\n00. Exit`,
      nextMenu: 'home'
    };
  }

  formatAccountNumber(account) {
    if (!account) return '';
    return account.toString().replace(/(\d{4})(?=\d)/g, '$1 ');
  }
}

module.exports = new BalanceModule();