// src/modules/module.registry.js
const airtimeModule = require('./airtime.module');
const balanceModule = require('./balance.module');
const statementModule = require('./statement.module');
const pinModule = require('./pin.module');

class ModuleRegistry {
  constructor() {
    this.modules = new Map();
    this.registerDefaultModules();
  }

  registerDefaultModules() {
    // Auto-register all methods from modules
    this.registerModuleMethods('airtime', airtimeModule);
    this.registerModuleMethods('balance', balanceModule);
    this.registerModuleMethods('statement', statementModule);
    this.registerModuleMethods('pin', pinModule);
  }

  registerModuleMethods(moduleName, module) {
    // Get all method names
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(module))
      .filter(method => method !== 'constructor' && typeof module[method] === 'function');
    
    // Register each method
    methodNames.forEach(method => {
      const handlerName = `${moduleName}_${method}`;
      this.register(handlerName, module[method].bind(module));
      console.log(`Registered: ${handlerName}`);
    });
  }

  register(name, handler) {
    this.modules.set(name, handler);
  }

  get(name) {
    return this.modules.get(name);
  }

  async execute(name, ...args) {
    const handler = this.get(name);
    if (!handler) {
      throw new Error(`Handler not found: ${name}`);
    }
    return await handler(...args);
  }

  has(name) {
    return this.modules.has(name);
  }

  list() {
    return Array.from(this.modules.keys());
  }
}

module.exports = new ModuleRegistry();