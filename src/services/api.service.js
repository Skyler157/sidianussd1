const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { loggingService } = require('./logging.service');
const sessionService = require('./session.service');
const menuService = require('./menu.service');

class APIService {
  constructor() {
    this.baseURL = process.env.ELMA_API_URL;
    this.timeout = parseInt(process.env.API_TIMEOUT) || 25000;
    this.connectTimeout = parseInt(process.env.API_CONNECT_TIMEOUT) || 15000;
    
    // Create axios instance with better defaults
    this.httpClient = axios.create({
      timeout: this.timeout,
      connectTimeout: this.connectTimeout,
      maxRedirects: 0,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SidianVIBE-USSD/1.0'
      },
      validateStatus: (status) => status < 500 // Reject only on server errors
    });

    // Request/response interceptors for logging
    this.setupInterceptors();
  }

  setupInterceptors() {
    // Request interceptor
    this.httpClient.interceptors.request.use(
      (config) => {
        const requestId = uuidv4();
        config.metadata = { requestId, startTime: Date.now() };
        return config;
      },
      (error) => {
        loggingService.error('API Request Interceptor Error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.httpClient.interceptors.response.use(
      (response) => {
        const { requestId, startTime } = response.config.metadata || {};
        const duration = Date.now() - startTime;
        
        loggingService.info('API Response Received', {
          requestId,
          url: response.config.url,
          status: response.status,
          duration: `${duration}ms`
        });
        
        return response;
      },
      (error) => {
        const { requestId, startTime } = error.config?.metadata || {};
        const duration = Date.now() - startTime;
        
        loggingService.error('API Request Failed', {
          requestId,
          url: error.config?.url,
          error: error.message,
          code: error.code,
          duration: `${duration}ms`
        });
        
        return Promise.reject(error);
      }
    );
  }

  async call(serviceName, data, session = {}, cacheKey = null, forceRefresh = false) {
    const requestId = uuidv4();
    const deviceId = `${session.msisdn || ''}${session.shortcode || ''}`;
    
    // Build the full data string
    const fullData = this.buildDataString(serviceName, data, session, requestId, deviceId);
    
    // Check cache first if cacheKey provided and not forcing refresh
    if (cacheKey && !forceRefresh) {
      const cachedResponse = await this.getFromCache(cacheKey, session);
      if (cachedResponse) {
        loggingService.info('Serving from cache', { 
          service: serviceName,
          cacheKey,
          msisdn: session.msisdn 
        });
        return cachedResponse;
      }
    }
    
    // Log request (masking sensitive data)
    const maskedData = this.maskSensitiveData(fullData);
    loggingService.info('API Request', {
      service: serviceName,
      requestId,
      data: maskedData,
      url: this.baseURL,
      msisdn: session.msisdn ? sessionService.maskMsisdn(session.msisdn) : null,
      sessionId: session.sessionId
    });
    
    try {
      // Make API call
      const response = await this.httpClient.get(
        `${this.baseURL}?b=${encodeURIComponent(fullData)}`
      );
      
      // Parse response
      const rawResponse = response.data.replace(/<[^>]+>/g, '').trim();
      const parsedResponse = this.parseResponse(rawResponse);
      
      // Log response
      loggingService.info('API Response', {
        service: serviceName,
        requestId,
        status: parsedResponse.status,
        success: parsedResponse.success,
        processingTime: response.config.metadata?.duration,
        msisdn: session.msisdn ? sessionService.maskMsisdn(session.msisdn) : null
      });
      
      // Cache successful responses
      if (cacheKey && parsedResponse.success) {
        await this.cacheResponse(cacheKey, parsedResponse, session);
      }
      
      return parsedResponse;
      
    } catch (error) {
      loggingService.error('API Call Failed', {
        service: serviceName,
        requestId,
        error: error.message,
        msisdn: session.msisdn ? sessionService.maskMsisdn(session.msisdn) : null,
        sessionId: session.sessionId
      });
      
      return {
        success: false,
        status: 'ERROR',
        code: 'API_CONNECTION_ERROR',
        data: [],
        raw: '',
        error: 'Service temporarily unavailable. Please try again.',
        retry: true
      };
    }
  }

  buildDataString(serviceName, data, session, requestId, deviceId) {
    const baseData = {
      FORMID: serviceName,
      MOBILENUMBER: session.msisdn,
      SESSION: session.sessionId,
      BANKID: process.env.BANK_ID,
      BANKNAME: process.env.BANK_NAME,
      SHORTCODE: session.shortcode || process.env.ELMA_SHORTCODE,
      COUNTRY: process.env.COUNTRY,
      TRXSOURCE: process.env.TRX_SOURCE,
      DEVICEID: deviceId,
      UNIQUEID: requestId
    };
    
    // Add customer ID if available
    if (session.customerData && session.customerData.customerid) {
      baseData.CUSTOMERID = session.customerData.customerid;
    }
    
    // Add bank accounts if available
    if (session.customerData && session.customerData.accounts) {
      baseData.BANKACCOUNTS = session.customerData.accounts.join(',');
    }
    
    // Merge with additional data
    const additionalData = this.parseDataString(data);
    const allData = { ...baseData, ...additionalData };
    
    // Convert to string format (key:value:)
    let dataString = '';
    Object.keys(allData).forEach(key => {
      if (allData[key] !== undefined && allData[key] !== null && allData[key] !== '') {
        dataString += `${key}:${allData[key]}:`;
      }
    });
    
    return dataString;
  }

  parseDataString(dataString) {
    const result = {};
    if (!dataString) return result;
    
    const pairs = dataString.split(':');
    for (let i = 0; i < pairs.length; i += 2) {
      if (pairs[i] && pairs[i + 1]) {
        result[pairs[i]] = pairs[i + 1];
      }
    }
    
    return result;
  }

  parseResponse(rawResponse) {
    const parts = rawResponse.split(':');
    
    if (parts.length < 2) {
      return {
        success: false,
        status: 'ERROR',
        code: 'INVALID_RESPONSE',
        data: [],
        raw: rawResponse,
        error: 'Invalid response from server'
      };
    }
    
    const status = parts[1];
    const success = status === '000' || status === 'OK';
    
    return {
      success,
      status,
      code: parts[0] || '',
      data: parts,
      raw: rawResponse,
      message: parts[3] || (success ? 'Success' : 'Failed'),
      error: !success ? parts[3] || 'Unknown error' : null
    };
  }

  async getFromCache(cacheKey, session) {
    try {
      const cached = await sessionService.grab(
        session.msisdn,
        session.sessionId,
        session.shortcode,
        `api_cache_${cacheKey}`
      );
      
      if (cached && cached.timestamp) {
        // Check if cache is still valid (5 minutes)
        const cacheAge = Date.now() - cached.timestamp;
        if (cacheAge < 5 * 60 * 1000) { // 5 minutes
          return cached.response;
        }
      }
    } catch (error) {
      loggingService.warn('Cache read error', { error: error.message });
    }
    
    return null;
  }

  async cacheResponse(cacheKey, response, session) {
    try {
      await sessionService.store(
        session.msisdn,
        session.sessionId,
        session.shortcode,
        `api_cache_${cacheKey}`,
        {
          response,
          timestamp: Date.now()
        }
      );
    } catch (error) {
      loggingService.warn('Cache write error', { error: error.message });
    }
  }

  maskSensitiveData(data) {
    if (!data) return '';
    
    // Mask PINs and passwords
    const patterns = [
      /(OLDPIN|NEWPIN|TMPIN|TRXMPIN|LOGINMPIN|PASSWORD):([^:]+):/gi,
      /(PIN|PASS|SECRET):([^:]+):/gi
    ];
    
    let masked = data;
    patterns.forEach(pattern => {
      masked = masked.replace(pattern, (match, key, value) => {
        return `${key}:[MASKED]:`;
      });
    });
    
    // Mask full MSISDN, show only first 3 and last 3 digits
    masked = masked.replace(/(MOBILENUMBER|ACCOUNTID|MSISDN):(\d+):/gi, (match, key, value) => {
      if (value.length >= 6) {
        const maskedValue = `${value.substring(0, 3)}****${value.substring(value.length - 3)}`;
        return `${key}:${maskedValue}:`;
      }
      return `${key}:[MASKED]:`;
    });
    
    return masked;
  }

  // Specific API methods matching PHP implementation
  async getCustomer(msisdn, session) {
    const data = `FORMID:GETCUSTOMER:MOBILENUMBER:${msisdn}`;
    return this.call('GETCUSTOMER', data, session, `customer_${msisdn}`);
  }

  async login(customer, msisdn, session, pin) {
    const data = `FORMID:LOGIN:LOGINMPIN:${pin}:CUSTOMERID:${customer.customerid}`;
    return this.call('LOGIN', data, session);
  }

  async getCharges(merchantId, amount, customer, session) {
    const data = `FORMID:O-GetBankMerchantCharges:MERCHANTID:${merchantId}:AMOUNT:${amount}`;
    return this.call('O-GetBankMerchantCharges', data, session, `charges_${merchantId}_${amount}`);
  }

  async getList(formId, filter, customer, session, bankCode = null) {
    const branchFilter = bankCode ? `BANKFILTER:${bankCode}:` : '';
    const data = `FORMID:O-${formId}:FILTER:${filter}:${branchFilter}`;
    const cacheKey = `list_${formId}_${filter}_${bankCode || ''}`;
    return this.call(`O-${formId}`, data, session, cacheKey);
  }

  async airtimePurchase(merchantId, bankAccountId, mobileNumber, amount, pin, session) {
    const data = `FORMID:M-:MERCHANTID:${merchantId}:BANKACCOUNTID:${bankAccountId}:ACCOUNTID:${mobileNumber}:AMOUNT:${amount}:ACTION:PAYBILL:TMPIN:${pin}`;
    return this.call(merchantId, data, session);
  }

  // Health check for external API
  async healthCheck() {
    try {
      const response = await this.httpClient.get(this.baseURL, {
        timeout: 5000,
        params: { b: 'FORMID:HEALTHCHECK:TEST:1:' }
      });
      
      return {
        healthy: response.status === 200,
        status: response.status,
        responseTime: response.headers['response-time']
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        code: error.code
      };
    }
  }
}

module.exports = new APIService();