const http = require('http');
const fs = require('fs');
const path = require('path');
const debug = require('../utils/debug');
const { getMapApiKey, getDefaultIpLocation } = require('../config/config');

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
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
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
        console.error('路线规划错误:', error);
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
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
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
        console.error('意图识别错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });
    return;
  }
  
  // 更新会话中的当前位置
  if (req.url === '/api/update-location' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const { sessionId, location, lat, lng } = JSON.parse(body);
        debug.log('更新位置请求:', location, 'lat:', lat, 'lng:', lng, 'sessionId:', sessionId);
        
        // 获取会话并更新当前位置
        if (sessionId && multiTurnAssistant.sessionManager) {
          const session = multiTurnAssistant.sessionManager.getSession(sessionId);
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
        console.error('更新位置错误:', error);
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
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
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
        console.error('逆地理编码错误:', error);
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
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const { message, sessionId } = JSON.parse(body);
        debug.log('聊天请求:', message, 'sessionId:', sessionId);
        
        // 使用MultiTurnTravelAssistant处理用户输入
        const result = await multiTurnAssistant.processUserInput(message, sessionId);
        
        // 返回聊天结果
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        console.error('聊天处理错误:', error);
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
  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
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
        fs.readFile('./404.html', (error, content) => {
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
  console.log(`服务器运行在 http://0.0.0.0:${PORT}`);
});