const TravelAssistant = require('./src/core/main');

const assistant = new TravelAssistant();

async function example() {
  try {
    console.log('示例1: 路线规划');
    const routeResult = await assistant.planRoute('北京', '上海');
    console.log('路线规划结果:', routeResult);

    console.log('\n示例2: 天气查询');
    const weatherResult = await assistant.processUserInput('北京天气如何');
    console.log('天气查询结果:', weatherResult);

    console.log('\n示例3: 周边搜索');
    const nearbyResult = await assistant.searchNearby('北京天安门', '餐厅');
    console.log('周边搜索结果:', nearbyResult);
  } catch (error) {
    console.error('示例执行错误:', error);
  }
}

example();

module.exports = TravelAssistant;