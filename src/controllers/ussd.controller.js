const { loggingService } = require('../services/logging.service');
const sessionService = require('../services/session.service');
const menuService = require('../services/menu.service');
const apiService = require('../services/api.service');
const { encryption } = require('../utils/encryption');
const { validators } = require('../utils/validators');

class UssdController {

  async handleRequest(req, res) {
    const startTime = Date.now();
    const { msisdn, sessionid, shortcode, response } = req.body;

    try {
      // Validate required parameters
      if (!msisdn || !sessionid) {
        loggingService.warn('Invalid request parameters', { msisdn, sessionid });
        return res.status(400).send('end Invalid request parameters');
      }

      // Log request
      console.info('USSD Request Received', {
        msisdn: this.maskMsisdn(msisdn),
        sessionId: sessionid,
        shortcode: shortcode || 'default',
        hasResponse: !!response
      });

      // Process the request
      const result = await this.processUssdRequest(msisdn, sessionid, shortcode, response);

      // Send response
      const ussdResponse = `${result.action} ${result.message}`;
      res.status(200).send(ussdResponse);

      // Log completion
      const duration = Date.now() - startTime;
      console.log('Request processed', {
        msisdn: this.maskMsisdn(msisdn),
        sessionId: sessionid,
        duration: `${duration}ms`
      });

    } catch (error) {
      // Use console.error if loggingService fails
      console.error('USSD request error:', error.message, error.stack);

      // Return user-friendly error
      const errorResponse = 'end Sorry, we encountered an error. Please try again later.';
      res.status(200).send(errorResponse);
    }
  }

  // Add maskMsisdn helper method
  maskMsisdn(msisdn) {
    if (!msisdn || msisdn.length < 4) return msisdn;
    return `${msisdn.substring(0, 3)}****${msisdn.substring(msisdn.length - 3)}`;
  }

  async processUssdRequest(msisdn, sessionId, shortcode, encryptedResponse) {
    // Get or create session
    let session = await sessionService.getSession(msisdn, sessionId, shortcode);

    if (!session) {
      session = await this.initializeSession(msisdn, sessionId, shortcode);
    }

    // Check session timeout
    const sessionTimeElapsed = await sessionService.getSessionTimeElapsed(msisdn, sessionId, shortcode);
    if (sessionTimeElapsed > sessionService.ttl) {
      await sessionService.clearSession(msisdn, sessionId, shortcode);
      session = await this.initializeSession(msisdn, sessionId, shortcode);
    }

    // Process based on current menu
    let result;
    if (session.currentMenu === 'home' && !session.customerData) {
      result = await this.handleHomeMenu(session, encryptedResponse);
    } else {
      result = await this.handleRegularMenu(session, encryptedResponse);
    }

    // Update session state
    if (result.nextMenu) {
      await this.updateSessionState(session, result.nextMenu);
    }

    // Handle session termination
    if (result.action === 'end') {
      await this.terminateSession(session);
    }

    // Log menu display
    loggingService.logMenuDisplay(
      msisdn,
      result.name || session.currentMenu,
      result.action,
      Buffer.byteLength(result.message, 'utf8'),
      sessionTimeElapsed
    );

    return result;
  }

  async initializeSession(msisdn, sessionId, shortcode) {
    const session = await sessionService.createSession(msisdn, sessionId, shortcode);
    loggingService.logSessionStart(msisdn, sessionId, shortcode);
    return session;
  }

  async terminateSession(session) {
    const transactionCount = await sessionService.getTransactionCount(
      session.msisdn,
      session.sessionId,
      session.shortcode
    );

    const sessionTimeElapsed = await sessionService.getSessionTimeElapsed(
      session.msisdn,
      session.sessionId,
      session.shortcode
    );

    await sessionService.clearSession(
      session.msisdn,
      session.sessionId,
      session.shortcode
    );

    loggingService.logSessionEnd(
      session.msisdn,
      session.sessionId,
      session.shortcode,
      sessionTimeElapsed,
      transactionCount
    );
  }

  async updateSessionState(session, nextMenu) {
    const menuHistory = [...(session.menuHistory || []), nextMenu];

    await sessionService.updateSession(
      session.msisdn,
      session.sessionId,
      session.shortcode,
      {
        currentMenu: nextMenu,
        menuHistory,
        lastActivity: new Date().toISOString()
      }
    );
  }

  async handleHomeMenu(session, encryptedResponse) {
    // First step: Get customer info if not already fetched
    if (!encryptedResponse && !session.customerData) {
      return await this.handleCustomerLookup(session);
    }

    // Handle PIN entry or forgot PIN
    const decryptedResponse = await encryption.decryptPin(encryptedResponse);

    if (decryptedResponse === '1') {
      // Forgot PIN
      return this.getForgotPinMenu();
    }

    // Validate PIN and login
    return await this.handlePinValidation(session, decryptedResponse);
  }

  async handleCustomerLookup(session) {
    const customerResult = await apiService.getCustomer(session.msisdn, session);

    if (!customerResult.success) {
      return {
        name: 'home',
        action: 'end',
        message: 'Welcome to SidianVIBE (Mobile Banking). Please visit any of our branches to activate this service.'
      };
    }

    // Parse and store customer data
    const customerData = this.parseCustomerData(customerResult.data);
    await sessionService.updateSession(
      session.msisdn,
      session.sessionId,
      session.shortcode,
      { customerData }
    );

    // Render welcome message
    const name = customerData.firstname || customerData.lastname || 'Customer';
    return {
      name: 'home',
      action: 'con',
      message: `Hello ${name}, welcome to SidianVIBE (Mobile Banking)\n\nPlease enter your PIN to continue.\n\nForgot your PIN? Reply with 1 to reset your PIN`
    };
  }

  async handlePinValidation(session, pin) {
    if (!validators.validatePin(pin)) {
      return {
        name: 'home',
        action: 'con',
        message: 'Invalid PIN format. PIN must be 4-6 digits.\n\nPlease enter your PIN to continue'
      };
    }

    const loginResult = await apiService.login(
      session.customerData,
      session.msisdn,
      session,
      pin
    );

    if (!loginResult.success) {
      let errorMessage = 'Invalid Login Password';

      if (loginResult.status === '091') {
        errorMessage = loginResult.message || errorMessage;
      } else if (loginResult.status === '102') {
        const name = session.customerData.firstname || session.customerData.lastname || 'Customer';
        return {
          name: 'home',
          action: 'end',
          message: `Dear ${name}, your account has been blocked due to exceeded PIN tries.\n\nTo reset a new PIN use the forgot PIN option.\nFor queries call 0711058000`
        };
      } else if (loginResult.status === '101') {
        // Handle forced PIN change
        await sessionService.store(
          session.msisdn,
          session.sessionId,
          session.shortcode,
          'otp',
          pin
        );
        return this.getForcedPinChangeMenu(session);
      }

      return {
        name: 'home',
        action: 'con',
        message: `${errorMessage}\n\nPlease enter your PIN to continue`
      };
    }

    // Login successful - update customer data with accounts
    const updatedCustomerData = this.parseLoginData(loginResult.data, session.customerData);
    await sessionService.updateSession(
      session.msisdn,
      session.sessionId,
      session.shortcode,
      {
        customerData: updatedCustomerData,
        authStatus: 'authenticated'
      }
    );

    // Proceed to mobile banking
    const menuContext = menuService.buildMenuContext({
      ...session,
      customerData: updatedCustomerData
    });

    return await menuService.renderMenu('mobilebanking', menuContext);
  }

  async handleRegularMenu(session, encryptedResponse) {
    const menuContext = await menuService.buildMenuContext(session);

    try {
      const menuResult = await menuService.processMenuResponse(
        session.currentMenu,
        encryptedResponse,
        session,
        menuContext
      );

      if (menuResult.error) {
        // Handle error - show error message and retry same menu
        const errorMenu = await menuService.renderMenu(session.currentMenu, {
          ...menuContext,
          error: menuResult.errorMessage || 'Invalid selection'
        });

        errorMenu.message = `${menuResult.errorMessage || 'Invalid entry'}\n\n${errorMenu.message}`;
        return errorMenu;
      }

      if (menuResult.nextMenu) {
        // Check if authentication is required for the next menu
        if (this.requiresAuthentication(menuResult.nextMenu) && session.authStatus !== 'authenticated') {
          return {
            name: 'auth_required',
            action: 'con',
            message: 'Please authenticate first.\n\nEnter your PIN to continue'
          };
        }

        // Render the next menu
        const nextMenuContext = menuService.buildMenuContext({
          ...session,
          ...menuResult.data
        });

        return await menuService.renderMenu(menuResult.nextMenu, nextMenuContext);
      }

      // Default: show current menu again
      return await menuService.renderMenu(session.currentMenu, menuContext);

    } catch (error) {
      loggingService.logError(error, {
        msisdn: session.msisdn,
        sessionId: session.sessionId,
        menu: session.currentMenu
      });

      return {
        name: 'error',
        action: 'con',
        message: 'An error occurred. Please try again.\n\n0. Home\n00. Exit'
      };
    }
  }

  requiresAuthentication(menuName) {
    const protectedMenus = [
      'mobilebanking', 'myaccount', 'balance', 'statement', 'transfer',
      'airtime', 'mobilemoney', 'loans', 'bills', 'pesalink', 'services'
    ];

    return protectedMenus.includes(menuName);
  }

  parseCustomerData(customerArray) {
    // Parse GETCUSTOMER response array to object
    const dataMap = {
      3: 'customerid',
      7: 'firstname',
      9: 'lastname',
      15: 'language'
    };

    const customerData = {};
    Object.keys(dataMap).forEach(index => {
      if (customerArray[parseInt(index)]) {
        customerData[dataMap[index]] = customerArray[parseInt(index)].trim();
      }
    });

    return customerData;
  }

  parseLoginData(loginArray, existingCustomerData) {
    if (!loginArray || loginArray.length < 16) {
      return existingCustomerData;
    }

    const allAccounts = (loginArray[3] || '').split(',');
    const accounts = [];
    const aliases = [];

    allAccounts.forEach(account => {
      const trimmed = account.trim();
      if (trimmed) {
        const [acc, alias] = trimmed.split('-');
        accounts.push(acc ? acc.trim() : trimmed);
        aliases.push(alias ? alias.trim() : (acc ? acc.trim() : trimmed));
      }
    });

    return {
      ...existingCustomerData,
      idnumber: (loginArray[5] || '').trim(),
      email: (loginArray[15] || '').trim(),
      accounts: accounts.filter(Boolean),
      aliases: aliases.filter(Boolean)
    };
  }

  getForgotPinMenu() {
    return {
      name: 'forgot_pin',
      action: 'con',
      message: 'To reset your PIN:\n\n1. Visit any Sidian Bank branch\n2. Call 0711058000\n\n0. Back\n00. Exit'
    };
  }

  getForcedPinChangeMenu(session) {
    const name = session.customerData.firstname || session.customerData.lastname || 'Customer';
    return {
      name: 'forced_pin_change',
      action: 'con',
      message: `Dear ${name}, you need to change your PIN.\n\nPlease enter your new PIN:`
    };
  }
}

module.exports = new UssdController();