const { DIALOG_STATES, INTENT_TYPES } = require('./conversationSession');
const {
  getMultiTurnIntentPrompt,
  getScoreWeights,
  getRouteFilterThresholds,
} = require('../config/config');

// 格式化历史记录用于LLM
function formatHistoryForLLM(session) {
  const history = session.dialogHistory.slice(-3); // 只保留最近3轮
  let formatted = '';

  history.forEach((item, index) => {
    const assistantText = item.system || '';
    formatted += `\n${index + 1}. 用户: ${item.user}`;
    formatted += `\n   系统: ${assistantText.substring(0, 100)}...`;
  });

  return formatted;
}

// 获取关键地点摘要
function getLocationSummary(session) {
  let summary = '';

  // 【修改】优先级最高的放在最前面
  if (session.getLastSearchedLocation()) {
    summary += `\n- 【优先级最高】用户最近搜索的地点: ${session.getLastSearchedLocation()}`;
  }
  if (session.getLastOrigin()) {
    summary += `\n- 最后规划的起点: ${session.getLastOrigin()}`;
  }
  if (session.getLastDestination()) {
    summary += `\n- 最后规划的终点: ${session.getLastDestination()}`;
  }
  if (session.getLastMentionedLocation()) {
    summary += `\n- 最后提到的地点: ${session.getLastMentionedLocation()}`;
  }
  if (session.currentLocation) {
    summary += `\n- 当前位置: ${session.currentLocation}`;
  }

  return summary;
}

async function buildContextAwarePrompt(session, userInput) {
  const systemPrompt = `你是一个智能旅行助手的决策引擎，负责理解用户的意图并选择最合适的 Skill 执行。

角色定义：
- 你是决策引擎，不是对话生成器
- 你的任务是分析用户输入和对话历史，选择最佳 Skill
- 你需要处理指代词（如"那"、"这里"）的消解

## 可用的 Skills（你只能选择其中一个）

1. WeatherSkill
   - 能做什么：查询天气、生成出行建议、提醒注意事项
   - 何时使用：用户问"天气怎么样"、"有什么建议"、"需要注意什么"、"穿什么"
   - 参数：{"location": "地点", "time": "时间（可选）", "locations": "多地点数组（可选）", "multi_location": "是否多地点（可选）"}

天气查询规则（按优先级排序）：
1. 如果用户问"天气怎么样"且存在"用户最近搜索的地点" → 返回该地点的天气，这是最高优先级
2. 否则如果有起点和终点 → 返回两个地点的天气
3. 否则返回单个地点的天气
- 当用户问"出发地天气"或"起点天气"时 → 只返回起点天气
- 当用户问"目的地天气"或"终点天气"时 → 只返回终点天气
- 当用户问"XX天气"时 → 返回指定地点的天气

示例：
对话历史：用户说"从广州大学城到广州塔"
用户: 天气怎么样
输出: {
  "selected_skill": "WeatherSkill",
  "params": {
    "locations": ["广州大学城", "广州塔"],
    "multi_location": true
  },
  "confidence": 0.95
}

2. POISkill
   - 能做什么：搜索附近的地点（餐厅、酒店、景点、咖啡馆等）
   - 何时使用：用户问"附近有什么"、"推荐xxx"、"哪里有xxx"
   - 参数：{"center": "中心点", "keywords": "搜索类型", "radius": "半径（可选）"}

3. RouteSkill
   - 能做什么：规划从A到B的路线
   - 何时使用：用户问"怎么去"、"路线"、"从A到B"
   - 参数：{"origin": "起点", "destination": "终点"}

4. GeneralInfoSkill
   - 能做什么：回答旅行相关的通用知识（门票、开放时间、值得去吗）
   - 何时使用：用户问"值不值得去"、"门票多少钱"、"几点开门"
   - 参数：{"question": "用户的问题", "location": "相关地点"}

5. AskUserSkill
   - 能做什么：向用户询问缺失的信息
   - 何时使用：用户意图明确但缺少关键信息（如只说"去北京"没说起点）
   - 参数：{"question": "要问的问题", "missing_field": "缺失的字段名"}

6. ShowMoreSkill
   - 能做什么：显示更多搜索结果
   - 何时使用：用户说"还有别的吗"、"下一个"、"更多"、"再推荐几个"、"还有呢"
   - 参数：{}（无需参数）

输出格式（严格遵守）：
{
  "selected_skill": "Skill名称",
  "params": { /* 该Skill需要的参数 */ },
  "confidence": 0-1
}

指代消解规则：
- 当用户说"那"、"那里"、"那儿"时，优先使用lastSearchedLocation
- 当用户说"这"、"这里"、"这儿"时，优先使用lastOrigin或currentLocation
- 当用户说"附近"、"周边"时，优先使用lastSearchedLocation
- 当用户说"再去"、"然后去"时，起点是lastDestination

关键地点信息：${getLocationSummary(session)}

最近的对话历史：${formatHistoryForLLM(session)}

用户当前输入：${userInput}

Few-shot示例：

示例1：
用户: 广州塔附近有什么好玩的
输出: {
  "selected_skill": "POISkill",
  "params": {
    "center": "广州塔",
    "keywords": "好玩的"
  },
  "confidence": 0.95
}

示例2：
用户: 那附近有酒店吗
输出: {
  "selected_skill": "POISkill",
  "params": {
    "center": "广州塔",
    "keywords": "酒店"
  },
  "confidence": 0.9
}

示例3：
用户: 从广州大学城去广州塔怎么走
输出: {
  "selected_skill": "RouteSkill",
  "params": {
    "origin": "广州大学城",
    "destination": "广州塔"
  },
  "confidence": 0.9
}

示例4：
用户: 广州天气怎么样
输出: {
  "selected_skill": "WeatherSkill",
  "params": {
    "location": "广州"
  },
  "confidence": 0.95
}

示例5：
用户: 去北京需要准备什么
输出: {
  "selected_skill": "WeatherSkill",
  "params": {
    "location": "北京"
  },
  "confidence": 0.85
}

示例6：
用户: 广州塔门票多少钱
输出: {
  "selected_skill": "GeneralInfoSkill",
  "params": {
    "question": "门票多少钱",
    "location": "广州塔"
  },
  "confidence": 0.9
}

示例7：
用户: 我要去北京
输出: {
  "selected_skill": "AskUserSkill",
  "params": {
    "question": "请问您从哪里出发？",
    "missing_field": "origin"
  },
  "confidence": 0.8
}

请只输出JSON，不要有其他文字。`;

  return systemPrompt;
}

function parseIntentResponse(responseText) {
  try {
    let jsonStr = responseText;
    if (responseText.includes('```json')) {
      jsonStr = responseText.split('```json')[1].split('```')[0];
    } else if (responseText.includes('```')) {
      jsonStr = responseText.split('```')[1].split('```')[0];
    }
    const parsed = JSON.parse(jsonStr.trim());

    const intent = parsed.intent || parsed.intent_type || INTENT_TYPES.UNKNOWN;
    const hasRouteIntent = parsed.has_route_intent || false;
    const origin = parsed.origin || null;
    const destination = parsed.destination || null;
    const missingInfo = parsed.missing_info || [];
    const clarification = parsed.clarification || null;
    const adjustment = parsed.adjustment || null;

    return {
      intent,
      hasRouteIntent,
      origin,
      destination,
      missingInfo,
      clarification,
      adjustment,
    };
  } catch (error) {
    return {
      intent: INTENT_TYPES.UNKNOWN,
      hasRouteIntent: false,
      origin: null,
      destination: null,
      missingInfo: [],
      clarification: null,
      adjustment: null,
    };
  }
}

function determineNextState(session, intentResult) {
  const { intent, missingInfo, poi_search } = intentResult;

  // 检查是否是POI搜索请求
  if (poi_search && poi_search.enabled) {
    // 如果有搜索中心点，直接进行POI搜索
    if (intentResult.origin || session.collectedInfo.origin) {
      return DIALOG_STATES.RECOMMENDING; // 使用RECOMMENDING状态来处理POI搜索结果
    } else {
      // 缺少搜索中心点，需要收集
      return DIALOG_STATES.COLLECTING_ORIGIN;
    }
  }

  if (intent === INTENT_TYPES.CANCEL) {
    return DIALOG_STATES.INIT;
  }

  if (intent === INTENT_TYPES.CONTINUE_JOURNEY) {
    // 续程意图：如果信息完整直接推荐
    if (missingInfo.length === 0) {
      return DIALOG_STATES.RECOMMENDING;
    } else if (missingInfo.includes('origin')) {
      return DIALOG_STATES.COLLECTING_ORIGIN;
    } else if (missingInfo.includes('destination')) {
      return DIALOG_STATES.COLLECTING_DESTINATION;
    }
  }

  if (intent === INTENT_TYPES.NEW_JOURNEY) {
    // 全新行程：类似 PROVIDE_INFO
    if (missingInfo.length === 0) {
      return DIALOG_STATES.CONFIRMING;
    }
    if (missingInfo.includes('origin')) {
      return DIALOG_STATES.COLLECTING_ORIGIN;
    }
    if (missingInfo.includes('destination')) {
      return DIALOG_STATES.COLLECTING_DESTINATION;
    }
    return DIALOG_STATES.COLLECTING_ORIGIN;
  }

  if (session.state === DIALOG_STATES.INIT) {
    if (intent === INTENT_TYPES.PROVIDE_INFO && missingInfo.length === 0) {
      return DIALOG_STATES.CONFIRMING;
    }
    if (missingInfo.includes('origin')) {
      return DIALOG_STATES.COLLECTING_ORIGIN;
    }
    if (missingInfo.includes('destination')) {
      return DIALOG_STATES.COLLECTING_DESTINATION;
    }
    return DIALOG_STATES.COLLECTING_ORIGIN;
  }

  if (session.state === DIALOG_STATES.COLLECTING_ORIGIN) {
    if (session.collectedInfo.origin) {
      return DIALOG_STATES.COLLECTING_DESTINATION;
    }
  }

  if (session.state === DIALOG_STATES.COLLECTING_DESTINATION) {
    if (session.collectedInfo.destination) {
      return DIALOG_STATES.CONFIRMING;
    }
  }

  if (session.state === DIALOG_STATES.CONFIRMING) {
    if (intent === INTENT_TYPES.CONFIRM) {
      return DIALOG_STATES.RECOMMENDING;
    }
    if (intent === INTENT_TYPES.NEGATE) {
      return DIALOG_STATES.ADJUSTING;
    }
  }

  if (session.state === DIALOG_STATES.RECOMMENDING) {
    if (intent === INTENT_TYPES.NEGATE) {
      return DIALOG_STATES.ADJUSTING;
    }
    if (intent === INTENT_TYPES.CONFIRM) {
      return DIALOG_STATES.INIT;
    }
    if (intent === INTENT_TYPES.PROVIDE_INFO) {
      // 用户提供新的路线信息，重新开始
      return DIALOG_STATES.INIT;
    }
  }

  if (session.state === DIALOG_STATES.ADJUSTING) {
    if (missingInfo.length === 0) {
      return DIALOG_STATES.RECOMMENDING;
    }
  }

  return session.state;
}

function generateFollowUpQuestion(session) {
  const { state, collectedInfo } = session;

  if (state === DIALOG_STATES.COLLECTING_ORIGIN) {
    return '请问您从哪里出发？';
  }

  if (state === DIALOG_STATES.COLLECTING_DESTINATION) {
    if (collectedInfo.origin) {
      return `您想从${collectedInfo.origin}去哪里？`;
    }
    return '您想去哪里？';
  }

  if (state === DIALOG_STATES.COLLECTING_BUDGET) {
    return '您的预算大概是多少？';
  }

  if (state === DIALOG_STATES.COLLECTING_TIME) {
    return '您希望什么时候出发？';
  }

  if (state === DIALOG_STATES.CONFIRMING) {
    return `好的，从${collectedInfo.origin}到${collectedInfo.destination}，确认无误吗？`;
  }

  if (state === DIALOG_STATES.ADJUSTING) {
    return '您想要调整什么？比如：便宜点的、快一点的、或者换个目的地？';
  }

  return null;
}

function extractInfoFromText(text, session) {
  const result = {
    origin: null,
    destination: null,
    budget: null,
    preferredTime: null,
    preferredTransport: null,
    passengers: null,
  };

  const originMatch = text.match(/从\s*(.+?)\s*(?:出发|到|去|$)/);
  if (originMatch && originMatch[1]) {
    result.origin = originMatch[1].trim();
  }

  const destMatch = text.match(/(?:到|去)\s*(.+?)(?:怎么走|多少|多远|多久|$)/);
  if (destMatch && destMatch[1]) {
    result.destination = destMatch[1].trim();
  }

  const budgetMatch = text.match(/(?:预算|花|多少钱|¥|价格)\s*(\d+)/);
  if (budgetMatch && budgetMatch[1]) {
    result.budget = parseInt(budgetMatch[1]);
  }

  if (text.includes('便宜')) {
    result.preferredTransport = '公共交通';
  } else if (text.includes('快') || text.includes('最快')) {
    result.preferredTransport = '驾车';
  } else if (text.includes('地铁')) {
    result.preferredTransport = '地铁';
  }

  return result;
}

module.exports = {
  buildContextAwarePrompt,
  parseIntentResponse,
  determineNextState,
  generateFollowUpQuestion,
  extractInfoFromText,
};
