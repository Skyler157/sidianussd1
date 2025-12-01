const { loggingService } = require('../services/logging.service');
const { apiService } = require('../services/api.service');

class StatementModule {
  async processStatementRequest(response, session, context) {
    try {
      const selectedAccountIndex = await session.grab(
        session.msisdn,
        session.sessionId,
        session.shortcode,
        'statement_account'
      );
      
      if (!selectedAccountIndex || !session.customerData.accounts) {
        return {
          error: true,
          errorMessage: 'No account selected',
          retryMenu: 'statement'
        };
      }

      const account = session.customerData.accounts[selectedAccountIndex - 1];
      const alias = session.customerData.aliases?.[selectedAccountIndex - 1] || account;
      
      // Get mini statement from API
      const result = await apiService.getMiniStatement(account, session.customerData, session);
      
      if (result.success) {
        const transactions = this.parseStatementResponse(result.data);
        
        let message = `Mini Statement for ${alias}:\n\n`;
        
        if (transactions.length === 0) {
          message += 'No recent transactions.\n';
        } else {
          transactions.forEach((txn, index) => {
            if (index < 5) { // Show only last 5 transactions
              message += `${txn.date} - ${txn.description}\n${txn.type} KES ${txn.amount}\nBalance: KES ${txn.balance}\n\n`;
            }
          });
        }
        
        message += 'Thank you for using Sidian Bank.';
        
        loggingService.info('Statement request successful', {
          msisdn: session.msisdn,
          account,
          transactionCount: transactions.length
        });
        
        return {
          action: 'end',
          message: message
        };
      } else {
        return {
          action: 'con',
          message: `Unable to fetch statement: ${result.message}\n\n1. Try again\n2. Back to menu`
        };
      }

    } catch (error) {
      loggingService.logError(error, {
        msisdn: session.msisdn,
        module: 'statement'
      });
      
      return {
        action: 'end',
        message: 'Sorry, we encountered an error fetching your statement. Please try again later.'
      };
    }
  }

  parseStatementResponse(data) {
    // Parse API response into transaction objects
    // This depends on your API response format
    const transactions = [];
    
    // Example parsing logic
    if (data && data.length > 10) {
      // Assuming transactions start from index 10
      for (let i = 10; i < data.length; i += 5) {
        if (data[i]) {
          transactions.push({
            date: data[i] || '',
            description: data[i + 1] || '',
            type: data[i + 2] || '',
            amount: data[i + 3] || '0.00',
            balance: data[i + 4] || '0.00'
          });
        }
      }
    }
    
    return transactions;
  }
}

module.exports = new StatementModule();