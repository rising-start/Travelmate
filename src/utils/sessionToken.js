


const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET;
let secret = SESSION_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[安全] 未配置 SESSION_SECRET，已使用进程内随机密钥：服务重启后旧会话将失效'
  );
}

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_TOKEN_LENGTH = 160;

function sign(id) {
  return crypto.createHmac('sha256', secret).update(id).digest('base64url');
}



function issueSessionId() {
  const id = crypto.randomUUID().replace(/-/g, '');
  return `${id}.${sign(id)}`;
}



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
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  return id;
}



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
