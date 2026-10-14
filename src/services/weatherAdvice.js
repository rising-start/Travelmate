class WeatherAdvice {
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

    return advice.length > 0 ? advice : ['天气适宜出行'];
  }

  static getWeatherAdvice(weather, location) {
    const advice = [];
    const weatherData = weather.weather;
    const temp = weatherData ? parseInt(weatherData.temp) : 20;
    const weatherDesc = weatherData ? weatherData.text : '';

    // 温度建议
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
    const originWeatherData = originWeather.weather;
    const destWeatherData = destWeather.weather;
    const originTemp = originWeatherData ? parseInt(originWeatherData.temp) : 20;
    const destTemp = destWeatherData ? parseInt(destWeatherData.temp) : 20;
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

    const originHasRain = originWeatherData ? originWeatherData.text.includes('雨') : false;
    const destHasRain = destWeatherData ? destWeatherData.text.includes('雨') : false;

    if (originHasRain && !destHasRain) {
      advice.push('出发地有雨，目的地无雨，到达后可收起雨伞');
    } else if (!originHasRain && destHasRain) {
      advice.push('目的地有雨，建议携带雨伞');
    }

    return advice;
  }
}

module.exports = WeatherAdvice;
