// src/controllers/ussd.controller.js
const sessionService = require('../services/session.service');
const menuService = require('../services/menu.service');
const apiService = require('../services/api.service');
const loggingService = require('../services/logging.service');

class UssdController {
  async handleRequest(req, res) {
    const { msisdn, sessionid, shortcode, response } = req.body;

    try {
      if (!msisdn || !sessionid) {
        return res.status(400).send('end Invalid parameters');
      }

      // Get or create session
      let session = await sessionService.getSession(msisdn, sessionid, shortcode);
      
      if (!session) {
        session = await sessionService.createSession(msisdn, sessionid, shortcode);
        loggingService.logSessionStart(msisdn, sessionid, shortcode);
        loggingService.logSessionTimeElapsed(0);
      } else {
        loggingService.logSessionTimeElapsed(0);
      }

      // Process the USSD request
      const result = await this.processUssdRequest(msisdn, sessionid, shortcode, response, session);

      // Log menu
      const menuName = result.name || session?.currentMenu || 'unknown';
      loggingService.logMenu(menuName, result.action, result.message);
      loggingService.logSessionTimeElapsed(0);

      // Return response
      if (req.headers['user-agent']?.includes('Postman')) {
        res.send(result.message);
      } else {
        res.send(`${result.action} ${result.message}`);
      }

    } catch (error) {
      console.error('USSD error:', error);
      loggingService.logEnd();
      res.status(200).send('end System error');
    }
  }

  async processUssdRequest(msisdn, sessionId, shortcode, encryptedResponse, session) {
    if (!session) {
      session = await sessionService.getSession(msisdn, sessionId, shortcode);
      if (!session) {
        session = await sessionService.createSession(msisdn, sessionId, shortcode);
      }
    }

    // Add helper methods to session
    const sessionHelpers = {
      store: (key, value) => sessionService.store(msisdn, sessionId, shortcode, key, value),
      grab: (key) => sessionService.grab(msisdn, sessionId, shortcode, key),
      blank: (key) => sessionService.blank(msisdn, sessionId, shortcode, key),
      pluck: (key) => {
        const value = sessionService.grab(msisdn, sessionId, shortcode, key);
        sessionService.blank(msisdn, sessionId, shortcode, key);
        return value;
      },
      updateSession: (data) => sessionService.updateSession(msisdn, sessionId, shortcode, data)
    };

    // Merge helpers with session data
    const enhancedSession = {
      ...session,
      ...sessionHelpers,
      msisdn,
      sessionId,
      shortcode
    };

    // Fetch customer data if needed
    if ((session.currentMenu || 'home') === 'home' && !session.customerData) {
      const customerData = await this.fetchCustomerData(enhancedSession);
      enhancedSession.customerData = customerData;
      
      loggingService.logHome(
        customerData,
        msisdn,
        sessionId,
        shortcode,
        encryptedResponse || ''
      );
    }

    // Get current menu
    const currentMenuName = session.currentMenu || 'home';
    
    // Build menu context
    const menuContext = await menuService.buildMenuContext(enhancedSession);

    let result;
    
    if (!encryptedResponse) {
      // New request - render current menu
      result = await menuService.renderMenu(currentMenuName, menuContext);
    } else {
      // User response - process with current menu
      const menusToLog = ['home', 'main_menu', 'my_account', 'balance', 'balance_pin'];
      if (menusToLog.includes(currentMenuName)) {
        loggingService.logMenuRequest(
          currentMenuName,
          enhancedSession.customerData || {},
          msisdn,
          sessionId,
          shortcode,
          encryptedResponse
        );
      }

      result = await menuService.processMenuResponse(
        currentMenuName,
        encryptedResponse,
        enhancedSession,
        menuContext
      );
    }

    // Handle undefined result
    if (!result) {
      return {
        action: 'con',
        message: 'System error. Please try again.',
        retryMenu: currentMenuName
      };
    }

    // Handle end action
    if (result.action === 'end') {
      await sessionService.clearSession(msisdn, sessionId, shortcode);
      loggingService.logEnd();
      return result;
    }

    // Update session if next menu specified
    if (result.nextMenu) {
      await sessionService.updateSession(msisdn, sessionId, shortcode, {
        currentMenu: result.nextMenu,
        lastActivity: new Date().toISOString()
      });

      // Render next menu if no message
      if (!result.message) {
        const newMenuContext = await menuService.buildMenuContext(enhancedSession);
        const nextMenuResult = await menuService.renderMenu(result.nextMenu, newMenuContext);
        
        if (nextMenuResult.action === 'end') {
          await sessionService.clearSession(msisdn, sessionId, shortcode);
          loggingService.logEnd();
        }
        
        return nextMenuResult;
      }
    }

    // Ensure result has action
    if (!result.action) result.action = 'con';
    
    // Ensure result has name for logging
    if (!result.name) {
      result.name = result.nextMenu || currentMenuName;
    }

    return result;
  }

  async fetchCustomerData(session) {
    try {
      const response = await apiService.getCustomer(session.msisdn, session);

      if (response.success && response.data) {
        const customerData = {
          customerid: response.data.CUSTOMERID || 'GUEST',
          firstname: response.data.FIRSTNAME || 'Customer',
          lastname: response.data.LASTNAME || '',
          accounts: response.data.BANKS ? response.data.BANKS.split(',').filter(a => a.trim()) : [],
          language: response.data.LANGUAGE || 'EN'
        };

        await session.updateSession({ customerData });
        return customerData;
      }
    } catch (error) {
      console.error('Customer data error:', error.message);
    }

    // Fallback
    const defaultCustomerData = {
      customerid: 'GUEST',
      firstname: 'Customer',
      lastname: 'User',
      accounts: [],
      language: 'EN'
    };

    await session.updateSession({ customerData: defaultCustomerData });
    return defaultCustomerData;
  }
}

module.exports = new UssdController();