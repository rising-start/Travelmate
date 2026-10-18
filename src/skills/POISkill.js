


class POISkill {
  constructor(mcp) {
    this.mcp = mcp;
  }

  

  normalizeKeywords(keywords) {
    if (!keywords) return '地点';

    const keywordMap = {
      好吃的: '餐厅',
      美食: '餐厅',
      吃饭: '餐厅',
      住: '酒店',
      玩: '景点',
      逛逛: '景点',
      购物: '商场',
    };

    const lower = keywords.toLowerCase();
    for (const [key, value] of Object.entries(keywordMap)) {
      if (lower.includes(key)) return value;
    }

    return keywords;
  }

  

  async searchWithFallback(center, keywords, radius, limit) {
    const geo = await this.mcp.geocode(center);
    if (!geo) return [];

    let pois = await this.mcp.searchNearby(geo, keywords, radius, limit);

    if (pois.length === 0 && radius < 2000) {
      console.log(`POISkill: 半径${radius}无结果，扩大到1500米`);
      pois = await this.mcp.searchNearby(geo, keywords, 1500, limit);
    }

    return pois;
  }

  

  formatPoiAnswer(pois, center, keywords) {
    if (pois.length === 0) {
      return (
        `抱歉，在${center}附近未找到${keywords}。\n\n` +
        '建议：\n' +
        '1. 尝试扩大搜索范围\n' +
        '2. 使用更通用的关键词\n' +
        '3. 检查地点名称是否正确'
      );
    }

    let answer = `在${center}附近找到以下${keywords}：\n\n`;
    pois.forEach((poi, index) => {
      answer += `${index + 1}. ${poi.name}（距离${poi.distance}米）\n`;
      if (poi.address) answer += `   地址：${poi.address}\n`;
      if (poi.tel) answer += `   电话：${poi.tel}\n`;
      answer += '\n';
    });
    answer += '还有其他需要帮助的吗？';

    return answer;
  }

  

  async execute(params, session) {
    try {
      let { center, keywords, radius = 500, limit = 10 } = params;

      if (!center && params.originalMessage) {
        const match = params.originalMessage.match(/(.+?)(?:附近|周边|周围)/);
        if (match && match[1]) {
          center = match[1].trim();
        }
      }

      let pois;
      const lat = session.currentLat;
      const lng = session.currentLng;

      keywords = this.normalizeKeywords(keywords);

      const hasLocationContext =
        center ||
        session.getLastSearchedLocation() ||
        session.getLastDestination() ||
        session.getLastMentionedLocation() ||
        session.getLastOrigin();

      if (!hasLocationContext && lat && lng) {
        pois = await this.mcp.searchNearby(
          { latitude: lat, longitude: lng },
          keywords,
          radius,
          limit
        );
        center = session.getCurrentLocation() || '当前位置';
      } else {
        if (!center) {
          center = session.getBestLocationForContext(
            params.originalMessage || ''
          );
          if (!center) {
            return await this.askUserLocation(session);
          }
        }

        pois = await this.searchWithFallback(center, keywords, radius, limit);
      }

      const displayResults = pois.slice(0, 5);
      const answer = this.formatPoiAnswer(displayResults, center, keywords);

      session.setLastPoiResults(pois);
      session.setLastPoiIndex(5);
      session.setLastPoiKeywords(keywords);
      session.updateLastSearchedLocation(center);

      return {
        thought: `POISkill: 在${center}附近搜索${keywords}`,
        answer: answer,
        data: {
          type: 'poi',
          center: center,
          keywords: keywords,
          results: displayResults.map((poi) => ({
            name: poi.name,
            distance: poi.distance,
            address: poi.address,
            tel: poi.tel,
            type: poi.type,
            lng: poi.location?.longitude,
            lat: poi.location?.latitude,
          })),
        },
      };
    } catch (error) {
      console.error('执行POI搜索技能失败:', error);
      return {
        thought: '执行失败',
        answer: '抱歉，搜索附近地点时出现了问题，请稍后重试。',
      };
    }
  }

  

  async askUserLocation(session) {
    session.pendingField = 'center';
    return {
      thought: '询问用户',
      answer: '请问您想在哪里附近搜索？',
    };
  }
}

module.exports = POISkill;