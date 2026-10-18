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

  isRouteRequest(input) {
    const { origin, destination } = this.parseRouteEndpoints(input);
    if (!origin || !destination) {
      return false;
    }
    const text = typeof input === 'string' ? input : '';
    const hasFromPattern = /从\s*.+?\s*(?:到|去)/.test(text);
    const hasRouteKeyword = /怎么走|怎么去|出行方案|路线|乘车|驾车|公交|地铁/.test(
      text
    );
    return hasFromPattern || hasRouteKeyword;
  }

  async planRoute(origin, destination) {
    try {
      const geoOrigin = await this.mcp.geocode(origin);
      const geoDest = await this.mcp.geocode(destination);

      if (!geoOrigin || !geoDest) {
        return {
          success: false,
          error: '无法获取起点或终点的位置信息',
        };
      }

      const originWeather = await this.weatherService.getWeatherByCityName(origin);
      const destWeather = await this.weatherService.getWeatherByCityName(destination);

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

      const weatherAdvice = WeatherAdvice.getAdvice(originWeather, destWeather);

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
      if (this.isRouteRequest(input)) {
        const { origin, destination } = this.parseRouteEndpoints(input);
        const session = new ConversationSession(`process-${Date.now()}`);
        try {
          const routeResult = await this.routeSkill.handlePlanRoute(
            { origin, destination, originalMessage: input },
            session
          );
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
      const geoLocation = await this.mcp.geocode(location);
      if (!geoLocation) {
        return {
          success: false,
          error: '无法获取位置信息',
        };
      }

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
