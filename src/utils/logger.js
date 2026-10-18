const { LOG_LEVEL } = require('../config/config');

const LEVEL_ORDER = Object.freeze({
  silent: -1,
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
});
const DEFAULT_LEVEL = 'info';
const SENSITIVE_TOKENS = new Set([
  'key',
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'credential',
  'authorization',
  'auth',
  'cookie',
  'signature'
]);
const REDACTED = '***';
const MAX_DEPTH = 4;
const MAX_LINE_LENGTH = 2000;

function normalizeLevel(raw) {
  const level = String(raw || '')
    .trim()
    .toLowerCase();
  const owned = Object.prototype.hasOwnProperty.call(LEVEL_ORDER, level);
  return owned ? level : DEFAULT_LEVEL;
}

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

function splitTokens(key) {
  return String(key)
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
}

function isSensitiveKey(key) {
  return splitTokens(key).some(token => {
    const singular = token.endsWith('s') ? token.slice(0, -1) : token;
    return SENSITIVE_TOKENS.has(token) || SENSITIVE_TOKENS.has(singular);
  });
}

function redact(value, depth) {
  if (depth >= MAX_DEPTH) {
    return '[DeepObject]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Error) {
    return formatError(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length}B]`;
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (typeof value === 'function') {
    return '[Function]';
  }
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => redact(item, depth + 1));
  }
  if (value instanceof Map) {
    const output = {};
    value.forEach((item, key) => {
      output[String(key)] = isSensitiveKey(String(key))
        ? REDACTED
        : redact(item, depth + 1);
    });
    return output;
  }
  if (value instanceof Set) {
    return [...value].map(item => redact(item, depth + 1));
  }
  if (typeof value === 'object') {
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
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
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
    child: context => {
      if (context === undefined || context === null) {
        return createLogger(prefix);
      }
      return createLogger(
        prefix ? `${prefix} ${serialize(context)}` : serialize(context)
      );
    },
    isLevelEnabled: level => {
      const normalized = String(level || '')
        .trim()
        .toLowerCase();
      const owned = Object.prototype.hasOwnProperty.call(
        LEVEL_ORDER,
        normalized
      );
      return owned && isEnabled(normalized);
    }
  };
}

module.exports = createLogger();
module.exports.createLogger = createLogger;
module.exports.currentLevel = currentLevel;
module.exports.LEVELS = Object.keys(LEVEL_ORDER);
