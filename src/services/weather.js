const https = require('https');
const zlib = require('zlib');
const {
  getWeatherApiKey,
  WEATHER_BASE_URL,
  COMMON_CITIES,
  EXCLUDED_STREET_NAMES,
  ADCODE_TO_CITY_MAP,
} = require('../config/config');

const REQUEST_TIMEOUT = 10000;

class Weather {
  constructor(apiKey) {
    this.apiKey = apiKey || getWeatherApiKey();
    this.baseUrl = WEATHER_BASE_URL;
  }

  async requestQWeather(path, extraQuery, checkFn) {
    return new Promise((resolve) => {
      const sep = extraQuery ? '&' : '';
      const url = `${this.baseUrl}${path}?key=${this.apiKey}${sep}${extraQuery || ''}`;

      const req = https.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          console.error(`[Weather] HTTP ${res.statusCode}: ${path}`);
          resolve(null);
          return;
        }

        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            const encoding = (res.headers['content-encoding'] || '').toLowerCase();
            let dataStr;

            if (encoding === 'gzip') {
              dataStr = zlib.gunzipSync(buffer).toString();
            } else if (encoding === 'deflate') {
              dataStr = zlib.inflateSync(buffer).toString();
            } else if (encoding === 'br') {
              dataStr = zlib.brotliDecompressSync(buffer).toString();
            } else {
              dataStr = buffer.toString();
            }

            const result = JSON.parse(dataStr);
            resolve(checkFn(result));
          } catch (err) {
            console.error(`[Weather] 响应解析失败 (${path}):`, err.message);
            resolve(null);
          }
        });
      });

      req.setTimeout(REQUEST_TIMEOUT, () => {
        req.destroy();
        console.error(`[Weather] 请求超时 (${path})`);
        resolve(null);
      });

      req.on('error', (err) => {
        console.error(`[Weather] 请求失败 (${path}):`, err.message);
        resolve(null);
      });
    });
  }

  extractCityName(address) {
    for (const city of COMMON_CITIES) {
      if (address.includes(city)) {
        const isStreetName = EXCLUDED_STREET_NAMES.some(
          (street) => street.includes(city) && address.includes(street)
        );
        if (!isStreetName) {
          return city;
        }
      }
    }
    return address;
  }

  async getWeatherByCityName(cityName) {
    try {
      const extractedCityName = this.extractCityName(cityName);

      const cityId = await this.getCityId(extractedCityName);
      if (!cityId) {
        return null;
      }

      const weather = await this.getRealTimeWeather(cityId);
      if (!weather) {
        return null;
      }

      const warnings = await this.getWarnings(cityId);

      return {
        cityName,
        cityId,
        weather,
        airQuality: null,
        warnings: warnings || [],
        sunriseSunset: null,
      };
    } catch (error) {
      console.error('[Weather] getWeatherByCityName 异常:', error.message);
      return null;
    }
  }

  async getWeatherByAdcode(adcode) {
    try {
      const cityName = this.adcodeToCityName(adcode);
      if (!cityName) {
        return null;
      }
      return await this.getWeatherByCityName(cityName);
    } catch (error) {
      console.error('[Weather] getWeatherByAdcode 异常:', error.message);
      return null;
    }
  }

  async getCityId(cityName) {
    const encodedCityName = encodeURIComponent(cityName);
    return this.requestQWeather(
      '/geo/v2/city/lookup',
      `location=${encodedCityName}`,
      (result) => {
        if (
          result.code === '200' &&
          result.location &&
          result.location.length > 0
        ) {
          return result.location[0].id;
        }
        return null;
      }
    );
  }

  async getRealTimeWeather(cityId) {
    return this.requestQWeather(
      '/v7/weather/now',
      `location=${cityId}`,
      (result) => {
        if (result.code === '200' && result.now) {
          return result.now;
        }
        return null;
      }
    );
  }

  async getAirQuality(cityId) {
    return this.requestQWeather(
      '/v7/air/now',
      `location=${cityId}`,
      (result) => {
        if (result.code === '200' && result.now) {
          return result.now;
        }
        return null;
      }
    );
  }

  async getWarnings(cityId) {
    return this.requestQWeather(
      '/v7/warning/now',
      `location=${cityId}`,
      (result) => {
        if (result.code === '200' && result.warning) {
          return result.warning;
        }
        return [];
      }
    );
  }

  async getSunriseSunset(cityId) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const localDate = `${y}-${m}-${d}`;

    return this.requestQWeather(
      '/v7/astronomy/sun',
      `location=${cityId}&date=${localDate}`,
      (result) => {
        if (result.code === '200' && result.sun) {
          return result.sun;
        }
        return null;
      }
    );
  }

  adcodeToCityName(adcode) {
    return ADCODE_TO_CITY_MAP[adcode] || null;
  }

  generateSmartAdvice(weather) {
    const advice = [];

    if (!weather) {
      return advice;
    }

    const temp = parseInt(weather.temp);
    if (temp < 10) {
      advice.push('天气较冷，建议穿厚外套');
    } else if (temp < 18) {
      advice.push('天气凉爽，建议穿外套');
    } else if (temp < 26) {
      advice.push('天气舒适，建议穿长袖');
    } else {
      advice.push('天气炎热，建议穿短袖');
    }

    const text = weather.text;
    if (text.includes('雨')) {
      advice.push('有雨，建议带伞');
    } else if (text.includes('雪')) {
      advice.push('有雪，建议穿防滑鞋');
    } else if (text.includes('雾')) {
      advice.push('有雾，建议减速慢行');
    } else if (text.includes('霾')) {
      advice.push('有霾，建议戴口罩');
    } else if (text.includes('晴')) {
      advice.push('天气晴朗，建议戴墨镜');
    }

    const windScale = parseInt(weather.windScale);
    if (windScale >= 6) {
      advice.push('风力较大，注意安全');
    }

    return advice;
  }

  generateNaturalLanguageAdvice(weather, location) {
    if (!weather || !weather.weather) {
      return null;
    }

    const w = weather.weather;
    const temp = parseInt(w.temp);
    const text = w.text || '';
    const humidity = w.humidity || 0;
    const windScale = parseInt(w.windScale) || 0;
    const windDir = w.windDir || '';

    const suggestions = [];

    if (temp < 10) {
      suggestions.push(`降温啦！今天${location}只有${temp}°C，记得穿厚外套🧥`);
    } else if (temp < 18) {
      suggestions.push(`天气转凉啦！${location}现在${temp}°C，外套要穿好哦🧣`);
    } else if (temp < 26) {
      suggestions.push(`今天${location}天气舒适，${temp}°C，穿长袖刚刚好👕`);
    } else if (temp < 32) {
      suggestions.push(`天气有点热！${location}达到${temp}°C，记得补充水分💧`);
    } else {
      suggestions.push(`高温预警！${location}今天${temp}°C，注意防暑防晒🌞`);
    }

    if (text.includes('雨') || text.includes('暴雨')) {
      suggestions.push('今天有雨🌧️，出门前记得带伞☂️');
    } else if (text.includes('雪')) {
      suggestions.push('有雪❄️，道路可能湿滑，开车慢点注意安全🚗');
    } else if (text.includes('雾')) {
      suggestions.push('有雾🌫️，能见度较低，出行注意安全🚶');
    } else if (text.includes('霾') || text.includes('沙尘')) {
      suggestions.push('空气质量欠佳😷，建议戴口罩出门💨');
    } else if (text.includes('晴') && temp > 30) {
      suggestions.push('阳光强烈☀️，记得戴墨镜保护眼睛😎');
    }

    if (humidity > 80) {
      suggestions.push(`湿度较高${humidity}%💦，可能会有点闷热`);
    } else if (humidity < 30) {
      suggestions.push('空气有点干燥🥵，注意补水保湿💧');
    }

    if (windScale >= 6) {
      suggestions.push(
        `今天风力较大${windDir}${windScale}级🌬️，户外活动注意安全`
      );
    } else if (windScale >= 4) {
      suggestions.push('有微风🍃，出行舒适');
    }

    return suggestions.join('；') + '。';
  }
}

module.exports = Weather;
