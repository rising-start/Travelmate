const logger = require('./logger');

const debug = {
  log: (...args) => logger.debug(...args),
  error: (...args) => logger.error(...args)
};

module.exports = debug;
