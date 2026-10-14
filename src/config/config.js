const https = require('https');
const env = require('./env');

const DEBUG = env.DEBUG;

const DEFAULT_API_KEY = env.MAP_API_KEY;
const WEATHER_API_KEY = env.WEATHER_API_KEY;
const LLM_API_KEY = env.LLM_API_KEY;
const SILICON_FLOW_API_KEY = env.SILICON_FLOW_API_KEY;

const API_BASE_URL = 'https://restapi.amap.com/v3';
const WEATHER_BASE_URL = 'https://kw36x96wg9.re.qweatherapi.com';
const LLM_BASE_URL = 'https://api.siliconflow.cn/v1';

const CITY_CENTERS = {
  北京: { longitude: 116.4074, latitude: 39.9042, adcode: '110000' },
  上海: { longitude: 121.4737, latitude: 31.2304, adcode: '310000' },
  广州: { longitude: 113.2644, latitude: 23.1291, adcode: '440100' },
  深圳: { longitude: 114.0579, latitude: 22.5431, adcode: '440300' },
  杭州: { longitude: 120.1551, latitude: 30.2741, adcode: '330100' },
  南京: { longitude: 118.7969, latitude: 32.0603, adcode: '320100' },
  武汉: { longitude: 114.3055, latitude: 30.5928, adcode: '420100' },
  成都: { longitude: 104.0668, latitude: 30.5728, adcode: '510100' },
  重庆: { longitude: 106.5516, latitude: 29.563, adcode: '500000' },
  西安: { longitude: 108.9402, latitude: 34.3416, adcode: '610100' },
};

const CITY_DISTANCES = {
  '广州-上海': 1400,
  '广州-北京': 1900,
  '广州-深圳': 130,
  '广州-珠海': 120,
  '广州-佛山': 30,
  '上海-北京': 1300,
  '上海-深圳': 1400,
  '上海-杭州': 170,
  '北京-深圳': 2100,
  '北京-杭州': 1200,
};

const TRANSPORT_HUBS = {
  北京: {
    railway: '北京南站',
    airport: (address) => (address?.includes('大兴') ? '大兴机场' : '首都机场'),
  },
  上海: {
    railway: '上海虹桥站',
    airport: (address) => (address?.includes('浦东') ? '浦东机场' : '虹桥机场'),
  },
  广州: {
    railway: '广州南站',
    airport: (address) => (address?.includes('白云') ? '白云机场' : '白云机场'),
  },
  深圳: {
    railway: '深圳北站',
    airport: (address) => (address?.includes('宝安') ? '宝安机场' : '宝安机场'),
  },
  杭州: {
    railway: '杭州东站',
    airport: (address) => (address?.includes('萧山') ? '萧山机场' : '萧山机场'),
  },
  成都: {
    railway: '成都东站',
    airport: (address) => (address?.includes('双流') ? '双流机场' : '双流机场'),
  },
  武汉: {
    railway: '武汉站',
    airport: (address) => (address?.includes('天河') ? '天河机场' : '天河机场'),
  },
  西安: {
    railway: '西安北站',
    airport: (address) => (address?.includes('咸阳') ? '咸阳机场' : '咸阳机场'),
  },
  重庆: {
    railway: '重庆北站',
    airport: (address) => (address?.includes('江北') ? '江北机场' : '江北机场'),
  },
  南京: {
    railway: '南京南站',
    airport: (address) => (address?.includes('禄口') ? '禄口机场' : '禄口机场'),
  },
};

const COMMON_CITIES = [
  '北京',
  '上海',
  '广州',
  '深圳',
  '杭州',
  '南京',
  '武汉',
  '成都',
  '重庆',
  '西安',
  '天津',
  '苏州',
  '郑州',
  '长沙',
  '沈阳',
  '青岛',
  '宁波',
  '东莞',
  '佛山',
];

const EXCLUDED_STREET_NAMES = [
  '北京路',
  '南京路',
  '上海路',
  '广州路',
  '深圳路',
  '杭州路',
  '南京街',
  '武汉路',
  '成都路',
  '重庆路',
  '西安路',
  '天津路',
  '苏州路',
  '郑州路',
  '长沙路',
  '沈阳路',
  '青岛路',
  '宁波路',
  '东莞路',
  '佛山路',
];

const DISTRICT_TO_CITY = {
  440103: '440100',
  440104: '440100',
  440105: '440100',
  440106: '440100',
  440111: '440100',
  440112: '440100',
  440113: '440100',
  440114: '440100',
  440115: '440100',
  440117: '440100',
  440118: '440100',
  440303: '440300',
  440304: '440300',
  440305: '440300',
  440306: '440300',
  440307: '440300',
  440308: '440300',
  440309: '440300',
  440310: '440300',
  440311: '440300',
};

const PROVINCES = [
  '广东',
  '北京',
  '上海',
  '江苏',
  '浙江',
  '山东',
  '河南',
  '四川',
  '湖北',
  '湖南',
  '河北',
  '福建',
  '安徽',
  '辽宁',
  '黑龙江',
  '陕西',
  '山西',
  '江西',
  '广西',
  '云南',
  '贵州',
  '内蒙古',
  '吉林',
  '甘肃',
  '新疆',
  '宁夏',
  '青海',
  '西藏',
  '海南',
  '香港',
  '澳门',
  '台湾',
];

const SCORE_WEIGHTS = {
  TIME: 0.4,
  COST: 0.3,
  DISTANCE: 0.3,
};

const DISTANCE_THRESHOLDS = {
  WALKING_MAX: 10,
  BICYCLING_MAX: 50,
  HIGH_SPEED_TRAIN_MIN: 500,
};

const ROUTE_FILTER_THRESHOLDS = {
  WALKING_MAX_KM: 5,
  WALKING_WARN_KM: 3,
  BICYCLING_MAX_KM: 8,
  TRANSIT_MAX_KM: 50,
};

const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-ai/DeepSeek-V3.2';

const SYSTEM_PROMPT_TEMPLATE = `你是一个智能旅行助手的意图理解系统。你的任务是理解用户的自然语言，并输出标准化的JSON结果。

## 核心原则
用户可能用任何方式表达需求，你需要理解真实意图，而不是匹配关键词。

## 输出格式
{
  "intent": "字符串",
  "has_route_intent": true/false,
  "origin": "地点名或null",
  "destination": "地点名或null",
  "time": "时间或null",
  "poi_search": {
    "enabled": true/false,
    "keywords": "搜索词或null",
    "preference": "偏好或null",
    "radius": 数字或null
  },
  "missing_info": ["缺失字段数组"],
  "confidence": 0-1之间的数字
}

## 意图类型（从以下选择）
- PLAN_TRIP：用户想规划行程、找地方玩、寻推荐
- GET_ROUTE：用户想知道怎么从A到B
- CONFIRM：用户表示确认、同意、好的
- REJECT：用户表示否定、太贵、换一个、不要
- ASK_INFO：用户询问具体信息（多久、多远、多少钱）
- CANCEL：用户想取消、重新开始
- GREETING：问候、打招呼
- OTHER：无法理解

## 判断逻辑（按顺序思考）

### 第一步：判断是否需要路线
用户是否想知道"怎么从某地到某地"？
- 关键词线索：怎么去、路线、交通、从...到...、去...怎么走、开车、坐车、地铁、公交
- 是 → has_route_intent = true，提取origin和destination
- 否 → has_route_intent = false

### 第二步：判断是否需要地点推荐
用户是否想找"某个地方附近有什么"？
- 关键词线索：附近、周边、有什么、推荐、好玩、好吃、逛逛、玩、吃、住、景点、餐厅、酒店
- 是 → poi_search.enabled = true
  - 提取中心点（"XX附近"中的XX）
  - 判断搜索类型：
    - 提到玩、景点、逛逛、好玩 → keywords = "景点"
    - 提到吃、美食、餐厅、好吃 → keywords = "餐厅"
    - 提到住、酒店、住宿 → keywords = "酒店"
    - 不明确 → keywords = "地点"
  - 半径判断：景点用2000米，餐厅/酒店用500米，不明确用1000米

### 第三步：确定主意图
根据上述判断选择intent：
- 需要路线 + 需要推荐 = PLAN_TRIP（两者都有）
- 只需要路线 = GET_ROUTE
- 只需要推荐 = PLAN_TRIP
- 用户确认 = CONFIRM
- 用户否定/要求改变 = REJECT
- 询问信息 = ASK_INFO
- 取消/重置 = CANCEL
- 问候 = GREETING
- 都不符合 = OTHER

### 第四步：提取地点信息
- 从用户输入中识别具体地名
- 支持简称、别名、口语化表达
- 只提取到明确的地点才填入，模糊的留null并标记missing_info

### 第五步：标记缺失信息
如果has_route_intent为true但缺少origin或destination，在missing_info中标记

## 置信度规则
- 非常确定用户意图 → confidence >= 0.9
- 比较确定但有歧义 → confidence 0.7-0.9
- 不确定，需要澄清 → confidence 0.5-0.7，并在missing_info中标记
- 完全无法理解 → confidence < 0.5，intent = OTHER

## 重要提醒
1. 不要强行套用格式，理解不了就输出OTHER
2. 地点名称保持原样，不要翻译或修改
3. 用户可能一句话包含多个需求，优先处理最明显的
4. 如果用户输入太模糊，输出OTHER让系统询问
5. 泛化理解：用户说"想出去转转" → 地点推荐；"怎么去方便" → 路线规划；"值不值得去" → ASK_INFO

现在，分析用户输入，输出JSON。`;

const WEATHER_ADVICE_PROMPT = `你是一个旅行助手，根据天气信息和路线信息生成出行建议。

请根据以下信息生成出行建议：
1. 根据温度给出穿衣建议
2. 根据天气现象给出装备建议（如是否需要带伞、墨镜等）
3. 根据空气质量给出健康建议（如是否需要戴口罩）
4. 根据湿度给出舒适度建议
5. 根据路线特点给出出行注意事项

请用简洁的语言给出3-4条建议。`;

const MULTI_TURN_INTENT_PROMPT = `你是一个智能旅行助手的意图理解系统，支持多轮对话。你的任务是理解用户的自然语言，并输出标准化的JSON结果。

## 核心原则
用户可能用任何方式表达需求，你需要理解真实意图，而不是匹配关键词。

## 输出格式
{
  "intent": "字符串",
  "has_route_intent": true/false,
  "origin": "地点名或null",
  "destination": "地点名或null",
  "time": "时间或null",
  "poi_search": {
    "enabled": true/false,
    "keywords": "搜索词或null",
    "preference": "偏好或null",
    "radius": 数字或null
  },
  "missing_info": ["缺失字段数组"],
  "clarification": "需要澄清的问题或null",
  "adjustment": "用户要求的调整或null",
  "confidence": 0-1之间的数字
}

## 意图类型（从以下选择）
- PLAN_TRIP：用户想规划行程、找地方玩、寻推荐
- GET_ROUTE：用户想知道怎么从A到B
- CONFIRM：用户表示确认、同意、好的
- REJECT：用户表示否定、太贵、换一个、不要
- ASK_INFO：用户询问具体信息（多久、多远、多少钱）
- CANCEL：用户想取消、重新开始
- GREETING：问候、打招呼
- OTHER：无法理解

## 判断逻辑（按顺序思考）

### 第一步：判断是否需要路线
用户是否想知道"怎么从某地到某地"？
- 关键词线索：怎么去、路线、交通、从...到...、去...怎么走、开车、坐车、地铁、公交
- 是 → has_route_intent = true，提取origin和destination
- 否 → has_route_intent = false

### 第二步：判断是否需要地点推荐
用户是否想找"某个地方附近有什么"？
- 关键词线索：附近、周边、有什么、推荐、好玩、好吃、逛逛、玩、吃、住、景点、餐厅、酒店
- 是 → poi_search.enabled = true
  - 提取中心点（"XX附近"中的XX）
  - 判断搜索类型：
    - 提到玩、景点、逛逛、好玩 → keywords = "景点"
    - 提到吃、美食、餐厅、好吃 → keywords = "餐厅"
    - 提到住、酒店、住宿 → keywords = "酒店"
    - 不明确 → keywords = "地点"
  - 半径判断：景点用2000米，餐厅/酒店用500米，不明确用1000米

### 第三步：确定主意图
根据上述判断选择intent：
- 需要路线 + 需要推荐 = PLAN_TRIP（两者都有）
- 只需要路线 = GET_ROUTE
- 只需要推荐 = PLAN_TRIP
- 用户确认 = CONFIRM
- 用户否定/要求改变 = REJECT
- 询问信息 = ASK_INFO
- 取消/重置 = CANCEL
- 问候 = GREETING
- 都不符合 = OTHER

### 第四步：提取地点信息
- 从用户输入中识别具体地名
- 支持简称、别名、口语化表达
- 只提取到明确的地点才填入，模糊的留null并标记missing_info

### 第五步：标记缺失信息
如果has_route_intent为true但缺少origin或destination，在missing_info中标记

## 上下文使用规则
如果提供了对话历史，请参考：
- 用户之前提到的地点可以作为当前指代的参照
- 用户之前确认的信息不需要重复询问
- 但要以当前输入为最优先

## 置信度规则
- 非常确定用户意图 → confidence >= 0.9
- 比较确定但有歧义 → confidence 0.7-0.9
- 不确定，需要澄清 → confidence 0.5-0.7，并在missing_info中标记
- 完全无法理解 → confidence < 0.5，intent = OTHER

## 重要提醒
1. 不要强行套用格式，理解不了就输出OTHER
2. 地点名称保持原样，不要翻译或修改
3. 用户可能一句话包含多个需求，优先处理最明显的
4. 如果用户输入太模糊，输出OTHER让系统询问
5. 泛化理解：用户说"想出去转转" → 地点推荐；"怎么去方便" → 路线规划；"值不值得去" → ASK_INFO

现在，分析用户输入，输出JSON。`;

const ADCODE_TO_CITY_MAP = {
  440100: '广州',
  440300: '深圳',
  440400: '珠海',
  440600: '佛山',
  441900: '东莞',
  442000: '中山',
  440500: '汕头',
  440700: '江门',
  440800: '湛江',
  441200: '肇庆',
  441300: '惠州',
  441400: '梅州',
  441500: '汕尾',
  441600: '河源',
  441700: '阳江',
  441800: '清远',
  445100: '潮州',
  445200: '揭阳',
  445300: '云浮',
};

const IP_LOCATION_FALLBACK = {
  DEFAULT_CITY: '广州',
  DEFAULT_PROVINCE: '广东',
  DEFAULT_COUNTRY: '中国',
};

const IP_LOCATION_MOCK = {
  '127.0.0.1': { city: '广州', province: '广东', country: '中国' },
  '192.168.1.1': { city: '北京', province: '北京', country: '中国' },
  '10.0.0.1': { city: '上海', province: '上海', country: '中国' },
};

const RANDOM_CITIES = [
  '广州',
  '北京',
  '上海',
  '深圳',
  '杭州',
  '成都',
  '武汉',
  '西安',
];

function getMapApiKey() {
  return process.env.MAP_API_KEY || DEFAULT_API_KEY;
}

function getWeatherApiKey() {
  return process.env.WEATHER_API_KEY || WEATHER_API_KEY;
}

function getLlmApiKey() {
  return process.env.LLM_API_KEY || LLM_API_KEY;
}

function getLlmModel() {
  return LLM_MODEL;
}

function getScoreWeights() {
  return { ...SCORE_WEIGHTS };
}

function getDistanceThresholds() {
  return { ...DISTANCE_THRESHOLDS };
}

function getRouteFilterThresholds() {
  return { ...ROUTE_FILTER_THRESHOLDS };
}

function getSystemPrompt() {
  return SYSTEM_PROMPT_TEMPLATE;
}

function getWeatherAdvicePrompt() {
  return WEATHER_ADVICE_PROMPT;
}

function getIpLocationMock() {
  return { ...IP_LOCATION_MOCK };
}

function getRandomCity() {
  return RANDOM_CITIES[Math.floor(Math.random() * RANDOM_CITIES.length)];
}

function getDefaultIpLocation(ip) {
  const mock = IP_LOCATION_MOCK[ip];
  if (mock) {
    return mock;
  }
  return {
    city: getRandomCity(),
    province: IP_LOCATION_FALLBACK.DEFAULT_PROVINCE,
    country: IP_LOCATION_FALLBACK.DEFAULT_COUNTRY,
  };
}

const POI_CONFIG = {
  DEFAULT_RADIUS: 500,
  MAX_RESULTS: 5,
  CACHE_TTL: 3600000,
  CACHE_MAX_SIZE: 100,

  RADIUS_BY_TYPE: {
    景点: 2000,
    酒店: 1500,
    餐厅: 500,
    咖啡馆: 500,
    停车场: 800,
    便利店: 300,
    银行: 300,
  },

  EXPAND_RADIUS_ON_EMPTY: 1500,
};

function getPoiRadius(keywords) {
  const lowerKeywords = keywords.toLowerCase();
  for (const [type, radius] of Object.entries(POI_CONFIG.RADIUS_BY_TYPE)) {
    if (lowerKeywords.includes(type.toLowerCase())) {
      return radius;
    }
  }
  return POI_CONFIG.DEFAULT_RADIUS;
}

function getPoiMaxResults() {
  return POI_CONFIG.MAX_RESULTS;
}

function getPoiCacheTTL() {
  return POI_CONFIG.CACHE_TTL;
}

function getSiliconFlowApiKey() {
  return process.env.SILICON_FLOW_API_KEY || SILICON_FLOW_API_KEY;
}

module.exports = {
  DEBUG,
  DEFAULT_API_KEY,
  WEATHER_API_KEY,
  LLM_API_KEY,
  SILICON_FLOW_API_KEY,
  API_BASE_URL,
  WEATHER_BASE_URL,
  LLM_BASE_URL,
  CITY_CENTERS,
  CITY_DISTANCES,
  TRANSPORT_HUBS,
  COMMON_CITIES,
  EXCLUDED_STREET_NAMES,
  DISTRICT_TO_CITY,
  PROVINCES,
  SCORE_WEIGHTS,
  DISTANCE_THRESHOLDS,
  ROUTE_FILTER_THRESHOLDS,
  LLM_MODEL,
  SYSTEM_PROMPT_TEMPLATE,
  WEATHER_ADVICE_PROMPT,
  MULTI_TURN_INTENT_PROMPT,
  ADCODE_TO_CITY_MAP,
  IP_LOCATION_FALLBACK,
  IP_LOCATION_MOCK,
  RANDOM_CITIES,
  POI_CONFIG,
  getMapApiKey,
  getWeatherApiKey,
  getLlmApiKey,
  getLlmModel,
  getScoreWeights,
  getDistanceThresholds,
  getRouteFilterThresholds,
  getSystemPrompt,
  getWeatherAdvicePrompt,
  getMultiTurnIntentPrompt: () => MULTI_TURN_INTENT_PROMPT,
  getIpLocationMock,
  getRandomCity,
  getDefaultIpLocation,
  getPoiRadius,
  getPoiMaxResults,
  getPoiCacheTTL,
  getSiliconFlowApiKey,
};
