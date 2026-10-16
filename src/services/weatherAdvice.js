class WeatherAdvice {
  // 解析温度：失败时返回 null，避免把"未知温度"当成默认值给出误导性建议
  static parseTemp(weather) {
    const raw = weather && weather.weather ? weather.weather.temp : null;
    const temp = parseInt(raw, 10);
    return Number.isNaN(temp) ? null : temp;
  }

  // 天气描述统一转字符串，避免 text 为 null 时 .includes 抛 TypeError
  static getWeatherText(weather) {
    const text = weather && weather.weather ? weather.weather.text : '';
    return typeof text === 'string' ? text : '';
  }

  static getAdvice(originWeather, destWeather) {
    const advice = [];

    // 起点天气建议
    if (originWeather) {
      advice.push(...this.getWeatherAdvice(originWeather, '出发地'));
    }

    // 目的地天气建议
    if (destWeather) {
      advice.push(...this.getWeatherAdvice(destWeather, '目的地'));
    }

    // 天气对比建议
    if (originWeather && destWeather) {
      advice.push(
        ...this.getWeatherComparisonAdvice(originWeather, destWeather)
      );
    }

    // 没拿到天气数据时不要编造"适宜出行"
    return advice.length > 0
      ? advice
      : ['暂未获取到天气信息，出行前请查询最新天气预报'];
  }

  static getWeatherAdvice(weather, location) {
    const advice = [];
    const temp = this.parseTemp(weather);
    const weatherDesc = this.getWeatherText(weather);

    // 温度建议（温度未知时不给穿衣建议）
    if (temp !== null) {
      if (temp < 5) {
        advice.push(`${location}温度较低，建议穿厚外套、羽绒服等保暖衣物`);
      } else if (temp < 15) {
        advice.push(`${location}温度适中，建议穿外套`);
      } else if (temp < 25) {
        advice.push(`${location}温度适宜，建议穿长袖衬衫或薄外套`);
      } else if (temp < 30) {
        advice.push(`${location}温度较高，建议穿短袖、短裤等清凉衣物`);
      } else {
        advice.push(`${location}温度很高，建议穿轻薄透气衣物，注意防暑`);
      }
    }

    // 天气状况建议
    if (weatherDesc.includes('雨')) {
      advice.push(`${location}有雨，建议携带雨伞`);
    } else if (weatherDesc.includes('雪')) {
      advice.push(`${location}有雪，建议穿防滑鞋，注意保暖`);
    } else if (weatherDesc.includes('雾') || weatherDesc.includes('霾')) {
      advice.push(`${location}能见度低，注意行车安全`);
    } else if (weatherDesc.includes('风')) {
      advice.push(`${location}有风，建议适当添加衣物`);
    } else if (weatherDesc.includes('晴') && temp > 25) {
      advice.push(`${location}晴天且温度较高，建议涂抹防晒霜`);
    }

    return advice;
  }

  static getWeatherComparisonAdvice(originWeather, destWeather) {
    const advice = [];
    const originTemp = this.parseTemp(originWeather);
    const destTemp = this.parseTemp(destWeather);
    // 任一温度未知时不做温差建议，避免用默认值算出错温差
    if (originTemp === null || destTemp === null) {
      return advice;
    }
    const tempDiff = destTemp - originTemp;

    if (Math.abs(tempDiff) > 10) {
      if (tempDiff > 0) {
        advice.push(
          `目的地比出发地温度高${tempDiff.toFixed(1)}℃，建议减少衣物`
        );
      } else {
        advice.push(
          `目的地比出发地温度低${Math.abs(tempDiff).toFixed(1)}℃，建议增加衣物`
        );
      }
    }

    const originHasRain = this.getWeatherText(originWeather).includes('雨');
    const destHasRain = this.getWeatherText(destWeather).includes('雨');

    if (originHasRain && !destHasRain) {
      advice.push('出发地有雨，目的地无雨，到达后可收起雨伞');
    } else if (!originHasRain && destHasRain) {
      advice.push('目的地有雨，建议携带雨伞');
    }

    return advice;
  }
}

module.exports = WeatherAdvice;
