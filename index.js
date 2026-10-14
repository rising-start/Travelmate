const TravelAssistant = require('./src/core/main');

// 创建TravelAssistant实例
const assistant = new TravelAssistant();

// 示例用法
async function example() {
  try {
    // 示例1: 路线规划
    console.log('示例1: 路线规划');
    const routeResult = await assistant.planRoute('北京', '上海');
    console.log('路线规划结果:', routeResult);

    // 示例2: 天气查询
    console.log('\n示例2: 天气查询');
    const weatherResult = await assistant.processUserInput('北京天气如何');
    console.log('天气查询结果:', weatherResult);

    // 示例3: 周边搜索
    console.log('\n示例3: 周边搜索');
    const nearbyResult = await assistant.searchNearby('北京天安门', '餐厅');
    console.log('周边搜索结果:', nearbyResult);
  } catch (error) {
    console.error('示例执行错误:', error);
  }
}

// 执行示例
example();

// 导出TravelAssistant
module.exports = TravelAssistant;