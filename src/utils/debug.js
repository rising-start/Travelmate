const logger = require('./logger');

// 兼容层：保留旧的 debug.log / debug.error 调用方式（约 87 处），内部转分级日志。
// 关键区别：debug.error 不再受 DEBUG 开关控制，生产环境也会记录 API/LLM 失败，
// 否则排查时只能看到“返回空结果”而没有任何线索。
const debug = {
  log: (...args) => logger.debug(...args),
  error: (...args) => logger.error(...args)
};

module.exports = debug;
