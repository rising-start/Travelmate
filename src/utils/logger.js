const { LOG_LEVEL } = require('../config/config');

// 日志级别由低到高：数值越小越重要，silent 关闭全部输出
const LEVEL_ORDER = {
  silent: -1,
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};
const DEFAULT_LEVEL = 'info';
// 命中这些关键词的字段值统一打码，避免密钥/令牌写进日志
const SENSITIVE_PATTERNS = [
  'key',
  'token',
  'secret',
  'password',
  'passwd',
  'authorization',
  'cookie',
  'signature'
];
const REDACTED = '***';
const MAX_DEPTH = 4;
const MAX_LINE_LENGTH = 2000;

function normalizeLevel(raw) {
  const level = String(raw || '')
    .trim()
    .toLowerCase();
  return LEVEL_ORDER[level] === undefined ? DEFAULT_LEVEL : level;
}

// 每次求值而非模块加载时缓存，便于运行期调整 process.env.LOG_LEVEL
function currentLevel() {
  const raw = process.env.LOG_LEVEL || LOG_LEVEL;
  if (!raw && process.env.DEBUG === 'true') {
    return 'debug';
  }
  return normalizeLevel(raw);
}

function isEnabled(level) {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel()];
}

function isSensitiveKey(key) {
  const normalized = String(key)
    .replace(/[_\-\s]/g, '')
    .toLowerCase();
  return SENSITIVE_PATTERNS.some(pattern => normalized.includes(pattern));
}

function redact(value, depth) {
  if (depth >= MAX_DEPTH) {
    return '[DeepObject]';
  }
  if (Array.isArray(value)) {
    return value.map(item => redact(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1);
    }
    return output;
  }
  return value;
}

function formatError(error) {
  const headline = `${error.name || 'Error'}: ${error.message || ''}`;
  return error.stack ? `${headline}\n${error.stack}` : headline;
}

function serialize(value) {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  // Error 的 message/stack 不可枚举，必须单独处理，否则 JSON.stringify 得到 {}
  if (value instanceof Error) {
    return formatError(value);
  }
  try {
    return JSON.stringify(redact(value, 0));
  } catch (error) {
    return '[Unserializable]';
  }
}

function truncate(line) {
  return line.length > MAX_LINE_LENGTH
    ? `${line.slice(0, MAX_LINE_LENGTH)}... [truncated ${line.length - MAX_LINE_LENGTH} chars]`
    : line;
}

function write(level, args) {
  if (!isEnabled(level)) {
    return;
  }
  const timestamp = new Date().toISOString();
  const body = args.map(arg => serialize(arg)).join(' ');
  const line = truncate(`[${timestamp}] [${level.toUpperCase()}] ${body}`);
  // 错误与告警走 stderr，便于容器侧单独采集
  if (level === 'error' || level === 'warn') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

function createLogger(prefix) {
  const emit = (level, args) => write(level, prefix ? [prefix, ...args] : args);
  return {
    error: (...args) => emit('error', args),
    warn: (...args) => emit('warn', args),
    info: (...args) => emit('info', args),
    debug: (...args) => emit('debug', args),
    // 附加固定上下文（如 requestId / sessionId），便于串联一次请求的日志
    child: context => {
      return createLogger(
        prefix ? `${prefix} ${serialize(context)}` : serialize(context)
      );
    },
    isLevelEnabled: level => isEnabled(normalizeLevel(level))
  };
}

module.exports = createLogger();
module.exports.createLogger = createLogger;
module.exports.currentLevel = currentLevel;
module.exports.LEVELS = Object.keys(LEVEL_ORDER);
