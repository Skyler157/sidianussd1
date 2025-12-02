// src/services/logging.service.js
const path = require('path');
const fs = require('fs').promises;
const { format } = require('date-fns');

class LoggingService {
  constructor() {
    this.timezone = 'Africa/Nairobi';
    this.logDir = './logs';
    this.sessionActive = false; // Add sessionActive flag
    this.ensureLogDirectory();
  }


  async ensureLogDirectory() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  getTimestamp() {
    return format(new Date(), 'yyyy-MM-dd HH:mm:ss');
  }

  logToConsoleAndFile(message) {
    // Log to console
    console.log(message);

    // Log to file
    const logMessage = `${message}\n`;
    const logFile = path.join(this.logDir, 'ussd.log');

    fs.appendFile(logFile, logMessage).catch(err => {
      console.error('Failed to write to log file:', err);
    });
  }

  // Session logging
  logSessionTimeElapsed(elapsed) {
    const message = `${this.getTimestamp()} - SESSION TIME ELAPSED: ${elapsed} seconds`;
    this.logToConsoleAndFile(message);
  }
  startSessionLog(sessionId, msisdn) {
    this.sessionActive = true;
    this.logToConsoleAndFile('');
    this.logToConsoleAndFile(''.padStart(78) + 'START');
    this.logToConsoleAndFile(`${this.getTimestamp()} - SESSION STARTED: ${sessionId} for ${msisdn}`);
    this.logToConsoleAndFile(`${this.getTimestamp()} - SESSION TIME ELAPSED: 0 seconds`);
  }

  logSessionStart(msisdn, sessionId, shortcode) {
    const startTime = this.getTimestamp();
    const endTime = format(new Date(Date.now() + 5 * 60 * 1000), 'yyyy-MM-dd HH:mm:ss');

    this.logToConsoleAndFile('');
    this.logToConsoleAndFile(''.padStart(78) + 'START');
    this.logToConsoleAndFile(`${this.getTimestamp()} - SESSION TIME ELAPSED: 0 seconds`);
    this.logToConsoleAndFile(`${this.getTimestamp()} - SESSION STARTED @ ${startTime}`);
    this.logToConsoleAndFile(`${this.getTimestamp()} - SESSION ENDS @ ${endTime}`);
  }

  logController(method, data) {
    const message = `${this.getTimestamp()} - CONTROLLER{${method}}: ${JSON.stringify(data)}`;
    this.logToConsoleAndFile(message);
  }

  logRequest(service, data) {
    const message = `${this.getTimestamp()} - REQUEST [${service}]: ${data}`;
    this.logToConsoleAndFile(message);
  }

  logResponse(service, response) {
    const message = `${this.getTimestamp()} - RESPONSE [${service}]: ${response}`;
    this.logToConsoleAndFile(message);
  }

  logUrl(url) {
    const message = `${this.getTimestamp()} - URL: ${url}`;
    this.logToConsoleAndFile(message);
  }

  logMenu(menuName, action, message) {
    const cleanMessage = message.replace(/\n/g, ' ');
    const menuLog = `${this.getTimestamp()} - MENU{${menuName}}: ${action} ${cleanMessage}`;
    const sizeLog = `${this.getTimestamp()} - MENU SIZE: ${Buffer.byteLength(message, 'utf8')} bytes`;

    this.logToConsoleAndFile(menuLog);
    this.logToConsoleAndFile(sizeLog);
  }

  // Helper methods for different controller logs
  logRoot(customer, msisdn, sessionId, shortcode, response) {
    this.logController('root', [customer, msisdn, sessionId, shortcode, response]);
  }

  logMenuRequest(menuName, customer, msisdn, sessionId, shortcode, response) {
    this.logController(menuName, {
      customer,
      msisdn,
      session: sessionId,
      shortcode,
      response
    });
  }

  // Alias for home menu
  logHome(customer, msisdn, sessionId, shortcode, response) {
    this.logMenuRequest('home', customer, msisdn, sessionId, shortcode, response);
  }

  logSendRequest(msisdn, sessionId, shortcode, service, data, url) {
    this.logController('sendrequest', {
      msisdn,
      session: sessionId,
      shortcode,
      service,
      data,
      url
    });
  }

  logCustomer(customer, msisdn, sessionId, shortcode, action) {
    this.logController('customer', {
      customer,
      msisdn,
      session: sessionId,
      shortcode,
      action
    });
  }

  // Log session end separator
  logEnd() {
    this.logToConsoleAndFile(`${this.getTimestamp()} - SESSION TIME ELAPSED: 0 seconds`);
    this.logToConsoleAndFile(''.padStart(78) + 'END');
    this.logToConsoleAndFile('---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------');
  }
}

module.exports = new LoggingService();