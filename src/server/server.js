const http = require('http');
const fs = require('fs');
const path = require('path');
const debug = require('../utils/debug');
const logger = require('../utils/logger');
const { getMapApiKey, getDefaultIpLocation } = require('../config/config');
const {
  issueSessionId,
  resolveSessionId,
  verifySessionId,
} = require('../utils/sessionToken');
const { sanitizeUserInput } = require('../utils/inputGuard');

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_BUCKET_LIMIT = 10000;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const rateBuckets = new Map();

function clientIp(req) {
  const forwarded = TRUST_PROXY ? req.headers['x-forwarded-for'] : null;
  const raw = forwarded || req.connection.remoteAddress || 'unknown';
  return String(raw)
    .split(',')[0]
    .trim();
}

function pruneRateBuckets(now) {
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
      rateBuckets.delete(ip);
    }
  }
}

function isRateLimited(req) {
  const now = Date.now();
  const ip = clientIp(req);
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
    if (rateBuckets.size >= RATE_LIMIT_BUCKET_LIMIT) {
      pruneRateBuckets(now);
      while (rateBuckets.size >= RATE_LIMIT_BUCKET_LIMIT) {
        rateBuckets.delete(rateBuckets.keys().next().value);
      }
    }
    bucket = { start: now, count: 1 };
    rateBuckets.set(ip, bucket);
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function readJsonBody(req, res, handler) {
  const chunks = [];
  let size = 0;
  let settled = false;

  const fail = (status, message) => {
    settled = true;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      Connection: 'close'
    });
    res.end(JSON.stringify({ success: false, error: message }));
  };

  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    fail(413, '请求体过大');
    req.resume();
    return;
  }

  req.on('data', chunk => {
    if (settled) {
      return;
    }
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      fail(413, '请求体过大');
      req.resume();
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', () => {
    if (!settled) {
      fail(400, '请求读取失败');
    }
  });
  req.on('end', () => {
    if (!settled) {
      handler(Buffer.concat(chunks).toString('utf8'));
    }
  });
}

class IpLocationService {
  static getLocationByIp(ip) {
    return getDefaultIpLocation(ip);
  }
}

const TravelAssistant = require('../core/main');
const MultiTurnTravelAssistant = require('../core/multiTurnTravelAssistant');
const multiTurnAssistant = new MultiTurnTravelAssistant();

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/') && isRateLimited(req)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: '请求过于频繁，请稍后再试' }));
    return;
  }

  if (req.url === '/api/ip-location') {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    debug.log('客户端IP:', clientIp);
    
    const location = IpLocationService.getLocationByIp(clientIp);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: location
    }));
    return;
  }
  
  if (req.url === '/api/plan-route' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { origin, destination } = JSON.parse(body);
        debug.log('路线规划请求:', origin, '→', destination);
        
        const assistant = new TravelAssistant();
        const result = await assistant.planRoute(origin, destination);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        logger.error('路线规划错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });
    return;
  }

  if (req.url === '/api/process-input' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { input } = JSON.parse(body);
        debug.log('意图识别请求:', input);
        
        const assistant = new TravelAssistant();
        const result = await assistant.processUserInput(input);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        logger.error('意图识别错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });
    return;
  }
  
  if (req.url === '/api/session' && (req.method === 'POST' || req.method === 'GET')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, sessionId: issueSessionId() }));
    return;
  }

  if (req.url === '/api/update-location' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { sessionId, location, lat, lng } = JSON.parse(body);
        const internalId = verifySessionId(sessionId);
        if (!internalId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '无效的会话ID' }));
          return;
        }
        debug.log('更新位置请求:', location, 'lat:', lat, 'lng:', lng);
        
        if (multiTurnAssistant.sessionManager) {
          const session = await multiTurnAssistant.sessionManager.getSession(internalId);
          if (session) {
            session.currentLocation = location;
            if (lat && lng) {
              session.currentLat = lat;
              session.currentLng = lng;
              debug.log('坐标已更新:', lat, lng);
            }
            debug.log('位置已更新:', location);
          }
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        logger.error('更新位置错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });
    return;
  }
  
  if (req.url === '/api/reverse-geocode' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { latitude, longitude } = JSON.parse(body);
        debug.log('逆地理编码请求:', latitude, longitude);
        
        const apiKey = getMapApiKey();
        
        const regeoUrl = `https://restapi.amap.com/v3/geocode/regeo?location=${longitude},${latitude}&key=${apiKey}&output=JSON`;
        const regeoResponse = await fetch(regeoUrl);
        const regeoData = await regeoResponse.json();
        
        if (regeoData.status === '1' && regeoData.regeocode) {
          const addressComponent = regeoData.regeocode.addressComponent;
          const areaName = `${addressComponent.city}${addressComponent.district}${addressComponent.township || ''}`;
          const locationName = areaName || '当前位置';
          debug.log('逆地理编码成功，区域地址:', locationName);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            location: locationName 
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            location: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` 
          }));
        }
      } catch (error) {
        logger.error('逆地理编码错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });
    return;
  }
  
  if (req.url === '/api/chat' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { message, sessionId } = JSON.parse(body);
        const { internalId, token, isNew } = resolveSessionId(sessionId);
        if (isNew) {
          logger.warn('[安全] 收到无效会话ID，已为该请求分配新会话');
        }
        debug.log('聊天请求:', sanitizeUserInput(message, 100));
        
        const result = await multiTurnAssistant.processUserInput(message, internalId);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...result, sessionId: token }));
      } catch (error) {
        logger.error('聊天处理错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });
    return;
  }
  
  const staticRoot = path.resolve(__dirname, '..', '..');
  let requestedPath = req.url.split('?')[0];
  try {
    requestedPath = decodeURIComponent(requestedPath);
  } catch (error) {
    requestedPath = req.url.split('?')[0];
  }
  if (requestedPath === '/' || requestedPath === '') {
    requestedPath = '/index.html';
  }

  let filePath = path.resolve(
    staticRoot,
    '.' + path.posix.normalize(requestedPath)
  );
  const relativePath = path.relative(staticRoot, filePath);
  const isInsideRoot =
    filePath === staticRoot ||
    (relativePath !== '' &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath));
  const segments = relativePath.split(path.sep).filter(Boolean);
  const blockedDirs = ['node_modules', 'volumes', 'src', 'test', 'data'];
  const firstSegment = segments[0] || '';
  const isHidden = segments.some(seg => seg.startsWith('.'));
  const isBlocked =
    isHidden || blockedDirs.includes(firstSegment) || firstSegment === '';

  if (!isInsideRoot || isBlocked) {
    filePath = path.join(staticRoot, '404.html');
  }
  
  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
  };
  
  const contentType = mimeTypes[extname] || 'application/octet-stream';
  
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code == 'ENOENT') {
        fs.readFile(path.join(staticRoot, '404.html'), (error, content) => {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end(content, 'utf-8');
        });
      } else {
        res.writeHead(500);
        res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
        res.end();
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const env = require('../config/env');
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`服务器运行在 http://0.0.0.0:${PORT} 日志级别=${logger.currentLevel()}`);
});

let shuttingDown = false;
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info(`收到 ${signal}，正在关闭服务器...`);
  process.exitCode = exitCode;
  const forceExit = () => process.exit(exitCode);
  server.close(() => {
    multiTurnAssistant.sessionManager
      .close()
      .catch(() => {})
      .finally(() => {
        setTimeout(forceExit, 3000).unref();
      });
  });
  setTimeout(forceExit, 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', error => {
  logger.error('未捕获异常，进程即将退出:', error);
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', reason => {
  logger.error(
    '未处理的 Promise 拒绝:',
    reason instanceof Error ? reason : new Error(String(reason))
  );
});
