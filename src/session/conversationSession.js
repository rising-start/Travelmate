const { createClient } = require('redis');

const REDIS_WAIT_TIMEOUT = 2000;
const MAX_TRIP_HISTORY = 50;

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
  CONTINUE_JOURNEY: 'CONTINUE_JOURNEY',
  NEW_JOURNEY: 'NEW_JOURNEY',
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
    this.lastOrigin = null;
    this.lastDestination = null;
    this.lastSearchedLocation = null;
    this.lastMentionedLocation = null;
    this.currentLocation = null;
    this.currentLat = null;
    this.currentLng = null;
    this.locationHistory = [];
    this.tripHistory = [];
    this.context = {
      lastMentionedCity: null,
      currentCity: null,
    };
    this.lastPoiResults = null;
    this.lastPoiIndex = 0;
    this.poiSearch = null;
    this.lastPoiKeywords = null;
    this.pendingRouteInfo = null;
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
    return [];
  }

  setLastPoiResults(results) {
    this.lastPoiResults = results;
    this.lastPoiIndex = 0;
    this.updateTimestamp();
  }

  getLastPoiResults() {
    return this.lastPoiResults;
  }

  getLastPoiIndex() {
    return this.lastPoiIndex || 0;
  }

  setLastPoiIndex(index) {
    this.lastPoiIndex = index;
    this.updateTimestamp();
  }

  setLastPoiKeywords(keywords) {
    this.lastPoiKeywords = keywords;
    this.updateTimestamp();
  }

  getLastPoiKeywords() {
    return this.lastPoiKeywords;
  }

  getNextPoi() {
    if (!this.lastPoiResults || this.lastPoiResults.length === 0) {
      return null;
    }
    if (this.lastPoiIndex < this.lastPoiResults.length) {
      return this.lastPoiResults[this.lastPoiIndex++];
    }
    return null;
  }

  hasMorePoi() {
    return (
      this.lastPoiResults && this.lastPoiIndex < this.lastPoiResults.length
    );
  }

  setPendingRouteInfo(info) {
    this.pendingRouteInfo = info;
    this.updateTimestamp();
  }

  getPendingRouteInfo() {
    return this.pendingRouteInfo;
  }

  clearPendingRouteInfo() {
    this.pendingRouteInfo = null;
    this.updateTimestamp();
  }

  updateCurrentCoords(lat, lng) {
    this.currentLat = lat;
    this.currentLng = lng;
    this.updateTimestamp();
  }

  updateJourney(origin, destination) {
    this.tripHistory.push({
      from: origin,
      to: destination,
      timestamp: Date.now(),
      completed: true,
    });
    if (this.tripHistory.length > MAX_TRIP_HISTORY) {
      this.tripHistory = this.tripHistory.slice(-MAX_TRIP_HISTORY);
    }
    this.lastDestination = destination;
    this.currentLocation = destination;
    this.updateTimestamp();
  }

  getLastDestination() {
    return this.lastDestination;
  }

  getCurrentLocation() {
    return this.currentLocation || this.lastDestination;
  }

  updateLastOrigin(origin) {
    this.lastOrigin = origin;
    this.updateTimestamp();
  }

  updateLastDestination(destination) {
    this.lastDestination = destination;
    this.updateTimestamp();
  }

  updateLastSearchedLocation(location) {
    this.lastSearchedLocation = location;
    this.updateTimestamp();
  }

  updateLastMentionedLocation(location) {
    this.lastMentionedLocation = location;
    this.updateTimestamp();
  }

  getLastOrigin() {
    return this.lastOrigin;
  }

  getLastDestination() {
    return this.lastDestination;
  }

  getLastSearchedLocation() {
    return this.lastSearchedLocation;
  }

  getLastMentionedLocation() {
    return this.lastMentionedLocation;
  }

  addToLocationHistory(location, role) {
    if (location) {
      this.locationHistory.push({
        location: location,
        role: role,
        timestamp: Date.now(),
      });
      if (this.locationHistory.length > 10) {
        this.locationHistory.shift();
      }
    }
  }

  getBestLocationForContext(userInput = '') {
    const input = String(userInput).toLowerCase();

    if (
      input.includes('再去') ||
      input.includes('然后去') ||
      input.includes('接着去')
    ) {
      if (this.lastDestination) return this.lastDestination;
    }

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

    if (input.includes('这') && !input.includes('哪')) {
      if (this.lastOrigin) {
        return this.lastOrigin;
      }
      if (this.currentLocation) {
        return this.currentLocation;
      }
    }

    if (input.includes('附近') || input.includes('周边')) {
      if (this.lastSearchedLocation) {
        return this.lastSearchedLocation;
      }
      if (this.lastDestination) {
        return this.lastDestination;
      }
    }

    if (input.includes('从哪里') || input.includes('从哪出发')) {
      if (this.lastOrigin) {
        return this.lastOrigin;
      }
      if (this.currentLocation) {
        return this.currentLocation;
      }
    }

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
      lastOrigin: this.lastOrigin,
      lastDestination: this.lastDestination,
      lastSearchedLocation: this.lastSearchedLocation,
      lastMentionedLocation: this.lastMentionedLocation,
      currentLocation: this.currentLocation,
      currentLat: this.currentLat,
      currentLng: this.currentLng,
      locationHistory: this.locationHistory,
      tripHistory: this.tripHistory,
      context: this.context,
      lastPoiResults: this.lastPoiResults,
      lastPoiIndex: this.lastPoiIndex,
      poiSearch: this.poiSearch,
      lastPoiKeywords: this.lastPoiKeywords || null,
      pendingRouteInfo: this.pendingRouteInfo,
    };
  }

  static fromJSON(json) {
    const session = new ConversationSession(json.sessionId);
    session.state = json.state;
    session.collectedInfo = json.collectedInfo;
    session.dialogHistory = json.dialogHistory || [];
    session.lastRecommendation = json.lastRecommendation;
    session.lastTimestamp = json.lastTimestamp;
    session.lastOrigin = json.lastOrigin || null;
    session.lastDestination = json.lastDestination;
    session.lastSearchedLocation = json.lastSearchedLocation || null;
    session.lastMentionedLocation = json.lastMentionedLocation;
    session.currentLocation = json.currentLocation;
    session.currentLat = json.currentLat;
    session.currentLng = json.currentLng;
    session.locationHistory = json.locationHistory || [];
    session.tripHistory = json.tripHistory || [];
    session.context = json.context || {
      lastMentionedCity: null,
      currentCity: null,
    };
    session.lastPoiResults = json.lastPoiResults;
    session.lastPoiIndex = json.lastPoiIndex || 0;
    session.poiSearch = json.poiSearch;
    session.lastPoiKeywords = json.lastPoiKeywords || null;
    session.pendingRouteInfo = json.pendingRouteInfo || null;
    return session;
  }
}

class SessionManager {
  constructor() {
    this.redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: retries => Math.min(retries * 200, 5000),
      },
    });
    this.redisClient.on('error', err => {
      console.error('[SessionManager] Redis 错误:', err && err.message);
    });
    this.redisClient.on('ready', () => {
      this.redisConnected = true;
    });
    this.redisClient.on('end', () => {
      this.redisConnected = false;
    });
    this.redisConnected = false;
    this.connectPromise = this.redisClient
      .connect()
      .then(() => {
        this.redisConnected = true;
      })
      .catch(err => {
        console.error(
          '[SessionManager] Redis 连接失败，会话降级到内存存储:',
          err && err.message
        );
      });
    this.cleanupInterval = null;
  }

  async waitForRedis(timeoutMs = REDIS_WAIT_TIMEOUT) {
    if (this.redisConnected && this.redisClient.isReady) {
      return true;
    }
    let timer = null;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      const ready = await Promise.race([
        this.connectPromise.then(() => this.redisConnected),
        timeout,
      ]);
      return ready === true && this.redisClient.isReady === true;
    } finally {
      clearTimeout(timer);
    }
  }

  static sanitizeSessionId(sessionId) {
    const raw =
      sessionId === undefined || sessionId === null ? '' : String(sessionId);
    return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'default';
  }

  sessionKey(sessionId) {
    return `session:${SessionManager.sanitizeSessionId(sessionId)}`;
  }

  async getSession(sessionId) {
    const safeId = SessionManager.sanitizeSessionId(sessionId);
    try {
      if (!(await this.waitForRedis())) {
        throw new Error('Redis 未连接');
      }
      const sessionData = await this.redisClient.get(this.sessionKey(safeId));
      if (sessionData) {
        const session = ConversationSession.fromJSON(JSON.parse(sessionData));
        session.updateTimestamp();
        await this.saveSession(session);
        return session;
      } else {
        const newSession = new ConversationSession(safeId);
        await this.saveSession(newSession);
        return newSession;
      }
    } catch (error) {
      console.error('Error getting session:', error);
      if (!this.memorySessions) {
        this.memorySessions = new Map();
      }
      if (!this.memorySessions.has(safeId)) {
        this.memorySessions.set(safeId, new ConversationSession(safeId));
      }
      return this.memorySessions.get(safeId);
    }
  }

  async saveSession(session) {
    try {
      if (!(await this.waitForRedis())) {
        throw new Error('Redis 未连接');
      }
      const sessionData = JSON.stringify(session.toJSON());
      await this.redisClient.set(
        this.sessionKey(session.sessionId),
        sessionData,
        { EX: 3600 }
      );
    } catch (error) {
      console.error('Error saving session:', error);
      if (!this.memorySessions) {
        this.memorySessions = new Map();
      }
      this.memorySessions.set(session.sessionId, session);
    }
  }

  async deleteSession(sessionId) {
    try {
      if (!(await this.waitForRedis())) {
        throw new Error('Redis 未连接');
      }
      await this.redisClient.del(this.sessionKey(sessionId));
    } catch (error) {
      console.error('Error deleting session:', error);
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
    this.stopCleanupTimer();
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
