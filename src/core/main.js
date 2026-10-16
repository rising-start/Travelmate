const MCP = require('../services/mcp');
const WeatherService = require('../services/weather');
const WeatherAdvice = require('../services/weatherAdvice');
const LLMService = require('../services/llm');
const debug = require('../utils/debug');
const { getScoreWeights } = require('../config/config');
const RouteSkill = require('../skills/RouteSkill');
const { ConversationSession } = require('../session/conversationSession');

class TravelAssistant {
  constructor() {
    this.mcp = new MCP();
    this.weatherService = new WeatherService();
    this.llmService = new LLMService();
    this.routeSkill = new RouteSkill(this.mcp, this.weatherService);
  }

  // 从"从 X 到 Y"这类输入里取起点与终点，取不到时返回 null
  parseRouteEndpoints(input) {
    const text = typeof input === 'string' ? input : '';
    const fromMatch = text.match(/从\s*(.+?)\s*(?:到|去)\s*(.+)/);
    if (fromMatch) {
      return { origin: fromMatch[1].trim(), destination: fromMatch[2].trim() };
    }
    const plainMatch = text.match(/^(.+?)\s*(?:到|去)\s*(.+)$/);
    if (plainMatch) {
      return { origin: plainMatch[1].trim(), destination: plainMatch[2].trim() };
    }
    return { origin: null, destination: null };
  }

  // 必须同时解析出起点与终点才算路线请求：
  // 只按关键词判断会把"附近有地铁站吗"这类 POI 问题误吞成路线请求
  isRouteRequest(input) {
    const { origin, destination } = this.parseRouteEndpoints(input);
    return Boolean(origin && destination);
  }

  async planRoute(origin, destination) {
    try {
      // 1. 获取地理编码
      const geoOrigin = await this.mcp.geocode(origin);
      const geoDest = await this.mcp.geocode(destination);

      if (!geoOrigin || !geoDest) {
        return {
          success: false,
          error: '无法获取起点或终点的位置信息',
        };
      }

      // 2. 获取天气信息
      const originWeather = await this.weatherService.getWeatherByCityName(origin);
      const destWeather = await this.weatherService.getWeatherByCityName(destination);

      // 3. 规划路线
      // getDirections 签名为 (originAddress, destinationAddress, originCoord, destCoord)，
      // 旧代码把坐标对象当地址传入、把 'car'/'walk' 当 coord，导致一律抛错返回 []。
      // 该方法一次返回全部交通方式，这里按 type 字段分组。
      const directions = await this.mcp.getDirections(
        origin,
        destination,
        geoOrigin,
        geoDest
      );
      const directionList = Array.isArray(directions) ? directions : [];
      const pickFirst = type =>
        directionList.find(item => item && item.type === type) || null;
      const routes = {
        driving: pickFirst('驾车'),
        transit: directionList.filter(item => item && item.type === '公交'),
        walking: pickFirst('步行'),
        cycling: pickFirst('骑行')
      };

      // 4. 生成天气建议
      const weatherAdvice = WeatherAdvice.getAdvice(originWeather, destWeather);

      // 5. 整合结果
      const result = {
        success: true,
        origin: {
          name: origin,
          location: geoOrigin,
        },
        destination: {
          name: destination,
          location: geoDest,
        },
        routes,
        weather: {
          origin: originWeather,
          destination: destWeather,
        },
        advice: weatherAdvice,
      };

      return result;
    } catch (error) {
      debug.error('路线规划错误:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async processUserInput(input) {
    try {
      // 路线请求统一交给 RouteSkill：llm.reactLoop 不再自己拼路线结果
      if (this.isRouteRequest(input)) {
        const { origin, destination } = this.parseRouteEndpoints(input);
        const session = new ConversationSession(`process-${Date.now()}`);
        try {
          const routeResult = await this.routeSkill.handlePlanRoute(
            { origin, destination, originalMessage: input },
            session
          );
          // 只有真正拿到路线结果才返回，否则回落到 LLM 工具循环
          if (
            routeResult &&
            routeResult.answer &&
            !routeResult.needs_user_input
          ) {
            return {
              success: true,
              thought: routeResult.thought,
              answer: routeResult.answer,
            };
          }
        } catch (error) {
          debug.error('RouteSkill 处理失败，回落到 reactLoop:', error);
        }
      }

      // 使用LLM处理用户输入
      const llmResult = await this.llmService.reactLoop(input, {
        geocode: this.mcp.geocode.bind(this.mcp),
        get_directions: this.mcp.getDirections.bind(this.mcp),
        route_bicycling: this.mcp.bicycling.bind(this.mcp),
        route_walking: this.mcp.walking.bind(this.mcp),
        search_nearby: this.mcp.searchNearby.bind(this.mcp),
        weather: this.weatherService.getWeatherByCityName.bind(this.weatherService),
        travel_advice: this.getTravelAdvice.bind(this)
      });

      return llmResult;
    } catch (error) {
      debug.error('处理用户输入错误:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getTravelAdvice(location, type) {
    try {
      const weather = await this.weatherService.getWeatherByCityName(location);
      if (weather) {
        return this.weatherService.generateSmartAdvice(weather.weather);
      }
      return [];
    } catch (error) {
      console.error('获取出行建议失败:', error);
      return [];
    }
  }

  async searchNearby(location, keywords, radius = 1000, limit = 10) {
    try {
      // 获取地理编码
      const geoLocation = await this.mcp.geocode(location);
      if (!geoLocation) {
        return {
          success: false,
          error: '无法获取位置信息',
        };
      }

      // 搜索周边
      const pois = await this.mcp.searchNearby(
        geoLocation,
        keywords,
        radius,
        limit
      );

      return {
        success: true,
        location: location,
        pois: pois,
      };
    } catch (error) {
      debug.error('周边搜索错误:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = TravelAssistant;
