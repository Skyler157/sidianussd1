const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');

class ConfigurationLoader {
  constructor() {
    this.configs = {};
    this.watchers = new Map();
    this.callbacks = new Map();
  }

  async loadAll() {
    const configDir = path.join(__dirname, '../..', 'config');
    
    await this.loadMenus();
    await this.loadApiEndpoints();
    await this.loadBusinessRules();
    await this.loadModuleConfigs();
    
    this.startWatchers();
  }

  async loadMenus() {
    const menusDir = path.join(__dirname, '../..', 'config/menus');
    const menuFiles = await this.getAllFiles(menusDir, '.json');
    
    this.configs.menus = {};
    for (const file of menuFiles) {
      const relativePath = path.relative(menusDir, file);
      const menuName = relativePath.replace('.json', '').replace(/\\/g, '_');
      
      try {
        const content = await fs.readFile(file, 'utf8');
        this.configs.menus[menuName] = JSON.parse(content);
      } catch (error) {
        console.warn(`Failed to load menu ${file}:`, error.message);
      }
    }
    
    console.log(`Loaded ${Object.keys(this.configs.menus).length} menu configurations`);
    this.notify('menus', this.configs.menus);
  }

  async loadApiEndpoints() {
    const configPath = path.join(__dirname, '../..', 'config/api-endpoints.json');
    try {
      const content = await fs.readFile(configPath, 'utf8');
      this.configs.apiEndpoints = JSON.parse(content);
      this.notify('apiEndpoints', this.configs.apiEndpoints);
    } catch (error) {
      console.warn('Failed to load API endpoints:', error.message);
    }
  }

  async loadBusinessRules() {
    const configPath = path.join(__dirname, '../..', 'config/business-rules.json');
    try {
      const content = await fs.readFile(configPath, 'utf8');
      this.configs.businessRules = JSON.parse(content);
      this.notify('businessRules', this.configs.businessRules);
    } catch (error) {
      console.warn('Failed to load business rules:', error.message);
    }
  }

  async loadModuleConfigs() {
    const modulesDir = path.join(__dirname, '..', 'modules');
    const configFiles = await this.getAllFiles(modulesDir, '.config.json');
    
    this.configs.modules = {};
    for (const file of configFiles) {
      const moduleName = path.basename(file, '.config.json');
      
      try {
        const content = await fs.readFile(file, 'utf8');
        this.configs.modules[moduleName] = JSON.parse(content);
      } catch (error) {
        // Ignore missing configs
      }
    }
  }

  async getAllFiles(dir, extension) {
    const files = [];
    
    async function walk(currentDir) {
      const items = await fs.readdir(currentDir, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(currentDir, item.name);
        
        if (item.isDirectory()) {
          await walk(fullPath);
        } else if (item.isFile() && item.name.endsWith(extension)) {
          files.push(fullPath);
        }
      }
    }
    
    await walk(dir);
    return files;
  }

  startWatchers() {
    const configDir = path.join(__dirname, '../..', 'config');
    
    // Watch for menu changes
    const menuWatcher = chokidar.watch(path.join(configDir, 'menus'), {
      persistent: true,
      ignoreInitial: true
    });
    
    menuWatcher.on('change', (filePath) => {
      console.log(`Menu file changed: ${filePath}`);
      this.loadMenus();
    });
    
    this.watchers.set('menus', menuWatcher);
  }

  on(event, callback) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event).push(callback);
  }

  notify(event, data) {
    const callbacks = this.callbacks.get(event) || [];
    callbacks.forEach(callback => callback(data));
  }

  getConfig(type) {
    return this.configs[type] || {};
  }

  getMenu(menuName) {
    return this.configs.menus?.[menuName];
  }
}

module.exports = new ConfigurationLoader();