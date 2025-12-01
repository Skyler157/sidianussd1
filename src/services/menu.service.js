const fs = require('fs').promises;
const path = require('path');
const { loggingService } = require('./logging.service');
const { encryption } = require('../utils/encryption');
const { validators } = require('../utils/validators');
const _ = require('lodash');

class MenuService {
  constructor() {
    this.menus = new Map();
    this.menuConfigPath = path.join(__dirname, '../../config/menus');
    this.apiEndpoints = {};
    this.businessRules = {};

    setTimeout(() => {
      this.loadConfigurations().catch(err => {
        console.warn('Config load failed:', err?.message);
      });
    }, 2000);
  }

  async executeInputHandler(handlerConfig, inputValue, session, context) {
    try {
      if (handlerConfig?.moduleHandler) {
        const moduleRegistry = require('../modules/module.registry');
        return await moduleRegistry.execute(
          handlerConfig.moduleHandler,
          inputValue,
          session,
          context
        );
      }
    } catch (error) {
      console.error('Handler error:', error.message);
    }
    return null;
  }

  async executeHandlerByName(handlerName, inputValue, session, context) {
    // Check if it's a module handler
    try {
      const moduleRegistry = require('../modules/module.registry');
      if (moduleRegistry.has(handlerName)) {
        return await moduleRegistry.execute(handlerName, inputValue, session, context);
      }
    } catch (error) {
      console.warn('Module registry not available:', error.message);
    }

    // Check if it's a built-in handler
    if (typeof this[handlerName] === 'function') {
      return await this[handlerName](inputValue, session, context);
    }

    return null;
  }

  async executeApiCallHandler(handlerConfig, inputValue, session, context) {
    const apiService = require('./api.service');
    const result = await apiService.call(
      handlerConfig.service,
      handlerConfig.data,
      session,
      handlerConfig.cacheKey
    );

    if (result.success) {
      // Store API result if needed
      if (handlerConfig.storeResult) {
        await session.store(
          session.msisdn,
          session.sessionId,
          session.shortcode,
          handlerConfig.storeResult,
          result.data
        );
      }

      return { nextMenu: handlerConfig.nextMenuOnSuccess };
    } else {
      return {
        error: 'API_ERROR',
        errorMessage: handlerConfig.errorMessage || 'Service temporarily unavailable.',
        retryMenu: handlerConfig.nextMenuOnError
      };
    }
  }

  async validateInput(input, validationRules, context) {
    // MSISDN validation
    if (validationRules.type === 'msisdn') {
      return validators.validateMsisdn(input, validationRules.network);
    }

    // Amount validation
    if (validationRules.type === 'amount') {
      return validators.validateAmount(input, validationRules);
    }

    // Date validation
    if (validationRules.type === 'date') {
      return validators.validateDate(input, validationRules.format);
    }

    // PIN validation
    if (validationRules.type === 'pin') {
      return validators.validatePin(input);
    }

    // Option validation (select from list)
    if (validationRules.type === 'option') {
      return validationRules.options?.includes(input) || false;
    }

    // PIN or option (for home menu)
    if (validationRules.type === 'pin_or_option') {
      if (input === '1' || validators.validatePin(input)) {
        return true;
      }
      return false;
    }

    // Custom validation
    if (validationRules.custom) {
      // Check if it's a module handler
      try {
        const moduleRegistry = require('../modules/module.registry');
        if (moduleRegistry.has(validationRules.custom)) {
          const result = await moduleRegistry.execute(validationRules.custom, input, context);
          return result === true || result === 'true';
        }
      } catch (error) {
        console.warn('Module registry not available for validation:', error.message);
      }
      
      // Fall back to validators
      if (typeof validators[validationRules.custom] === 'function') {
        return await validators[validationRules.custom](input, context);
      }
    }

    // Default: check if not empty
    return input && input.trim().length > 0;
  }

  async loadConfigurations() {
    try {
      console.log('Loading menu configurations...');

      // Reset collections
      this.menus.clear();
      this.apiEndpoints = {};
      this.businessRules = {};

      // Load menu configurations
      try {
        const menuFiles = await fs.readdir(this.menuConfigPath);

        let loadedCount = 0;
        for (const file of menuFiles) {
          if (file.endsWith('.json')) {
            try {
              const menuName = file.replace('.json', '');
              const filePath = path.join(this.menuConfigPath, file);
              const content = await fs.readFile(filePath, 'utf8');

              // Skip empty files
              if (!content.trim()) {
                console.warn(`Skipping empty menu file: ${file}`);
                continue;
              }

              const menuConfig = JSON.parse(content);
              this.menus.set(menuName, menuConfig);
              loadedCount++;
            } catch (parseError) {
              console.warn(`Could not parse menu file ${file}:`, parseError.message);
            }
          }
        }
        console.log(`Loaded ${loadedCount} menu configurations`);
      } catch (menuError) {
        console.warn('Could not load menu configurations:', menuError?.message || 'Unknown error');
      }

      // Load API endpoints
      try {
        const apiConfigPath = path.join(__dirname, '../../config/api-endpoints.json');
        const apiContent = await fs.readFile(apiConfigPath, 'utf8');
        this.apiEndpoints = JSON.parse(apiContent);
        console.log('API endpoints loaded');
      } catch (apiError) {
        console.warn('Could not load API endpoints:', apiError?.message || 'Unknown error');
        this.apiEndpoints = {};
      }

      // Load business rules
      try {
        const rulesPath = path.join(__dirname, '../../config/business-rules.json');
        const rulesContent = await fs.readFile(rulesPath, 'utf8');
        this.businessRules = JSON.parse(rulesContent);
        console.log('Business rules loaded');
      } catch (rulesError) {
        console.warn('Could not load business rules:', rulesError?.message || 'Unknown error');
        this.businessRules = {};
      }

      console.log('Configurations loaded successfully');
      return true;

    } catch (error) {
      const errorMessage = error?.message || 'Unknown error loading configurations';
      console.error('Error loading configurations:', errorMessage);
      return false;
    }
  }

  async reloadConfigurations() {
    return await this.loadConfigurations();
  }

  getMenu(menuName) {
    return this.menus.get(menuName) || null;
  }

  getApiEndpoint(serviceName) {
    return _.get(this.apiEndpoints, serviceName, null);
  }

  getBusinessRule(rulePath) {
    return _.get(this.businessRules, rulePath, null);
  }

  async renderMenu(menuName, context = {}) {
    const menuConfig = this.getMenu(menuName);
    if (!menuConfig) {
      throw new Error(`Menu ${menuName} not found`);
    }

    let message = menuConfig.message || '';

    // Replace template variables
    message = this.replaceTemplateVariables(message, context);

    // Add options if they exist
    if (menuConfig.options && menuConfig.options.length > 0) {
      menuConfig.options.forEach((option, index) => {
        if (option.condition) {
          // Check if condition is met
          const conditionMet = this.evaluateCondition(option.condition, context);
          if (!conditionMet) return;
        }

        const optionText = this.replaceTemplateVariables(option.text, context);
        message += `\n${index + 1}. ${optionText}`;
      });
    }

    // Add navigation
    if (menuConfig.navigation) {
      const navigation = this.replaceTemplateVariables(menuConfig.navigation, context);
      message += `\n${navigation}`;
    }

    return {
      name: menuName,
      action: menuConfig.action || 'con',
      message: message.trim(),
      metadata: menuConfig.metadata || {}
    };
  }

  async processMenuResponse(menuName, encryptedResponse, session, context = {}) {
    const menuConfig = this.getMenu(menuName);
    if (!menuConfig) {
      throw new Error(`Menu ${menuName} not found`);
    }

    // Decrypt PIN if present
    let response = encryptedResponse;
    try {
      if (encryptedResponse && encryptedResponse !== '') {
        response = await encryption.decryptPin(encryptedResponse);
      }
    } catch (error) {
      console.warn('PIN decryption failed:', error.message);
      response = encryptedResponse; // Use as-is
    }

    // Handle special navigation
    const navigationResult = this.handleNavigation(response, menuConfig, session);
    if (navigationResult) return navigationResult;

    // Handle numeric options
    if (menuConfig.options && menuConfig.options.length > 0) {
      const optionResult = await this.handleOptionSelection(response, menuConfig, session, context);
      if (optionResult) return optionResult;
    }

    // Handle input validation and processing
    if (menuConfig.inputConfig) {
      const inputResult = await this.handleInputProcessing(response, menuConfig, session, context);
      if (inputResult) return inputResult;
    }

    // Handle direct handler (if no input config)
    if (menuConfig.handler) {
      const handlerResult = await this.executeInputHandler(menuConfig.handler, response, session, context);
      if (handlerResult) return handlerResult;
    }

    // Default error
    return {
      error: 'INVALID_INPUT',
      errorMessage: 'Invalid selection. Please try again.',
      retryMenu: menuName
    };
  }

  handleNavigation(response, menuConfig, session) {
    const navMap = {
      '0': menuConfig.onBack,
      '00': menuConfig.onHome,
      '000': menuConfig.onExit,
      '99': menuConfig.onPrevious,
      '98': menuConfig.onNext
    };

    if (navMap[response]) {
      return { nextMenu: navMap[response] };
    }

    // Handle pagination
    if (response.toUpperCase() === 'P' && menuConfig.pagination?.previous) {
      return { nextMenu: menuConfig.pagination.previous };
    }

    if (response.toUpperCase() === 'N' && menuConfig.pagination?.next) {
      return { nextMenu: menuConfig.pagination.next };
    }

    return null;
  }

  async handleOptionSelection(response, menuConfig, session, context) {
    const optionIndex = parseInt(response) - 1;

    if (isNaN(optionIndex) || optionIndex < 0 || optionIndex >= menuConfig.options.length) {
      return null;
    }

    const selectedOption = menuConfig.options[optionIndex];

    // Check condition
    if (selectedOption.condition) {
      const conditionMet = this.evaluateCondition(selectedOption.condition, context);
      if (!conditionMet) {
        return {
          error: 'OPTION_UNAVAILABLE',
          errorMessage: 'This option is currently unavailable.',
          retryMenu: menuConfig.name
        };
      }
    }

    // Store selection data
    if (selectedOption.store) {
      for (const [key, valuePath] of Object.entries(selectedOption.store)) {
        const value = _.get(context, valuePath, selectedOption.storeValue);
        await session.store(session.msisdn, session.sessionId, session.shortcode, key, value);
      }
    }

    // Execute action if specified
    if (selectedOption.action) {
      const actionResult = await this.executeAction(selectedOption.action, session, context);
      if (actionResult) return actionResult;
    }

    // Proceed to next menu
    if (selectedOption.nextMenu) {
      return { nextMenu: selectedOption.nextMenu };
    }

    return null;
  }

  async handleInputProcessing(response, menuConfig, session, context) {
    const inputConfig = menuConfig.inputConfig;

    // Validate input
    if (inputConfig.validation) {
      const isValid = await this.validateInput(response, inputConfig.validation, context);
      if (!isValid) {
        return {
          error: 'VALIDATION_FAILED',
          errorMessage: inputConfig.errorMessage || 'Invalid input. Please try again.',
          retryMenu: menuConfig.name
        };
      }
    }

    // Transform input if needed
    let processedValue = response;
    if (inputConfig.transform) {
      processedValue = this.transformInput(response, inputConfig.transform);
    }

    // Store input
    if (inputConfig.storeKey) {
      await session.store(
        session.msisdn,
        session.sessionId,
        session.shortcode,
        inputConfig.storeKey,
        processedValue
      );
    }

    // Execute input handler if specified
    if (inputConfig.handler) {
      const handlerResult = await this.executeInputHandler(
        inputConfig.handler,
        processedValue,
        session,
        context
      );
      if (handlerResult) return handlerResult;
    }

    // Proceed to next menu
    if (inputConfig.nextMenu) {
      return { nextMenu: inputConfig.nextMenu };
    }

    return null;
  }

  transformInput(input, transformRule) {
    switch (transformRule) {
      case 'msisdn_to_254':
        return input.startsWith('0') ? `254${input.substring(1)}` : input;
      case 'msisdn_to_0':
        return input.startsWith('254') ? `0${input.substring(3)}` : input;
      case 'uppercase':
        return input.toUpperCase();
      case 'lowercase':
        return input.toLowerCase();
      default:
        return input;
    }
  }

  async executeAction(actionConfig, session, context) {
    if (actionConfig.type === 'api_call') {
      const apiService = require('./api.service');
      const result = await apiService.call(
        actionConfig.service,
        actionConfig.data,
        session,
        actionConfig.cacheKey
      );

      if (result.success) {
        if (actionConfig.storeResult) {
          await session.store(
            session.msisdn,
            session.sessionId,
            session.shortcode,
            actionConfig.storeResult,
            result.data
          );
        }

        return { nextMenu: actionConfig.nextMenuOnSuccess };
      } else {
        return {
          error: 'API_ERROR',
          errorMessage: actionConfig.errorMessage || 'Service temporarily unavailable.',
          retryMenu: actionConfig.nextMenuOnError
        };
      }
    }

    return null;
  }

  evaluateCondition(condition, context) {
    const { field, operator, value } = condition;
    const fieldValue = _.get(context, field);

    switch (operator) {
      case 'equals':
        return fieldValue == value;
      case 'not_equals':
        return fieldValue != value;
      case 'greater_than':
        return fieldValue > value;
      case 'less_than':
        return fieldValue < value;
      case 'exists':
        return fieldValue !== undefined && fieldValue !== null;
      case 'not_exists':
        return fieldValue === undefined || fieldValue === null;
      case 'contains':
        return fieldValue && fieldValue.includes && fieldValue.includes(value);
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue);
      default:
        return true;
    }
  }

  replaceTemplateVariables(text, context) {
    if (!text) return '';

    return text.replace(/\{(\w+(?:\.\w+)*)\}/g, (match, key) => {
      const value = _.get(context, key, match);
      return value !== undefined && value !== null ? value.toString() : '';
    });
  }

  // Helper to build menu context - FIXED VERSION
  async buildMenuContext(session, additionalContext = {}) {
    // Get session data first
    const sessionData = await this.getSessionData(session);
    
    return {
      customer: session.customerData || {},
      session: {
        msisdn: session.msisdn,
        sessionId: session.sessionId,
        shortcode: session.shortcode,
        currentMenu: session.currentMenu
      },
      data: sessionData,
      transaction: session.transactionData || {},
      ...additionalContext
    };
  }

  async getSessionData(session) {
    const data = {};
    // Get session data here if needed
    return data;
  }
}

module.exports = new MenuService();