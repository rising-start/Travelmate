


const RouteSkill = require('../../src/skills/RouteSkill');

function createMockSession(overrides = {}) {
  return {
    getLastDestination: jest.fn().mockReturnValue(null),
    clearPendingRouteInfo: jest.fn(),
    getPendingRouteInfo: jest.fn().mockReturnValue(null),
    getLastOrigin: jest.fn().mockReturnValue(null),
    getCurrentLocation: jest.fn().mockReturnValue(null),
    getLastSearchedLocation: jest.fn().mockReturnValue(null),
    getLastMentionedLocation: jest.fn().mockReturnValue(null),
    setPendingRouteInfo: jest.fn(),
    updateLastOrigin: jest.fn(),
    updateLastDestination: jest.fn(),
    addToLocationHistory: jest.fn(),
    ...overrides
  };
}

describe('RouteSkill', () => {
  let routeSkill;
  let mockMcp;
  let mockWeather;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockMcp = {
      geocode: jest.fn(),
      getDirections: jest.fn()
    };
    
    mockWeather = {
      getWeatherByCityName: jest.fn()
    };
    
    routeSkill = new RouteSkill(mockMcp, mockWeather);
  });

  describe('isCorrectingInput', () => {
    it('should return true for correcting patterns', () => {
      const correctingInputs = ['不是北京', '不对，应该是上海', '换个地方', '改一下', '应该从广州出发'];
      correctingInputs.forEach(input => {
        expect(routeSkill.isCorrectingInput(input)).toBe(true);
      });
    });

    it('should return false for non-correcting inputs', () => {
      const nonCorrectingInputs = ['从北京到上海', '北京天气', '你好'];
      nonCorrectingInputs.forEach(input => {
        expect(routeSkill.isCorrectingInput(input)).toBe(false);
      });
    });
  });

  describe('parseCorrectedInput', () => {
    it('should parse corrected input with from-to format', () => {
      const input = '从上海到北京';
      const result = routeSkill.parseCorrectedInput(input);
      expect(result.origin).toBe('上海');
      expect(result.destination).toBe('北京');
    });

    it('should return null for origin and destination if no match', () => {
      const input = '北京';
      const result = routeSkill.parseCorrectedInput(input);
      expect(result.origin).toBe(null);
      expect(result.destination).toBe(null);
    });
  });

  describe('parseOriginAndDestination', () => {
    it('should parse from-to format', () => {
      const input = '从上海到北京';
      const result = routeSkill.parseOriginAndDestination(input);
      expect(result.origin).toBe('上海');
      expect(result.destination).toBe('北京');
    });

    it('should parse from format', () => {
      const input = '从上海';
      const result = routeSkill.parseOriginAndDestination(input);
      expect(result.origin).toBe('上海');
      expect(result.destination).toBe(null);
    });

    it('should parse to format', () => {
      const input = '到北京';
      const result = routeSkill.parseOriginAndDestination(input);
      expect(result.origin).toBe(null);
      expect(result.destination).toBe('北京');
    });

    it('should parse go format', () => {
      const input = '去北京';
      const result = routeSkill.parseOriginAndDestination(input);
      expect(result.origin).toBe(null);
      expect(result.destination).toBe('北京');
    });

    it('should return null for origin and destination if no match', () => {
      const input = '北京';
      const result = routeSkill.parseOriginAndDestination(input);
      expect(result.origin).toBe(null);
      expect(result.destination).toBe(null);
    });
  });

  describe('formatDistance', () => {
    it('should format distance in kilometers', () => {
      expect(routeSkill.formatDistance('1500')).toBe('1.5公里');
      expect(routeSkill.formatDistance(2000)).toBe('2.0公里');
    });

    it('should format distance in meters', () => {
      expect(routeSkill.formatDistance('500')).toBe('500米');
      expect(routeSkill.formatDistance(999)).toBe('999米');
    });

    it('should return 0米 for invalid distance', () => {
      expect(routeSkill.formatDistance('')).toBe('0米');
      expect(routeSkill.formatDistance(null)).toBe('0米');
      expect(routeSkill.formatDistance('abc')).toBe('0米');
    });
  });

  describe('generateNaturalRouteAdvice', () => {
    it('should generate advice for driving', () => {
      const directions = [{
        type: '驾车',
        duration: '6小时',
        cost: '¥300'
      }];
      const result = routeSkill.generateNaturalRouteAdvice(directions, '上海', '北京');
      expect(result).toContain('推荐您驾车出行');
      expect(result).toContain('过路费约¥300');
    });

    it('should generate advice for public transport', () => {
      const directions = [{
        type: '公共交通',
        duration: '8小时',
        cost: '¥200',
        transfers: ['地铁1号线', '高铁', '地铁2号线']
      }];
      const result = routeSkill.generateNaturalRouteAdvice(directions, '上海', '北京');
      expect(result).toContain('推荐公共交通');
      expect(result).toContain('费用仅¥200');
      expect(result).toContain('需要换乘2次');
    });

    it('should generate advice for cycling', () => {
      const directions = [{
        type: '骑行',
        duration: '2小时'
      }];
      const result = routeSkill.generateNaturalRouteAdvice(directions, '上海', '北京');
      expect(result).toContain('骑行是个不错的选择');
    });

    it('should generate advice for walking', () => {
      const directions = [{
        type: '步行',
        duration: '30分钟'
      }];
      const result = routeSkill.generateNaturalRouteAdvice(directions, '上海', '北京');
      expect(result).toContain('距离较短，步行是最好的选择');
    });

    it('should return null for empty directions', () => {
      const result = routeSkill.generateNaturalRouteAdvice([], '上海', '北京');
      expect(result).toBe(null);
    });
  });

  describe('handlePlanRoute', () => {
    it('should return error for missing origin or destination', async () => {
      const params = { origin: '上海' };
      const session = {};
      const result = await routeSkill.handlePlanRoute(params, session);
      expect(result.answer).toBe('请问您从哪里出发，要去哪里？');
    });

    it('should return error for geocoding failure', async () => {
      const params = { origin: '上海', destination: '北京' };
      const session = {};
      
      mockMcp.geocode.mockResolvedValue(null);
      
      const result = await routeSkill.handlePlanRoute(params, session);
      expect(result.answer).toBe('抱歉，无法获取起点或终点的位置信息，请检查地址是否正确。');
    });

    it('should return error for route planning failure', async () => {
      const params = { origin: '上海', destination: '北京' };
      const session = {};
      
      mockMcp.geocode.mockResolvedValue({ longitude: 121.47, latitude: 31.23 });
      mockMcp.getDirections.mockResolvedValue([]);
      
      const result = await routeSkill.handlePlanRoute(params, session);
      expect(result.answer).toBe('抱歉，无法为您规划路线，请检查起点和终点是否正确。');
    });

    it('should return route planning result', async () => {
      const params = { origin: '上海', destination: '北京' };
      const session = {
        updateLastOrigin: jest.fn(),
        updateLastDestination: jest.fn(),
        addToLocationHistory: jest.fn()
      };
      
      mockMcp.geocode.mockResolvedValue({ longitude: 121.47, latitude: 31.23 });
      mockMcp.getDirections.mockResolvedValue([{
        type: '驾车',
        duration: '6小时',
        cost: '¥300',
        distance: '1300000',
        recommendedReason: '最快'
      }]);
      
      const result = await routeSkill.handlePlanRoute(params, session);
      expect(result.thought).toBe('路线规划完成');
      expect(result.answer).toContain('从上海到北京的出行方案');
      expect(result.data).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should handle continue route', async () => {
      const params = {
        originalMessage: '再去珠海',
        origin: null,
        destination: null
      };
      const session = createMockSession({
        getLastDestination: jest.fn().mockReturnValue('广州')
      });
      
      routeSkill.handlePlanRoute = jest.fn().mockResolvedValue({ thought: '路线规划完成', answer: '路线结果' });
      
      await routeSkill.execute(params, session);
      expect(routeSkill.handlePlanRoute).toHaveBeenCalledWith({ origin: '广州', destination: '珠海', mode: undefined }, session);
    });

    it('should handle route planning command', async () => {
      const params = {
        originalMessage: '__ROUTE_PLANNING__'
      };
      const session = {
        clearPendingRouteInfo: jest.fn()
      };
      
      const result = await routeSkill.execute(params, session);
      expect(result.answer).toBe('请问您从哪里出发？');
      expect(result.needs_user_input).toBe(true);
    });

    it('should handle pending route info', async () => {
      const params = {};
      const session = createMockSession({
        getPendingRouteInfo: jest.fn().mockReturnValue({ origin: '上海' })
      });
      
      routeSkill.handlePlanRoute = jest.fn().mockResolvedValue({ thought: '路线规划完成', answer: '路线结果' });
      
      const result = await routeSkill.execute(params, session);
      expect(result.needs_user_input).toBe(true);
      expect(result.answer).toBe('请问从上海去哪里？');
      expect(routeSkill.handlePlanRoute).not.toHaveBeenCalled();
      expect(session.setPendingRouteInfo).toHaveBeenCalledWith({ origin: '上海' });
    });

    it('should handle correcting input', async () => {
      const params = {
        originalMessage: '不是上海，是北京',
        origin: '上海',
        destination: '广州'
      };
      const session = createMockSession();
      
      routeSkill.isCorrectingInput = jest.fn().mockReturnValue(true);
      routeSkill.parseCorrectedInput = jest.fn().mockReturnValue({ origin: '北京', destination: '广州' });
      routeSkill.handlePlanRoute = jest.fn().mockResolvedValue({ thought: '路线规划完成', answer: '路线结果' });
      
      await routeSkill.execute(params, session);
      expect(routeSkill.handlePlanRoute).toHaveBeenCalledWith({ origin: '北京', destination: '广州', mode: undefined }, session);
    });

    it('should ask for origin when missing', async () => {
      const params = {};
      const session = createMockSession();
      
      const result = await routeSkill.execute(params, session);
      expect(result.answer).toBe('请问您从哪里出发？');
      expect(result.needs_user_input).toBe(true);
    });

    it('should ask for destination when missing', async () => {
      const params = { origin: '上海' };
      const session = createMockSession();
      
      const result = await routeSkill.execute(params, session);
      expect(result.answer).toBe('请问从上海去哪里？');
      expect(result.needs_user_input).toBe(true);
    });
  });
});
