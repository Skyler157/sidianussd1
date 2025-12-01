const { loggingService } = require('../services/logging.service');
const { apiService } = require('../services/api.service');

class BalanceModule {
  async processBalanceRequest(response, session, context) {
    try {
      const selectedAccountIndex = await session.grab(
        session.msisdn,
        session.sessionId,
        session.shortcode,
        'selected_account'
      );
      
      if (!selectedAccountIndex || !session.customerData.accounts) {
        return {
          error: true,
          errorMessage: 'No account selected',
          retryMenu: 'balance'
        };
      }

      const account = session.customerData.accounts[selectedAccountIndex - 1];
      const alias = session.customerData.aliases?.[selectedAccountIndex - 1] || account;
      
      // Get balance from API
      const result = await apiService.getBalance(account, session.customerData, session);
      
      if (result.success) {
        const balance = result.data[3] || '0.00';
        const available = result.data[4] || balance;
        
        loggingService.info('Balance check successful', {
          msisdn: session.msisdn,
          account,
          balance
        });
        
        return {
          action: 'end',
          message: `Account: ${alias}\nAvailable Balance: KES ${available}\nActual Balance: KES ${balance}\n\nThank you for using Sidian Bank.`
        };
      } else {
        return {
          action: 'con',
          message: `Unable to fetch balance: ${result.message}\n\n1. Try again\n2. Back to menu`
        };
      }

    } catch (error) {
      loggingService.logError(error, {
        msisdn: session.msisdn,
        module: 'balance'
      });
      
      return {
        action: 'end',
        message: 'Sorry, we encountered an error fetching your balance. Please try again later.'
      };
    }
  }
}

module.exports = new BalanceModule();