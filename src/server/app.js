const TravelAssistant = require('../core/main');
const MultiTurnTravelAssistant = require('../core/multiTurnTravelAssistant');
const readline = require('readline');
const debug = require('../utils/debug');

// 创建命令行接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '请输入您的问题: ',
});

// 创建多轮对话助手实例
const multiTurnAssistant = new MultiTurnTravelAssistant();

// 生成会话ID
let sessionId = 'cli-session-' + Date.now();

console.log('欢迎使用旅行助手！您可以询问路线规划、天气查询、周边搜索等问题。');
console.log('输入 "退出" 或 "quit" 结束对话。');
console.log('输入 "重置" 或 "reset" 重置会话。');
rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();

  if (input === '退出' || input === 'quit') {
    console.log('再见！');
    rl.close();
    return;
  }

  if (input === '重置' || input === 'reset') {
    sessionId = 'cli-session-' + Date.now();
    console.log('会话已重置，开始新的对话。');
    rl.prompt();
    return;
  }

  try {
    // 使用多轮对话助手处理输入
    const result = await multiTurnAssistant.processUserInput(input, sessionId);

    if (result.answer) {
      console.log('\n助手:', result.answer);
    }

    if (result.data) {
      // 处理结构化数据
      if (result.data.type === 'route') {
        console.log('\n路线规划结果:');
        console.log(`从 ${result.data.origin} 到 ${result.data.destination}`);
        if (result.data.schemes && result.data.schemes.length > 0) {
          result.data.schemes.forEach((scheme, index) => {
            console.log(`\n方案 ${index + 1}: ${scheme.mode}`);
            console.log(`距离: ${scheme.distance}`);
            console.log(`预计时间: ${scheme.duration}`);
            if (scheme.steps) {
              console.log('步骤:');
              scheme.steps.forEach((step) => {
                console.log(`- ${step.instruction}`);
              });
            }
          });
        }
      } else if (result.data.type === 'poi') {
        console.log('\n周边搜索结果:');
        if (result.data.results && result.data.results.length > 0) {
          result.data.results.forEach((poi, index) => {
            console.log(`\n${index + 1}. ${poi.name}`);
            console.log(`距离: ${poi.distance}米`);
            if (poi.address) {
              console.log(`地址: ${poi.address}`);
            }
            if (poi.tel) {
              console.log(`电话: ${poi.tel}`);
            }
          });
        }
      } else if (result.data.type === 'weather') {
        console.log('\n天气信息:');
        console.log(`城市: ${result.data.city}`);
        console.log(`温度: ${result.data.temperature}℃`);
        console.log(`天气: ${result.data.weather}`);
        console.log(`湿度: ${result.data.humidity}`);
        console.log(`风力: ${result.data.wind}`);
      }
    }
  } catch (error) {
    debug.error('处理输入错误:', error);
    console.log('抱歉，处理您的请求时出现错误，请稍后重试。');
  } finally {
    rl.prompt();
  }
});

rl.on('close', () => {
  console.log('对话已结束。');
  process.exit(0);
});
