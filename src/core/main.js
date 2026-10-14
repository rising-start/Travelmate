const MCP = require('../services/mcp');
const WeatherService = require('../services/weather');
const WeatherAdvice = require('../services/weatherAdvice');
const LLMService = require('../services/llm');
const debug = require('../utils/debug');
const { getScoreWeights } = require('../config/config');

class TravelAssistant {
  constructor() {
    this.mcp = new MCP();
    this.weatherService = new WeatherService();
    this.llmService = new LLMService();
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
      const drivingRoute = await this.mcp.getDirections(
        geoOrigin,
        geoDest,
        'car'
      );
      const transitRoute = await this.mcp.getDirections(
        geoOrigin,
        geoDest,
        'transit'
      );
      const walkingRoute = await this.mcp.getDirections(
        geoOrigin,
        geoDest,
        'walk'
      );
      const cyclingRoute = await this.mcp.getDirections(
        geoOrigin,
        geoDest,
        'ride'
      );

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
        routes: {
          driving: drivingRoute,
          transit: transitRoute,
          walking: walkingRoute,
          cycling: cyclingRoute,
        },
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
