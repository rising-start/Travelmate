/**
 * ShowMoreSkill - 处理显示更多结果功能
 */

class ShowMoreSkill {
  /**
   * 执行显示更多结果技能
   * @param {Object} params - 参数
   * @param {Object} session - 会话对象
   * @returns {Promise<Object>} - 执行结果
   */
  async execute(params, session) {
    try {
      const lastPoiResults = session.getLastPoiResults();
      const currentIndex = session.getLastPoiIndex();

      if (!lastPoiResults || lastPoiResults.length === 0) {
        return {
          thought: '没有历史搜索结果',
          answer: '抱歉，没有更多结果了。请先搜索一个地点。',
        };
      }

      if (lastPoiResults.length <= currentIndex) {
        return {
          thought: '没有更多结果',
          answer: '抱歉，没有更多结果了。',
        };
      }

      const nextResults = lastPoiResults.slice(currentIndex, currentIndex + 5);
      session.setLastPoiIndex(currentIndex + nextResults.length);

      if (nextResults.length === 0) {
        return {
          thought: '没有更多结果',
          answer: '抱歉，没有更多结果了。',
        };
      }

      let answer = '更多结果：\n\n';
      nextResults.forEach((poi, index) => {
        answer += `${currentIndex + index + 1}. ${poi.name}（距离${poi.distance}米）\n`;
        if (poi.address) answer += `   地址：${poi.address}\n`;
        if (poi.tel) answer += `   电话：${poi.tel}\n`;
        answer += '\n';
      });
      answer += '还有更多需要帮助的吗？';

      // 获取搜索中心点和关键词
      const center = session.getLastSearchedLocation();
      const keywords = session.getLastPoiKeywords();

      return {
        thought: `ShowMoreSkill: 显示第${currentIndex + 1}到${currentIndex + nextResults.length}个结果`,
        answer: answer,
        data: {
          type: 'poi',
          center: center,
          keywords: keywords,
          results: nextResults.map((poi) => ({
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
      console.error('执行显示更多结果技能失败:', error);
      return {
        thought: '执行失败',
        answer: '抱歉，加载更多结果时出现了问题，请稍后重试。',
      };
    }
  }
}

module.exports = ShowMoreSkill;