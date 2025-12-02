// src/services/menu.service.js
const fs = require('fs').promises;
const path = require('path');
const { loggingService } = require('./logging.service');
const _ = require('lodash');

class MenuService {
  constructor() {
    this.menus = new Map();
    this.menuConfigPath = path.join(__dirname, '../../config/menus');
    this.apiEndpoints = {};
    this.businessRules = {};
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async loadConfigurations() {
    try {
      console.log('Loading menu configurations...');

      // Clear existing
      this.menus.clear();
      this.apiEndpoints = {};
      this.businessRules = {};

      // Load menus
      try {
        const menuFiles = await fs.readdir(this.menuConfigPath);
        for (const file of menuFiles.filter(f => f.endsWith('.json'))) {
          try {
            const menuName = file.replace('.json', '');
            const content = await fs.readFile(
              path.join(this.menuConfigPath, file),
              'utf8'
            );

            if (content.trim()) {
              const menuConfig = JSON.parse(content);
              this.menus.set(menuName, menuConfig);
            }
          } catch (error) {
            console.warn(`Could not parse ${file}:`, error.message);
          }
        }
      } catch (error) {
        console.warn(`Could not read menu directory ${this.menuConfigPath}:`, error.message);
      }

      console.log(`Loaded ${this.menus.size} menu configurations`);

      // Load API endpoints
      const apiConfigPath = path.join(__dirname, '../../config/api-endpoints.json');
      if (await this.fileExists(apiConfigPath)) {
        try {
          const apiContent = await fs.readFile(apiConfigPath, 'utf8');
          this.apiEndpoints = JSON.parse(apiContent);
          console.log('API endpoints loaded');
        } catch (error) {
          console.warn('Failed to load API endpoints:', error.message);
        }
      } else {
        console.warn('API endpoints file not found:', apiConfigPath);
      }

      // Load business rules
      const rulesPath = path.join(__dirname, '../../config/business-rules.json');
      if (await this.fileExists(rulesPath)) {
        try {
          const rulesContent = await fs.readFile(rulesPath, 'utf8');
          this.businessRules = JSON.parse(rulesContent);
          console.log('Business rules loaded');
        } catch (error) {
          console.warn('Failed to load business rules:', error.message);
        }
      } else {
        console.warn('Business rules file not found:', rulesPath);
      }

      // Initialize module registry
      const moduleRegistry = require('../modules/module.registry');
      await moduleRegistry.init();

      console.log('Configurations loaded successfully');
      return true;
    } catch (error) {
      console.error('Error loading configurations:', error.message);
      return false;
    }
  }

  async executeHandlerByName(handlerName, inputValue, session, context) {
    try {
      const moduleRegistry = require('../modules/module.registry');

      // ALWAYS prefer session from context (it's the enhanced one)
      const sessionToUse = context?.session || session;

      const result = await moduleRegistry.execute(handlerName, inputValue, sessionToUse, context);

      if (result && typeof result === 'object') {
        return {
          action: result.action || 'con',
          message: result.message || '',
          nextMenu: result.nextMenu,
          error: result.error,
          errorMessage: result.errorMessage,
          retryMenu: result.retryMenu
        };
      }

      return result;
    } catch (error) {
      console.error(`Error executing handler ${handlerName}:`, error);
      return null;
    }
  }

  async processMenuResponse(menuName, encryptedResponse, session, context = {}) {
    const menuConfig = this.getMenu(menuName);
    if (!menuConfig) {
      console.error(`Menu ${menuName} not found`);
      return this.getDefaultError(menuName);
    }

    // For now, don't decrypt - just use the response directly
    let response = encryptedResponse;
    console.log(`Processing response: ${response} for menu: ${menuName}`);

    // Handle navigation FIRST (before handler)
    const navResult = this.handleNavigation(response, menuConfig);
    if (navResult) {
      console.log(`Navigation result: ${JSON.stringify(navResult)}`);
      return { action: 'con', ...navResult };
    }

    // Handle direct handler (like home menu's pin.processPinOrForgot)
    if (menuConfig.handler) {
      console.log(`Executing direct handler: ${menuConfig.handler}`);

      // CRITICAL FIX: Pass the enhanced session (which should be in context.session)
      const sessionToUse = context.session || session;

      const result = await this.executeHandlerByName(
        menuConfig.handler,
        response,
        sessionToUse,  // Use enhanced session from context
        context
      );

      if (result) {
        return result;
      }
    }

    // Handle numbered options
    if (menuConfig.options?.length > 0) {
      console.log(`Menu has ${menuConfig.options.length} options`);
      const optionIndex = parseInt(response) - 1;
      console.log(`Option index selected: ${optionIndex} (response: ${response})`);

      if (!isNaN(optionIndex) && optionIndex >= 0 && optionIndex < menuConfig.options.length) {
        console.log(`Processing option ${optionIndex + 1}: ${menuConfig.options[optionIndex].text || 'unnamed'}`);

        // Use enhanced session for options too
        const sessionToUse = context.session || session;

        const optionResult = await this.processOption(
          menuConfig.options[optionIndex],
          menuConfig,
          sessionToUse,
          context
        );

        if (optionResult) {
          console.log(`Option result: ${JSON.stringify(optionResult)}`);
          return optionResult;
        }
      }
    }

    return this.getDefaultError(menuName);
  }

  handleNavigation(response, menuConfig) {
    if (!response) return null;

    // Check navigation object
    if (menuConfig.navigation) {
      if (menuConfig.navigation[response]) {
        const nextMenu = menuConfig.navigation[response];
        console.log(`Navigation match found: ${response} -> ${nextMenu}`);
        return { nextMenu: nextMenu };
      }

      if (response === '0' && menuConfig.navigation.onBack) {
        const nextMenu = menuConfig.navigation.onBack;
        console.log(`Back navigation: 0 -> ${nextMenu}`);
        return { nextMenu: nextMenu };
      }

      if (response === '00' && menuConfig.navigation.onHome) {
        const nextMenu = menuConfig.navigation.onHome;
        console.log(`Home navigation: 00 -> ${nextMenu}`);
        return { nextMenu: nextMenu };
      }

      if (response === '000' && menuConfig.navigation.onExit) {
        console.log('Exit navigation: 000 -> end');
        return { nextMenu: 'end' };
      }
    }

    // Legacy support
    const navMap = {
      '0': menuConfig.onBack,
      '00': menuConfig.onHome,
      '000': menuConfig.onExit
    };

    if (navMap[response]) {
      const nextMenu = navMap[response];
      console.log(`Legacy navigation: ${response} -> ${nextMenu}`);
      return { nextMenu: nextMenu };
    }

    return null;
  }

  async processOption(selectedOption, menuConfig, session, context) {
    console.log(`Processing option: ${selectedOption.text || 'unnamed'}`);

    if (selectedOption.condition && !this.evaluateCondition(selectedOption.condition, context)) {
      return {
        action: 'con',
        message: 'This option is currently unavailable.',
        retryMenu: menuConfig.name
      };
    }

    // Store data if needed
    if (selectedOption.store) {
      for (const [key, valuePath] of Object.entries(selectedOption.store)) {
        const value = _.get(context, valuePath, selectedOption.storeValue);
        await session.store(key, value);
      }
    }

    // Handle action
    if (selectedOption.action) {
      const result = await this.executeAction(selectedOption.action, session, context);
      if (result) {
        return { action: 'con', ...result };
      }
    }

    // Handle handler
    if (selectedOption.handler) {
      console.log(`Executing option handler: ${selectedOption.handler}`);
      const result = await this.executeHandlerByName(
        selectedOption.handler,
        null,
        session,
        context
      );

      if (result) {
        return result;
      }
    }

    // Go to next menu
    if (selectedOption.nextMenu) {
      console.log(`Option leads to next menu: ${selectedOption.nextMenu}`);
      return { action: 'con', nextMenu: selectedOption.nextMenu };
    }

    // Default error
    console.error(`Option has no nextMenu or handler: ${JSON.stringify(selectedOption)}`);
    return this.getDefaultError(menuConfig.name);
  }

  async processInput(response, inputConfig, menuConfig, session, context) {
    // Validate
    if (inputConfig.validation) {
      const isValid = await this.validateInput(response, inputConfig.validation, context);
      if (!isValid) {
        return {
          action: 'con',
          message: inputConfig.errorMessage || 'Invalid input. Please try again.',
          retryMenu: menuConfig.name
        };
      }
    }

    // Transform
    let processedValue = response;
    if (inputConfig.transform) {
      processedValue = this.transformInput(response, inputConfig.transform);
    }

    // Store
    if (inputConfig.storeKey) {
      await session.store(inputConfig.storeKey, processedValue);
    }

    // Execute handler
    if (inputConfig.handler) {
      const result = await this.executeHandlerByName(
        inputConfig.handler,
        processedValue,
        session,
        context
      );
      return result || this.getDefaultError(menuConfig.name);
    }

    // Go to next menu
    if (inputConfig.nextMenu) {
      return { action: 'con', nextMenu: inputConfig.nextMenu };
    }

    return this.getDefaultError(menuConfig.name);
  }

  transformInput(input, transformRule) {
    if (!input) return input;

    switch (transformRule) {
      case 'msisdn_to_254':
        if (input.startsWith('0') && input.length === 10) {
          return `254${input.substring(1)}`;
        }
        return input;
      case 'msisdn_to_0':
        if (input.startsWith('254') && input.length === 12) {
          return `0${input.substring(3)}`;
        }
        return input;
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
          await session.store(actionConfig.storeResult, result.data);
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
    if (!condition) return true;

    const { field, operator, value } = condition;
    const fieldValue = _.get(context, field);

    if (fieldValue === undefined || fieldValue === null) {
      return operator === 'not_exists';
    }

    switch (operator) {
      case 'equals': return fieldValue == value;
      case 'not_equals': return fieldValue != value;
      case 'greater_than': return Number(fieldValue) > Number(value);
      case 'less_than': return Number(fieldValue) < Number(value);
      case 'exists': return fieldValue !== undefined && fieldValue !== null;
      case 'not_exists': return fieldValue === undefined || fieldValue === null;
      case 'contains': return String(fieldValue).includes(String(value));
      case 'in': return Array.isArray(value) && value.includes(fieldValue);
      default: return true;
    }
  }

  replaceTemplateVariables(text, context) {
    if (!text || typeof text !== 'string') return text || '';

    return text.replace(/\{(\w+(?:\.\w+)*)\}/g, (match, key) => {
      const value = _.get(context, key, match);
      return value != null ? String(value) : '';
    });
  }

  async renderMenu(menuName, context = {}) {
    // Special handling for "end" menu
    if (menuName === 'end') {
      return {
        name: 'end',
        action: 'end',
        message: 'Thank you for using SidianVIBE. Goodbye!',
        metadata: {}
      };
    }

    const menuConfig = this.getMenu(menuName);
    if (!menuConfig) {
      console.error(`Menu ${menuName} not found`);
      return {
        name: menuName,
        action: 'con',
        message: 'Menu not available.',
        metadata: {}
      };
    }

    // Check if menu has a handler that should be executed on render
    if (menuConfig.handler && !menuConfig.handlerExecuted) {
      console.log(`Executing handler on render for menu: ${menuName}, handler: ${menuConfig.handler}`);

      // CRITICAL FIX: Pass context.session (enhanced session) not just context
      const handlerResult = await this.executeHandlerByName(
        menuConfig.handler,
        null,  // No input value for initial render
        context.session,  // This is the enhanced session
        context
      );

      if (handlerResult && handlerResult.message) {
        // If handler returns a message, use it
        return {
          name: menuName,
          action: handlerResult.action || menuConfig.action || 'con',
          message: handlerResult.message,
          nextMenu: handlerResult.nextMenu,
          metadata: menuConfig.metadata || {}
        };
      }

      // Mark handler as executed to avoid infinite loop
      menuConfig.handlerExecuted = true;
    }

    // Use the menu's message template
    let message = menuConfig.message || '';
    message = this.replaceTemplateVariables(message, context);

    // Add numbered options if not already present
    if (menuConfig.options?.length > 0) {
      const hasNumberedOptions = /\n\d\.\s/.test(message);
      if (!hasNumberedOptions) {
        menuConfig.options.forEach((option, index) => {
          if (option.condition && !this.evaluateCondition(option.condition, context)) {
            return;
          }
          const optionText = this.replaceTemplateVariables(option.text, context);
          message += `\n${index + 1}. ${optionText}`;
        });
      }
    }

    // Add navigation commands
    if (menuConfig.navigation?.text) {
      const navText = this.replaceTemplateVariables(menuConfig.navigation.text, context);
      if (navText && !message.includes(navText.trim())) {
        message += `\n${navText}`;
      }
    }

    return {
      name: menuName,
      action: menuConfig.action || 'con',
      message: message.trim(),
      metadata: menuConfig.metadata || {}
    };
  }

  async buildMenuContext(session, additionalContext = {}) {
    return {
      customer: session.customerData || { firstname: 'Customer', lastname: '' },
      session: session,
      data: {},
      transaction: session.transactionData || {},
      ...additionalContext
    };
  }

  getDefaultError(menuName) {
    return {
      action: 'con',
      error: 'INVALID_INPUT',
      errorMessage: 'Invalid selection. Please try again.',
      retryMenu: menuName
    };
  }

  getMenu(menuName) {
    return this.menus.get(menuName);
  }

  getApiEndpoint(serviceName) {
    return _.get(this.apiEndpoints, serviceName);
  }

  getBusinessRule(rulePath) {
    return _.get(this.businessRules, rulePath);
  }

  async validateInput(input, validationRules, context) {
    if (!input || input.trim().length === 0) return false;

    const validators = require('../utils/validators');

    switch (validationRules?.type) {
      case 'msisdn':
        return validators.validateMsisdn(input, validationRules.network);
      case 'amount':
        return validators.validateAmount(input, validationRules);
      case 'date':
        return validators.validateDate(input, validationRules.format);
      case 'pin':
        return validators.validatePin(input);
      case 'option':
        return validationRules.options?.includes(input) || false;
      case 'pin_or_option':
        return input === '1' || validators.validatePin(input);
      case 'custom':
        if (validationRules.handler) {
          const result = await this.executeHandlerByName(validationRules.handler, input, context);
          return result && !result.error;
        }
        return false;
      default:
        return true;
    }
  }
}

module.exports = new MenuService();