// src/modules/module.registry.js
const path = require('path');
const fs = require('fs');

class ModuleRegistry {
  constructor() {
    this.modules = new Map();
    this.moduleAliases = new Map();
  }

  async init() {
    await this.autoDiscoverModules();
    this.registerDefaultAliases();
  }

  async autoDiscoverModules() {
    const modulesDir = path.join(__dirname);

    try {
      const files = fs.readdirSync(modulesDir);

      for (const file of files) {
        if (file.endsWith('.module.js') && file !== 'module.registry.js') {
          try {
            const moduleName = path.basename(file, '.module.js');
            const modulePath = path.join(modulesDir, file);

            // Clear require cache to allow hot reloading
            delete require.cache[require.resolve(modulePath)];

            const module = require(modulePath);

            this.registerModule(moduleName, module);
            console.log(`Discovered module: ${moduleName}`);
          } catch (error) {
            console.warn(`Failed to load module ${file}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.warn('Modules directory not found or empty:', error.message);
    }
  }

  registerModule(moduleName, moduleInstance) {
    // Check if moduleInstance has methods
    if (!moduleInstance || typeof moduleInstance !== 'object') {
      console.warn(`Module ${moduleName} is not a valid object`);
      return;
    }

    // Get all methods (including inherited ones)
    const methods = [];
    let obj = moduleInstance;
    while (obj && obj !== Object.prototype) {
      methods.push(...Object.getOwnPropertyNames(obj)
        .filter(method => method !== 'constructor' &&
          typeof obj[method] === 'function' &&
          !method.startsWith('_')));
      obj = Object.getPrototypeOf(obj);
    }

    // Remove duplicates
    const uniqueMethods = [...new Set(methods)];

    uniqueMethods.forEach(method => {
      const handlerName = `${moduleName}.${method}`;
      this.register(handlerName, moduleInstance[method].bind(moduleInstance));
    });
  }

  register(name, handler) {
    if (typeof handler !== 'function') {
      console.warn(`Handler for ${name} is not a function`);
      return;
    }
    this.modules.set(name, handler);
  }

  registerAlias(alias, handlerName) {
    if (!this.modules.has(handlerName)) {
      console.warn(`Cannot create alias ${alias} for non-existent handler ${handlerName}`);
      return;
    }
    this.moduleAliases.set(alias, handlerName);
  }

  getHandler(name) {
    // Check alias first
    if (this.moduleAliases.has(name)) {
      const realName = this.moduleAliases.get(name);
      return this.modules.get(realName);
    }

    // Check direct match
    return this.modules.get(name);
  }

  async execute(name, ...args) {
    const handler = this.getHandler(name);
    if (!handler) {
      console.error(`Handler not found: ${name}`);
      return null;
    }

    try {
      const result = await handler(...args);
      return result;
    } catch (error) {
      console.error(`Error executing handler ${name}:`, error);
      return {
        error: true,
        message: 'Handler execution failed',
        errorMessage: error.message
      };
    }
  }


  registerDefaultAliases() {
    // Register common aliases
    const aliases = {
      'pin.processPinOrForgot': 'pin.processPinOrForgot',
      'process_pin': 'pin.processPinOrForgot',
      'validate_pin': 'pin.validateCurrentPin',
      'balance.processBalanceRequest': 'balance.processBalanceRequest',
      'balance.processBalancePin': 'balance.processBalancePin',
      'balance.processBalanceConfirmation': 'balance.processBalanceConfirmation',
      'get_balance': 'balance.processBalanceRequest',
      'get_statement': 'statement.processStatementRequest',
      'buy_airtime': 'airtime.processAirtimePurchase',
      'forgot_pin': 'pin.processForgotPin'
    };

    Object.entries(aliases).forEach(([alias, handlerName]) => {
      if (this.modules.has(handlerName)) {
        this.registerAlias(alias, handlerName);
      }
    });
  }

  list() {
    const allHandlers = Array.from(this.modules.keys());
    const allAliases = Array.from(this.moduleAliases.keys());

    return {
      handlers: allHandlers,
      aliases: allAliases.map(alias => `${alias} -> ${this.moduleAliases.get(alias)}`)
    };
  }
}

const registry = new ModuleRegistry();
module.exports = registry;