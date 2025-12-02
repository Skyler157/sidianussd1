// src/services/api.service.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const loggingService = require('./logging.service');

class APIService {
  constructor() {
    this.baseURL = process.env.ELMA_API_URL;
    this.timeout = parseInt(process.env.API_TIMEOUT) || 25000;

    this.httpClient = axios.create({
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
  }

  async login(customer, msisdn, session, pin) {
    const data = `FORMID:LOGIN:LOGINMPIN:${pin}:CUSTOMERID:${customer.customerid}`;
    return this.call('LOGIN', data, session);
  }

  async call(serviceName, data, session, cacheKey = null) {

    const requestId = uuidv4();
    const deviceId = `${session.msisdn || ''}${session.shortcode || ''}`;

    // IMPORTANT: For BALANCE, serviceName is "B-" not "BALANCE"
    const logServiceName = serviceName === 'B-' ? 'BALANCE' : serviceName;

    const fullData = this.buildDataString(serviceName, data, session, requestId, deviceId);
    const encodedData = encodeURIComponent(fullData);
    const fullUrl = `${this.baseURL}?b=${encodedData}`;

    console.log('Full URL:', fullUrl);

    loggingService.logRequest(logServiceName, fullData);
    loggingService.logUrl(fullUrl);

    try {
      console.log('Making HTTP request...');
      const response = await this.httpClient.get(fullUrl);
      console.log('HTTP response received');

      const rawResponse = response.data.replace(/<[^>]+>/g, '').trim();
      console.log('Raw response:', rawResponse);

      loggingService.logResponse(logServiceName, rawResponse);

      const parsedResponse = this.parseResponse(rawResponse);
      console.log('Parsed response:', parsedResponse);

      // Log customer data if GETCUSTOMER
      if (serviceName === 'GETCUSTOMER' && parsedResponse.success) {
        loggingService.logCustomer(
          parsedResponse.data,
          session.msisdn,
          session.sessionId,
          session.shortcode,
          'getcustomer'
        );
      }

      console.log(`=== API CALL END: ${serviceName} ===`);
      return parsedResponse;

    } catch (error) {
      console.error('API Call Failed:', error.message);
      console.error('Error stack:', error.stack);
      return {
        success: false,
        status: 'ERROR',
        code: 'API_CONNECTION_ERROR',
        data: {},
        raw: '',
        error: 'Service temporarily unavailable'
      };
    }
  }

  buildDataString(serviceName, additionalDataString, session, requestId, deviceId) {
    console.log(`Building data string for service: ${serviceName}`);

    // Base data - always included
    const baseData = {
      FORMID: serviceName,  // This is "B-" for balance
      MOBILENUMBER: session.msisdn,
      SESSION: session.sessionId,
      BANKID: process.env.BANK_ID || '66',
      BANKNAME: process.env.BANK_NAME || 'SIDIAN',
      SHORTCODE: session.shortcode || process.env.ELMA_SHORTCODE || '527',
      COUNTRY: process.env.COUNTRY || 'KENYATEST',
      TRXSOURCE: process.env.TRX_SOURCE || 'USSD',
      DEVICEID: deviceId,
      UNIQUEID: requestId
    };

    // Add CUSTOMERID if available
    if (session.customerData && session.customerData.customerid) {
      baseData.CUSTOMERID = session.customerData.customerid;
    }

    // Parse additional data string (like "MERCHANTID:BALANCE:BANKACCOUNTID:...")
    const additionalData = this.parseDataString(additionalDataString);

    // Merge base data with additional data
    // Additional data OVERRIDES base data if same key exists
    const allData = { ...baseData, ...additionalData };

    // Build the final string
    let dataString = '';
    Object.keys(allData).forEach(key => {
      if (allData[key] !== undefined && allData[key] !== null && allData[key] !== '') {
        dataString += `${key}:${allData[key]}:`;
      }
    });

    console.log('Final data string:', dataString);
    return dataString;
  }

  parseDataString(dataString) {
    const result = {};
    if (!dataString || typeof dataString !== 'string') {
      return result;
    }

    const pairs = dataString.split(':');
    for (let i = 0; i < pairs.length; i += 2) {
      if (pairs[i] && pairs[i + 1] !== undefined) {
        result[pairs[i]] = pairs[i + 1];
      }
    }

    console.log('Parsed data string:', result);
    return result;
  }

  parseResponse(rawResponse, serviceName) {

    try {
      const lines = rawResponse.split(':');
      const result = {};

      for (let i = 0; i < lines.length; i += 2) {
        if (i + 1 < lines.length) {
          result[lines[i]] = lines[i + 1];
        }
      }

      const status = result.STATUS;
      const message = result.DATA || result.MESSAGE || '';

      const successCodes = ['000', '00', '0', 'OK', 'SUCCESS'];
      const isSuccess = successCodes.includes(status);

      let errorMessage = message;
      if (!isSuccess) {
        switch (status) {
          case '091':
            errorMessage = 'Invalid PIN';
            break;
          case '092':
            errorMessage = 'Account locked';
            break;
          case '093':
            errorMessage = 'Invalid account';
            break;
          default:
            errorMessage = message || 'Unknown error';
        }
      }

      return {
        success: isSuccess,
        status: status,
        code: 'STATUS',
        data: result,
        raw: rawResponse,
        message: errorMessage,
        error: isSuccess ? null : errorMessage
      };

    } catch (error) {
      console.error('Error parsing response:', error);
      return {
        success: false,
        status: '999',
        data: null,
        raw: rawResponse,
        message: 'Failed to parse response',
        error: 'Parse error'
      };
    }
  }

  maskMsisdn(msisdn) {
    if (!msisdn || msisdn.length < 4) return msisdn;
    return `${msisdn.substring(0, 3)}****${msisdn.substring(msisdn.length - 3)}`;
  }

  async getCustomer(msisdn, session) {
    const data = `FORMID:GETCUSTOMER:MOBILENUMBER:${msisdn}`;
    return this.call('GETCUSTOMER', data, session);
  }
}

module.exports = new APIService();