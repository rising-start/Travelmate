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

// 请求体大小上限：避免超大 payload 打爆进程内存
const MAX_BODY_BYTES = 64 * 1024;
// 限流窗口与阈值（单 IP）：/api/* 每次调用都可能触发 LLM/地图 API，必须限频
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;
// 限流桶硬上限：超出后先清理过期桶，仍满则按插入顺序淘汰最旧的
const RATE_LIMIT_BUCKET_LIMIT = 10000;
// 声明前置在可信反向代理之后（Nginx/Ingress），才会采信 X-Forwarded-For
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const rateBuckets = new Map();

// 只有在明确声明信任反向代理时才读 X-Forwarded-For：
// 直连场景下该头完全由客户端控制，照单全收等于把限流开关交给攻击者
function clientIp(req) {
  const forwarded = TRUST_PROXY ? req.headers['x-forwarded-for'] : null;
  const raw = forwarded || req.connection.remoteAddress || 'unknown';
  return String(raw)
    .split(',')[0]
    .trim();
}

// 清理所有过期桶，仅在条目数越过阈值时调用，避免每请求 O(n) 遍历
function pruneRateBuckets(now) {
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
      rateBuckets.delete(ip);
    }
  }
}

// 固定窗口限流
function isRateLimited(req) {
  const now = Date.now();
  const ip = clientIp(req);
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
    if (rateBuckets.size >= RATE_LIMIT_BUCKET_LIMIT) {
      pruneRateBuckets(now);
      // 清理后仍是满的：说明窗口内存活的 IP 极多，淘汰最早写入的条目，
      // 保证 Map 有硬上限，不会被伪造 IP 撑爆内存
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

// 统一读取请求体：按 Buffer 累加（避免多字节字符被 chunk 切开导致乱码），
// 超限返回 413 并以 Connection: close 收尾（直接 destroy 可能掐掉尚未刷出的响应）
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
    // 丢弃剩余请求体，让 socket 正常走完生命周期
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

// 简单的IP定位服务
class IpLocationService {
  // 模拟IP定位数据（实际项目中应调用真实的IP定位API）
  static getLocationByIp(ip) {
    return getDefaultIpLocation(ip);
  }
}

// 加载TravelAssistant
const TravelAssistant = require('../core/main');
// 加载MultiTurnTravelAssistant
const MultiTurnTravelAssistant = require('../core/multiTurnTravelAssistant');
// 创建MultiTurnTravelAssistant实例
const multiTurnAssistant = new MultiTurnTravelAssistant();

// 创建HTTP服务器
const server = http.createServer((req, res) => {
  // 统一限流：/api/* 每次调用都可能触发 LLM/地图 API，必须限制单 IP 频率
  if (req.url.startsWith('/api/') && isRateLimited(req)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: '请求过于频繁，请稍后再试' }));
    return;
  }

  // 处理IP定位请求
  if (req.url === '/api/ip-location') {
    // 获取客户端IP
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    debug.log('客户端IP:', clientIp);
    
    // 获取IP定位信息
    const location = IpLocationService.getLocationByIp(clientIp);
    
    // 返回定位结果
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: location
    }));
    return;
  }
  
  // 处理路线规划请求
  if (req.url === '/api/plan-route' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { origin, destination } = JSON.parse(body);
        debug.log('路线规划请求:', origin, '→', destination);
        
        // 使用TravelAssistant规划路线
        const assistant = new TravelAssistant();
        const result = await assistant.planRoute(origin, destination);
        
        // 返回路线规划结果
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

  // 处理意图识别请求
  if (req.url === '/api/process-input' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { input } = JSON.parse(body);
        debug.log('意图识别请求:', input);
        
        // 使用TravelAssistant处理用户输入
        const assistant = new TravelAssistant();
        const result = await assistant.processUserInput(input);
        
        // 返回意图识别结果
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
  
  // 由服务端签发会话ID，避免客户端自行指定导致会话被枚举/冒用
  if (req.url === '/api/session' && (req.method === 'POST' || req.method === 'GET')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, sessionId: issueSessionId() }));
    return;
  }

  // 更新会话中的当前位置
  if (req.url === '/api/update-location' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { sessionId, location, lat, lng } = JSON.parse(body);
        // 只接受服务端签发的会话ID
        const internalId = verifySessionId(sessionId);
        if (!internalId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '无效的会话ID' }));
          return;
        }
        debug.log('更新位置请求:', location, 'lat:', lat, 'lng:', lng);
        
        // 获取会话并更新当前位置
        if (multiTurnAssistant.sessionManager) {
          const session = await multiTurnAssistant.sessionManager.getSession(internalId);
          if (session) {
            session.currentLocation = location;
            // 保存坐标
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
  
  // 逆地理编码接口（使用周边搜索获取最近地标）
  if (req.url === '/api/reverse-geocode' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { latitude, longitude } = JSON.parse(body);
        debug.log('逆地理编码请求:', latitude, longitude);
        
        const apiKey = getMapApiKey();
        
        // 直接使用逆地理编码获取区域地址，不返回具体 POI
        const regeoUrl = `https://restapi.amap.com/v3/geocode/regeo?location=${longitude},${latitude}&key=${apiKey}&output=JSON`;
        const regeoResponse = await fetch(regeoUrl);
        const regeoData = await regeoResponse.json();
        
        if (regeoData.status === '1' && regeoData.regeocode) {
          // 获取区域名称（街道/镇级别）
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
          // 所有 API 调用失败，返回经纬度作为后备
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
  
  // 处理聊天请求（使用MultiTurnTravelAssistant）
  if (req.url === '/api/chat' && req.method === 'POST') {
    readJsonBody(req, res, async body => {
      try {
        const { message, sessionId } = JSON.parse(body);
        // 会话ID必须经服务端签名校验，非法则分配新会话，防止枚举/冒用他人会话
        const { internalId, token, isNew } = resolveSessionId(sessionId);
        if (isNew) {
          logger.warn('[安全] 收到无效会话ID，已为该请求分配新会话');
        }
        debug.log('聊天请求:', sanitizeUserInput(message, 100));
        
        // 使用MultiTurnTravelAssistant处理用户输入
        const result = await multiTurnAssistant.processUserInput(message, internalId);
        
        // 返回聊天结果（回传会话ID，便于客户端同步服务端签发的会话）
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
  
  // 处理静态文件请求
  // 静态文件根目录锁定为项目根目录，任何跳出该目录的请求都回落到 404
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
  // 防止路径遍历：normalize 后仍跳出静态根目录时返回 404 页面
  const relativePath = path.relative(staticRoot, filePath);
  const isInsideRoot =
    filePath === staticRoot ||
    (relativePath !== '' &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath));
  // 拒绝暴露项目内部文件：隐藏文件（.env/.git 等）与后端源码、依赖、数据目录
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

// 启动服务器
const env = require('../config/env');
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`服务器运行在 http://0.0.0.0:${PORT} 日志级别=${logger.currentLevel()}`);
});

// 关闭过程全局幂等：重复信号、信号与未捕获异常并发时只执行一次
let shuttingDown = false;
// 优雅关闭：停止清理定时器并释放 Redis 连接，否则进程无法自然退出
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info(`收到 ${signal}，正在关闭服务器...`);
  // 先设退出码让进程自然退出：stdout/stderr 走管道时是异步的，
  // 直接 process.exit() 会把最后几条日志截断
  process.exitCode = exitCode;
  const forceExit = () => process.exit(exitCode);
  server.close(() => {
    multiTurnAssistant.sessionManager
      .close()
      .catch(() => {})
      .finally(() => {
        // 仍有句柄未释放（如在途请求）时兜底强退
        setTimeout(forceExit, 3000).unref();
      });
  });
  // 兜底：连接迟迟不释放时强制退出
  setTimeout(forceExit, 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 未捕获异常：先落日志再退出，避免容器静默重启后无从排查
process.on('uncaughtException', error => {
  logger.error('未捕获异常，进程即将退出:', error);
  shutdown('uncaughtException', 1);
});
// 未处理的 Promise 拒绝通常不致命：记录后继续提供服务
process.on('unhandledRejection', reason => {
  logger.error(
    '未处理的 Promise 拒绝:',
    reason instanceof Error ? reason : new Error(String(reason))
  );
});
