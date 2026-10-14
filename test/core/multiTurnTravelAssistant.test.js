/**
 * MultiTurnTravelAssistant 测试
 */

const MultiTurnTravelAssistant = require('../../src/core/multiTurnTravelAssistant');

// Mock 依赖
jest.mock('../../src/services/llm');
jest.mock('../../src/services/mcp');
jest.mock('../../src/services/weather');
jest.mock('../../src/session/conversationSession');
jest.mock('../../src/skills/SkillManager');

describe('MultiTurnTravelAssistant', () => {
  let assistant;

  beforeEach(() => {
    // 重置所有 mocks
    jest.clearAllMocks();
    // 创建实例
    assistant = new MultiTurnTravelAssistant();
  });

  describe('isResetCommand', () => {
    it('should return true for reset commands', () => {
      const resetCommands = ['重新开始', '重新来', '算了', '取消', 'reset', '重新'];
      resetCommands.forEach(command => {
        expect(assistant.isResetCommand(command)).toBe(true);
      });
    });

    it('should return false for non-reset commands', () => {
      const nonResetCommands = ['你好', '北京天气', '从上海到北京'];
      nonResetCommands.forEach(command => {
        expect(assistant.isResetCommand(command)).toBe(false);
      });
    });
  });

  describe('fallbackIntentParsing', () => {
    it('should parse POI search intent', () => {
      const session = {
        getBestLocationForContext: jest.fn().mockReturnValue(null)
      };
      const result = assistant.fallbackIntentParsing('北京附近有什么好吃的', session);
      expect(result.intent).toBe('query');
      expect(result.poi_search).toBeDefined();
    });

    it('should parse route intent', () => {
      const session = {
        getBestLocationForContext: jest.fn().mockReturnValue(null)
      };
      const result = assistant.fallbackIntentParsing('从上海到北京', session);
      expect(result.intent).toBe('route');
      expect(result.hasRouteIntent).toBe(true);
    });
  });

  describe('normalizeIntentResult', () => {
    it('should normalize clarify intent', () => {
      const llmResult = { intent: 'clarify' };
      const result = assistant.normalizeIntentResult(llmResult);
      expect(result.intent).toBe('clarify');
      expect(result.clarification).toBe('您指的是哪里？');
    });

    it('should normalize confirm intent', () => {
      const llmResult = { intent: 'confirm' };
      const result = assistant.normalizeIntentResult(llmResult);
      expect(result.intent).toBe('confirm');
    });

    it('should normalize unknown intent', () => {
      const llmResult = {};
      const result = assistant.normalizeIntentResult(llmResult);
      expect(result.intent).toBe('unknown');
    });
  });

  describe('updateSessionFromIntent', () => {
    it('should update session with origin and destination', () => {
      const session = {
        setOrigin: jest.fn(),
        setDestination: jest.fn(),
        updateLastMentionedLocation: jest.fn()
      };
      const intentResult = {
        origin: '上海',
        destination: '北京',
        hasRouteIntent: true
      };
      assistant.updateSessionFromIntent(session, intentResult);
      expect(session.setOrigin).toHaveBeenCalledWith('上海');
      expect(session.setDestination).toHaveBeenCalledWith('北京');
      expect(session.updateLastMentionedLocation).toHaveBeenCalledWith('上海');
    });
  });

  describe('handlePoiSearch', () => {
    it('should call POISkill with correct params', async () => {
      const session = {};
      const center = '北京';
      const poiSearch = { keywords: '餐厅', radius: 1000 };
      const mockResult = { thought: 'POI搜索完成', answer: '搜索结果' };
      
      assistant.skillManager.executeSkill = jest.fn().mockResolvedValue(mockResult);
      const result = await assistant.handlePoiSearch(session, center, poiSearch);
      
      expect(assistant.skillManager.executeSkill).toHaveBeenCalledWith('POISkill', {
        center: '北京',
        keywords: '餐厅',
        radius: 1000,
        limit: 10
      }, session);
      expect(result).toEqual(mockResult);
    });
  });

  describe('handleInfoCollection', () => {
    it('should return missing info question when origin is missing', async () => {
      const session = {
        setOrigin: jest.fn(),
        setDestination: jest.fn(),
        isInfoComplete: jest.fn().mockReturnValue(false),
        getMissingInfo: jest.fn().mockReturnValue(['origin'])
      };
      const intentResult = {};
      const result = await assistant.handleInfoCollection(session, intentResult);
      expect(result.answer).toBe('请问您从哪里出发？');
    });

    it('should return missing info question when destination is missing', async () => {
      const session = {
        setOrigin: jest.fn(),
        setDestination: jest.fn(),
        isInfoComplete: jest.fn().mockReturnValue(false),
        getMissingInfo: jest.fn().mockReturnValue(['destination'])
      };
      const intentResult = {};
      const result = await assistant.handleInfoCollection(session, intentResult);
      expect(result.answer).toBe('您想去哪里？');
    });
  });

  describe('handleConfirmation', () => {
    it('should handle confirm intent', async () => {
      const session = {};
      const intentResult = { intent: 'confirm' };
      const result = await assistant.handleConfirmation(session, intentResult);
      expect(result.answer).toBe('好的，正在为您规划最佳路线...');
    });

    it('should handle negate intent', async () => {
      const session = {
        reset: jest.fn()
      };
      const intentResult = { intent: 'negate' };
      const result = await assistant.handleConfirmation(session, intentResult);
      expect(session.reset).toHaveBeenCalled();
      expect(result.answer).toBe('好的，我们重新开始。请告诉我您想去哪里？');
    });
  });

  describe('executeInstruction', () => {
    it('should return error for invalid instruction', async () => {
      const session = {};
      const result = await assistant.executeInstruction('invalid', session);
      expect(result.answer).toBe('抱歉，无法理解您的需求，请稍后重试。');
    });

    it('should return error for low confidence', async () => {
      const session = {};
      const instruction = {
        selected_skill: 'RouteSkill',
        params: {},
        confidence: 0.5
      };
      const result = await assistant.executeInstruction(instruction, session);
      expect(result.answer).toBe('抱歉，我不太理解您的需求。请用简单清晰的语言告诉我您的需求，谢谢！');
    });

    it('should call skill manager for valid instruction', async () => {
      const session = {};
      const instruction = {
        selected_skill: 'RouteSkill',
        params: { origin: '上海', destination: '北京' },
        confidence: 0.8
      };
      const mockResult = { thought: '路线规划完成', answer: '路线结果' };
      
      assistant.skillManager.executeSkill = jest.fn().mockResolvedValue(mockResult);
      const result = await assistant.executeInstruction(instruction, session);
      
      expect(assistant.skillManager.executeSkill).toHaveBeenCalledWith('RouteSkill', {
        origin: '上海',
        destination: '北京',
        originalMessage: ''
      }, session);
      expect(result).toEqual(mockResult);
    });
  });
});
