const { DEBUG } = require('../config/config');

const debug = {
  log: (...args) => {
    if (DEBUG) {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] ` + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      console.log(logMessage);
    }
  },
  error: (...args) => {
    if (DEBUG) {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] ERROR: ` + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      console.error(logMessage);
    }
  },
};

module.exports = debug;