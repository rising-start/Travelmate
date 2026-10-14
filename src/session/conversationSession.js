const { createClient } = require('redis');

const DIALOG_STATES = {
  INIT: 'INIT',
  COLLECTING_ORIGIN: 'COLLECTING_ORIGIN',
  COLLECTING_DESTINATION: 'COLLECTING_DESTINATION',
  COLLECTING_BUDGET: 'COLLECTING_BUDGET',
  COLLECTING_TIME: 'COLLECTING_TIME',
  CONFIRMING: 'CONFIRMING',
  RECOMMENDING: 'RECOMMENDING',
  ADJUSTING: 'ADJUSTING',
};

const INTENT_TYPES = {
  PROVIDE_INFO: 'PROVIDE_INFO',
  REQUEST_RECOMMEND: 'REQUEST_RECOMMEND',
  CONFIRM: 'CONFIRM',
  NEGATE: 'NEGATE',
  QUERY: 'QUERY',
  CLARIFY: 'CLARIFY',
  CANCEL: 'CANCEL',
  GREETING: 'GREETING',
  CONTINUE_JOURNEY: 'CONTINUE_JOURNEY', // 继续行程
  NEW_JOURNEY: 'NEW_JOURNEY', // 全新行程
  UNKNOWN: 'UNKNOWN',
};

class ConversationSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.state = DIALOG_STATES.INIT;
    this.collectedInfo = {
      origin: null,
      destination: null,
      budget: null,
      preferredTime: null,
      preferredTransport: null,
      passengers: null,
    };
    this.dialogHistory = [];
    this.lastRecommendation = null;
    this.lastTimestamp = Date.now();
    this.lastOrigin = null; // 最后规划的起点
    this.lastDestination = null; // 最后规划的终点
    this.lastSearchedLocation = null; // 最后搜索的中心点
    this.lastMentionedLocation = null; // 最后提到的地点
    this.currentLocation = null; // 当前位置
    this.currentLat = null; // 当前位置纬度
    this.currentLng = null; // 当前位置经度
    this.locationHistory = []; // 地点历史数组
    this.tripHistory = []; // 行程历史
    this.context = {
      lastMentionedCity: null,
      currentCity: null,
    };
    this.lastPoiResults = null; // 上次POI搜索结果
    this.lastPoiIndex = 0; // 当前推荐的是第几个
    this.poiSearch = null; // POI搜索配置
    this.pendingRouteInfo = null; // 未完成的路线信息
  }

  updateTimestamp() {
    this.lastTimestamp = Date.now();
  }

  getTimeSinceLastInteraction() {
    return Date.now() - this.lastTimestamp;
  }

  setOrigin(origin) {
    this.collectedInfo.origin = origin;
    this.context.currentCity = origin;
    this.context.lastMentionedCity = origin;
    this.updateTimestamp();
  }

  setDestination(destination) {
    this.collectedInfo.destination = destination;
    this.context.lastMentionedCity = destination;
    this.updateTimestamp();
  }

  setBudget(budget) {
    this.collectedInfo.budget = budget;
    this.updateTimestamp();
  }

  setPreferredTime(time) {
    this.collectedInfo.preferredTime = time;
    this.updateTimestamp();
  }

  setPreferredTransport(transport) {
    this.collectedInfo.preferredTransport = transport;
    this.updateTimestamp();
  }

  setPassengers(passengers) {
    this.collectedInfo.passengers = passengers;
    this.updateTimestamp();
  }

  setState(newState) {
    this.state = newState;
    this.updateTimestamp();
  }

  async addToHistory(userInput, systemResponse) {
    this.dialogHistory.push({
      user: userInput,
      system: systemResponse,
      timestamp: Date.now(),
    });
    if (this.dialogHistory.length > 10) {
      this.dialogHistory = this.dialogHistory.slice(-10);
    }
    this.updateTimestamp();
  }

  setLastRecommendation(recommendation) {
    this.lastRecommendation = recommendation;
    this.updateTimestamp();
  }

  isInfoComplete() {
    return this.collectedInfo.origin && this.collectedInfo.destination;
  }

  getMissingInfo() {
    const missing = [];
    if (!this.collectedInfo.origin) {
      missing.push('origin');
    }
    if (!this.collectedInfo.destination) {
      missing.push('destination');
    }
    return missing;
  }

  getNextQuestion() {
    const missing = this.getMissingInfo();
    if (missing.includes('origin')) {
      return '请问您从哪里出发？';
    }
    if (missing.includes('destination')) {
      return '您想去哪里？';
    }
    return null;
  }

  async reset() {
    this.state = DIALOG_STATES.INIT;
    this.collectedInfo = {
      origin: null,
      destination: null,
      budget: null,
      preferredTime: null,
      preferredTransport: null,
      passengers: null,
    };
    this.dialogHistory = [];
    this.lastRecommendation = null;
    this.lastDestination = null;
    this.lastMentionedLocation = null;
    this.tripHistory = [];
    this.currentLocation = null;
    this.currentLat = null;
    this.currentLng = null;
    this.context = {
      lastMentionedCity: null,
      currentCity: null,
    };
    this.lastPoiResults = null;
    this.lastPoiIndex = 0;
    this.poiSearch = null;
    this.pendingRouteInfo = null;
    this.updateTimestamp();
  }

  async getRelevantContext(query, limit = 3) {
    // 无状态设计，返回空数组
    return [];
  }

  // 新增方法：保存POI结果
  setLastPoiResults(results) {
    this.lastPoiResults = results;
    this.lastPoiIndex = 0;
    this.updateTimestamp();
  }

  // 新增方法：获取POI结果
  getLastPoiResults() {
    return this.lastPoiResults;
  }

  // 新增方法：获取当前索引
  getLastPoiIndex() {
    return this.lastPoiIndex || 0;
  }

  // 新增方法：设置索引
  setLastPoiIndex(index) {
    this.lastPoiIndex = index;
    this.updateTimestamp();
  }

  // 新增方法：保存POI搜索关键词
  setLastPoiKeywords(keywords) {
    this.lastPoiKeywords = keywords;
    this.updateTimestamp();
  }

  // 新增方法：获取POI搜索关键词
  getLastPoiKeywords() {
    return this.lastPoiKeywords;
  }

  // 新增方法：获取下一个POI
  getNextPoi() {
    if (!this.lastPoiResults || this.lastPoiResults.length === 0) {
      return null;
    }
    if (this.lastPoiIndex < this.lastPoiResults.length) {
      return this.lastPoiResults[this.lastPoiIndex++];
    }
    return null;
  }

  // 新增方法：判断是否还有更多POI
  hasMorePoi() {
    return (
      this.lastPoiResults && this.lastPoiIndex < this.lastPoiResults.length
    );
  }

  // 新增方法：保存未完成的路线信息
  setPendingRouteInfo(info) {
    this.pendingRouteInfo = info;
    this.updateTimestamp();
  }

  // 新增方法：获取未完成的路线信息
  getPendingRouteInfo() {
    return this.pendingRouteInfo;
  }

  // 新增方法：清除未完成的路线信息
  clearPendingRouteInfo() {
    this.pendingRouteInfo = null;
    this.updateTimestamp();
  }

  // 新增方法：更新当前位置坐标
  updateCurrentCoords(lat, lng) {
    this.currentLat = lat;
    this.currentLng = lng;
    this.updateTimestamp();
  }

  // 新增方法：更新行程
  updateJourney(origin, destination) {
    this.tripHistory.push({
      from: origin,
      to: destination,
      timestamp: Date.now(),
      completed: true,
    });
    this.lastDestination = destination;
    this.currentLocation = destination;
    this.updateTimestamp();
  }

  // 新增方法：获取上次目的地
  getLastDestination() {
    return this.lastDestination;
  }

  // 新增方法：获取当前位置
  getCurrentLocation() {
    return this.currentLocation || this.lastDestination;
  }

  // 更新最后规划的起点
  updateLastOrigin(origin) {
    this.lastOrigin = origin;
    this.updateTimestamp();
  }

  // 更新最后规划的终点
  updateLastDestination(destination) {
    this.lastDestination = destination;
    this.updateTimestamp();
  }

  // 更新最后搜索的中心点
  updateLastSearchedLocation(location) {
    this.lastSearchedLocation = location;
    this.updateTimestamp();
  }

  // 更新最后提及的地点
  updateLastMentionedLocation(location) {
    this.lastMentionedLocation = location;
    this.updateTimestamp();
  }

  // 获取最后规划的起点
  getLastOrigin() {
    return this.lastOrigin;
  }

  // 获取最后规划的终点
  getLastDestination() {
    return this.lastDestination;
  }

  // 获取最后搜索的中心点
  getLastSearchedLocation() {
    return this.lastSearchedLocation;
  }

  // 获取最后提及的地点
  getLastMentionedLocation() {
    return this.lastMentionedLocation;
  }

  // 记录地点到历史
  addToLocationHistory(location, role) {
    if (location) {
      this.locationHistory.push({
        location: location,
        role: role,
        timestamp: Date.now(),
      });
      // 只保留最近10个地点
      if (this.locationHistory.length > 10) {
        this.locationHistory.shift();
      }
    }
  }

  // 根据上下文获取最佳地点
  getBestLocationForContext(userInput = '') {
    const input = String(userInput).toLowerCase();

    // 续程检测
    if (
      input.includes('再去') ||
      input.includes('然后去') ||
      input.includes('接着去')
    ) {
      if (this.lastDestination) return this.lastDestination;
    }

    // 优先级1：如果用户输入包含"那"或"那里"，优先返回lastSearchedLocation或lastDestination
    if (
      input.includes('那') ||
      input.includes('那里') ||
      input.includes('那儿')
    ) {
      if (this.lastSearchedLocation) {
        return this.lastSearchedLocation;
      }
      if (this.lastDestination) {
        return this.lastDestination;
      }
      if (this.lastMentionedLocation) {
        return this.lastMentionedLocation;
      }
    }

    // 优先级2：如果用户输入包含"这"但不包括"哪"，优先返回lastOrigin或currentLocation
    if (input.includes('这') && !input.includes('哪')) {
      if (this.lastOrigin) {
        return this.lastOrigin;
      }
      if (this.currentLocation) {
        return this.currentLocation;
      }
    }

    // 优先级3：如果用户输入包含"附近"或"周边"，优先返回lastSearchedLocation
    if (input.includes('附近') || input.includes('周边')) {
      if (this.lastSearchedLocation) {
        return this.lastSearchedLocation;
      }
      if (this.lastDestination) {
        return this.lastDestination;
      }
    }

    // 优先级4：如果用户输入包含"从哪里"、"从哪出发"，返回lastOrigin或currentLocation
    if (input.includes('从哪里') || input.includes('从哪出发')) {
      if (this.lastOrigin) {
        return this.lastOrigin;
      }
      if (this.currentLocation) {
        return this.currentLocation;
      }
    }

    // 优先级5：按顺序返回最近更新的地点
    if (this.lastSearchedLocation) {
      return this.lastSearchedLocation;
    }
    if (this.lastDestination) {
      return this.lastDestination;
    }
    if (this.lastMentionedLocation) {
      return this.lastMentionedLocation;
    }
    if (this.lastOrigin) {
      return this.lastOrigin;
    }
    if (this.currentLocation) {
      return this.currentLocation;
    }

    return null;
  }

  toJSON() {
    return {
      sessionId: this.sessionId,
      state: this.state,
      collectedInfo: this.collectedInfo,
      dialogHistory: this.dialogHistory,
      lastRecommendation: this.lastRecommendation,
      lastTimestamp: this.lastTimestamp,
      lastDestination: this.lastDestination,
      lastMentionedLocation: this.lastMentionedLocation,
      tripHistory: this.tripHistory,
      currentLocation: this.currentLocation,
      currentLat: this.currentLat,
      currentLng: this.currentLng,
      context: this.context,
      lastPoiResults: this.lastPoiResults,
      lastPoiIndex: this.lastPoiIndex,
      poiSearch: this.poiSearch,
    };
  }

  static fromJSON(json) {
    const session = new ConversationSession(json.sessionId);
    session.state = json.state;
    session.collectedInfo = json.collectedInfo;
    session.dialogHistory = json.dialogHistory || [];
    session.lastRecommendation = json.lastRecommendation;
    session.lastTimestamp = json.lastTimestamp;
    session.lastDestination = json.lastDestination;
    session.lastMentionedLocation = json.lastMentionedLocation;
    session.tripHistory = json.tripHistory || [];
    session.currentLocation = json.currentLocation;
    session.currentLat = json.currentLat;
    session.currentLng = json.currentLng;
    session.context = json.context || {
      lastMentionedCity: null,
      currentCity: null,
    };
    session.lastPoiResults = json.lastPoiResults;
    session.lastPoiIndex = json.lastPoiIndex || 0;
    session.poiSearch = json.poiSearch;
    return session;
  }
}

// Session管理类
class SessionManager {
  constructor() {
    this.redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    this.redisClient.connect().catch(console.error);
    this.cleanupInterval = null;
  }

  async getSession(sessionId) {
    try {
      const sessionData = await this.redisClient.get(`session:${sessionId}`);
      if (sessionData) {
        const session = ConversationSession.fromJSON(JSON.parse(sessionData));
        session.updateTimestamp();
        await this.saveSession(session);
        return session;
      } else {
        const newSession = new ConversationSession(sessionId);
        await this.saveSession(newSession);
        return newSession;
      }
    } catch (error) {
      console.error('Error getting session:', error);
      // 降级到内存存储
      if (!this.memorySessions) {
        this.memorySessions = new Map();
      }
      if (!this.memorySessions.has(sessionId)) {
        this.memorySessions.set(sessionId, new ConversationSession(sessionId));
      }
      return this.memorySessions.get(sessionId);
    }
  }

  async saveSession(session) {
    try {
      const sessionData = JSON.stringify(session.toJSON());
      await this.redisClient.set(
        `session:${session.sessionId}`,
        sessionData,
        { EX: 3600 } // 1小时过期
      );
    } catch (error) {
      console.error('Error saving session:', error);
      // 降级到内存存储
      if (!this.memorySessions) {
        this.memorySessions = new Map();
      }
      this.memorySessions.set(session.sessionId, session);
    }
  }

  async deleteSession(sessionId) {
    try {
      await this.redisClient.del(`session:${sessionId}`);
    } catch (error) {
      console.error('Error deleting session:', error);
      // 降级到内存存储
      if (this.memorySessions) {
        this.memorySessions.delete(sessionId);
      }
    }
  }

  startCleanupTimer(intervalMs = 3600000) {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cleanupInterval = setInterval(async () => {
      try {
        // Redis 会自动过期，这里不需要手动清理
        // 清理内存中的会话（如果有）
        if (this.memorySessions) {
          const now = Date.now();
          for (const [sessionId, session] of this.memorySessions.entries()) {
            if (now - session.lastTimestamp > 3600000) {
              this.memorySessions.delete(sessionId);
            }
          }
        }
      } catch (error) {
        console.error('Error during session cleanup:', error);
      }
    }, intervalMs);
  }

  stopCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  async close() {
    try {
      await this.redisClient.quit();
    } catch (error) {
      console.error('Error closing Redis connection:', error);
    }
  }
}

module.exports = {
  DIALOG_STATES,
  INTENT_TYPES,
  ConversationSession,
  SessionManager,
};
