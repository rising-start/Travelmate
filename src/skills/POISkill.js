/**
 * POISkill - 处理周边搜索相关功能
 */

class POISkill {
  constructor(mcp) {
    this.mcp = mcp;
  }

  /**
   * 标准化关键词
   * @param {string} keywords - 关键词
   * @returns {string} - 标准化后的关键词
   */
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

  /**
   * 搜索并处理 fallback
   * @param {string} center - 中心点
   * @param {string} keywords - 关键词
   * @param {number} radius - 半径
   * @param {number} limit - 限制
   * @returns {Promise<Array>} - 搜索结果
   */
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

  /**
   * 格式化POI回答
   * @param {Array} pois - POI列表
   * @param {string} center - 中心点
   * @param {string} keywords - 关键词
   * @returns {string} - 格式化的回答
   */
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

  /**
   * 执行POI搜索技能
   * @param {Object} params - 参数
   * @param {Object} session - 会话对象
   * @returns {Promise<Object>} - 执行结果
   */
  async execute(params, session) {
    try {
      let { center, keywords, radius = 500, limit = 10 } = params;

      // 从原始消息提取中心点
      if (!center && params.originalMessage) {
        const match = params.originalMessage.match(/(.+?)(?:附近|周边|周围)/);
        if (match && match[1]) {
          center = match[1].trim();
        }
      }

      // 优先使用坐标作为中心点
      let pois;
      const lat = session.currentLat;
      const lng = session.currentLng;

      // 处理关键词
      keywords = this.normalizeKeywords(keywords);

      // 关键：只有当用户输入无法解析出任何地点线索时，才回退到GPS
      const hasLocationContext =
        center ||
        session.getLastSearchedLocation() ||
        session.getLastDestination() ||
        session.getLastMentionedLocation() ||
        session.getLastOrigin();

      if (!hasLocationContext && lat && lng) {
        // 无任何地点上下文时才用GPS
        pois = await this.mcp.searchNearby(
          { latitude: lat, longitude: lng },
          keywords,
          radius,
          limit
        );
        // 使用当前位置作为中心点显示
        center = session.getCurrentLocation() || '当前位置';
      } else {
        // 有上下文时，走地名搜索逻辑（会自然使用历史地点）
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

      // 只显示前5个结果
      const displayResults = pois.slice(0, 5);
      const answer = this.formatPoiAnswer(displayResults, center, keywords);

      // 保存所有结果并设置索引为5（已显示5个）
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

  /**
   * 询问用户地点
   * @param {Object} session - 会话对象
   * @returns {Object} - 询问结果
   */
  async askUserLocation(session) {
    session.pendingField = 'center';
    return {
      thought: '询问用户',
      answer: '请问您想在哪里附近搜索？',
    };
  }
}

module.exports = POISkill;