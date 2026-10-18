


class GeneralInfoSkill {
  constructor(mcp) {
    this.mcp = mcp;
  }

  

  async execute(params, session) {
    try {
      const { question, location } = params;

      if (!location) {
        return {
          thought: '缺少地点信息',
          answer: '请问您想了解哪个地点的信息？',
        };
      }

      const geo = await this.mcp.geocode(location);
      if (!geo) {
        return {
          thought: '地理编码失败',
          answer: `抱歉，无法找到"${location}"的位置信息。`,
        };
      }

      return {
        thought: '通用信息查询',
        answer: `关于${location}，${question || '我不太清楚具体信息'}。\n\n建议您：\n1. 查看官方网站获取最新信息\n2. 拨打当地旅游信息中心咨询\n3. 使用地图应用查看详情`,
      };
    } catch (error) {
      console.error('执行通用信息查询技能失败:', error);
      return {
        thought: '执行失败',
        answer: '抱歉，处理您的请求时出现了问题，请稍后重试。',
      };
    }
  }
}

module.exports = GeneralInfoSkill;