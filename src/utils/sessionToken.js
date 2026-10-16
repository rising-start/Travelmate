/**
 * 会话 ID 的签发与校验
 *
 * 背景：此前 sessionId 完全由客户端指定且无任何校验，任何人都可以通过
 * 枚举/猜测 sessionId 读取或改写他人会话（会话劫持）。
 *
 * 方案：服务端签发 `id.signature`（HMAC-SHA256），请求时校验签名，
 * 校验失败则视为无效会话并分配新会话；内部只使用签名前的 id 作为存储 key。
 */

const crypto = require('crypto');

// 生产环境请通过环境变量配置，否则进程重启后旧会话会失效
const SESSION_SECRET = process.env.SESSION_SECRET;
let secret = SESSION_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[安全] 未配置 SESSION_SECRET，已使用进程内随机密钥：服务重启后旧会话将失效'
  );
}

// 内部会话 ID 只允许安全字符，避免污染 Redis key
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_TOKEN_LENGTH = 160;

function sign(id) {
  return crypto.createHmac('sha256', secret).update(id).digest('base64url');
}

/**
 * 签发一个新的会话 ID（带签名）
 * @returns {string} 形如 `id.signature` 的会话 ID
 */
function issueSessionId() {
  const id = crypto.randomUUID().replace(/-/g, '');
  return `${id}.${sign(id)}`;
}

/**
 * 校验会话 ID 签名，返回可用于存储的内部 ID
 * @param {string} raw - 客户端传入的会话 ID
 * @returns {string|null} 合法则返回内部 ID，否则返回 null
 */
function verifySessionId(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) {
    return null;
  }
  const id = raw.slice(0, idx);
  const signature = raw.slice(idx + 1);
  if (!ID_PATTERN.test(id)) {
    return null;
  }
  const expected = sign(id);
  if (expected.length !== signature.length) {
    return null;
  }
  // 定长比较，避免时序侧信道
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  return id;
}

/**
 * 解析请求中的会话 ID
 * @param {string} raw - 客户端传入的会话 ID
 * @returns {{internalId: string, token: string, isNew: boolean}}
 *          internalId 用于服务端存储；token 是需要回传给客户端的完整 ID
 */
function resolveSessionId(raw) {
  const verified = verifySessionId(raw);
  if (verified) {
    return { internalId: verified, token: raw, isNew: false };
  }
  const token = issueSessionId();
  return {
    internalId: token.slice(0, token.lastIndexOf('.')),
    token,
    isNew: true
  };
}

module.exports = {
  issueSessionId,
  verifySessionId,
  resolveSessionId,
  ID_PATTERN
};
