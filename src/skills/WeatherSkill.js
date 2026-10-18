


class WeatherSkill {
  constructor(weather) {
    this.weather = weather;
  }

  

  getFallbackAdvice(location, time) {
    const timeText = time || '今天';
    return (
      `${location}${timeText}的天气信息暂时无法获取。\n\n` +
      '出行建议：\n' +
      '- 建议出行前查看当地天气预报\n' +
      '- 根据季节准备合适的衣物\n' +
      '- 如需更准确信息，请稍后重试'
    );
  }

  

  formatWeatherAnswer(weather, location, time) {
    const w = weather;
    const timeText = time ? `${time}的` : '当前';
    return (
      `${location}${timeText}天气：${w.text || '未知'}，` +
      `温度${w.temp || '?'}°C，` +
      `湿度${w.humidity || '?'}%，` +
      `风力${w.windDir || '?'} ${w.windScale || '?'}级`
    );
  }

  

  async execute(params, session) {
    let { location, locations, time, multi_location } = params;

    if (multi_location && locations && locations.length > 0) {
      const weatherResults = [];
      for (const loc of locations) {
        try {
          const weather = await this.weather.getWeatherByCityName(loc);
          if (weather && weather.weather) {
            weatherResults.push({
              location: loc,
              weather: weather.weather,
              advice: this.weather.generateSmartAdvice(weather.weather),
            });
          }
        } catch (error) {
          console.error(`获取${loc}天气失败:`, error);
        }
      }

      let answer = '';
      if (weatherResults.length === 2) {
        answer = `【起点 ${weatherResults[0].location}】的天气：\n`;
        answer += this.formatWeatherAnswer(
          weatherResults[0].weather,
          weatherResults[0].location,
          time
        );
        answer += '\n\n';
        answer += `【终点 ${weatherResults[1].location}】的天气：\n`;
        answer += this.formatWeatherAnswer(
          weatherResults[1].weather,
          weatherResults[1].location,
          time
        );
        answer += '\n\n💡 出行建议：\n';

        const originAdvice = weatherResults[0].advice.join('，');
        const destAdvice = weatherResults[1].advice.join('，');
        answer += `- 出发地：${originAdvice}\n`;
        answer += `- 目的地：${destAdvice}`;
      } else {
        answer = weatherResults
          .map(
            (r) =>
              `${r.location}：${this.formatWeatherAnswer(r.weather, r.location, time)}\n${r.advice.join('，')}`
          )
          .join('\n\n');
      }

      return {
        thought: `WeatherSkill: 多地点天气查询 ${locations.join(', ')}`,
        answer: answer,
      };
    }

    let targetLocation = location;
    if (!targetLocation) {
      targetLocation =
        session.getLastSearchedLocation() ||
        session.getLastDestination() ||
        session.getLastMentionedLocation();
      if (!targetLocation) {
        return await this.askUserLocation(session);
      }
    }

    let weather = null;
    let weatherError = false;
    try {
      weather = await this.weather.getWeatherByCityName(targetLocation);
      if (!weather || !weather.weather) {
        weatherError = true;
      }
    } catch (error) {
      console.error('WeatherSkill 查询失败:', error);
      weatherError = true;
    }

    let answer = '';

    if (weatherError) {
      answer = this.getFallbackAdvice(targetLocation, time);
    } else {
      answer = this.formatWeatherAnswer(weather.weather, targetLocation, time);
      const advice = this.weather.generateSmartAdvice(weather.weather);
      answer += '\n\n出行建议：\n';
      advice.forEach((item) => {
        answer += `- ${item}\n`;
      });

      const naturalAdvice = this.weather.generateNaturalLanguageAdvice(
        weather,
        targetLocation
      );
      if (naturalAdvice) {
        answer += '\n💡 ' + naturalAdvice;
      }
    }

    session.updateLastMentionedLocation(targetLocation);

    return {
      thought: `WeatherSkill: 为${targetLocation}生成${time || '今天'}的建议`,
      answer: answer,
    };
  }

  

  async askUserLocation(session) {
    session.pendingField = 'location';
    return {
      thought: '询问用户',
      answer: '请问您想查询哪个地点的天气？',
    };
  }
}

module.exports = WeatherSkill;