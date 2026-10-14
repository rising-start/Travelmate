/**
 * SkillManager 测试
 */

const SkillManager = require('../../src/skills/SkillManager');

// Mock 依赖
jest.mock('../../src/skills/RouteSkill');
jest.mock('../../src/skills/WeatherSkill');
jest.mock('../../src/skills/POISkill');
jest.mock('../../src/skills/GeneralInfoSkill');
jest.mock('../../src/skills/AskUserSkill');
jest.mock('../../src/skills/ShowMoreSkill');

const RouteSkill = require('../../src/skills/RouteSkill');
const WeatherSkill = require('../../src/skills/WeatherSkill');
const POISkill = require('../../src/skills/POISkill');
const GeneralInfoSkill = require('../../src/skills/GeneralInfoSkill');
const AskUserSkill = require('../../src/skills/AskUserSkill');
const ShowMoreSkill = require('../../src/skills/ShowMoreSkill');

describe('SkillManager', () => {
  let skillManager;
  let mockMcp;
  let mockWeather;

  beforeEach(() => {
    // 重置所有 mocks
    jest.clearAllMocks();
    
    // 创建 mock 依赖
    mockMcp = {
      geocode: jest.fn(),
      getDirections: jest.fn(),
      searchNearby: jest.fn()
    };
    
    mockWeather = {
      getWeatherByCityName: jest.fn(),
      generateSmartAdvice: jest.fn(),
      generateNaturalLanguageAdvice: jest.fn()
    };
    
    // 创建 SkillManager 实例
    skillManager = new SkillManager(mockMcp, mockWeather);
  });

  describe('initializeSkills', () => {
    it('should initialize all skills', () => {
      expect(RouteSkill).toHaveBeenCalledWith(mockMcp, mockWeather);
      expect(WeatherSkill).toHaveBeenCalledWith(mockWeather);
      expect(POISkill).toHaveBeenCalledWith(mockMcp);
      expect(GeneralInfoSkill).toHaveBeenCalledWith(mockMcp);
      expect(AskUserSkill).toHaveBeenCalled();
      expect(ShowMoreSkill).toHaveBeenCalled();
    });
  });

  describe('executeSkill', () => {
    it('should execute existing skill', async () => {
      const mockSkill = {
        execute: jest.fn().mockResolvedValue({ thought: 'Skill executed', answer: 'Skill result' })
      };
      
      // 模拟技能实例
      skillManager.skills.TestSkill = mockSkill;
      
      const params = { test: 'data' };
      const session = {};
      const result = await skillManager.executeSkill('TestSkill', params, session);
      
      expect(mockSkill.execute).toHaveBeenCalledWith(params, session);
      expect(result).toEqual({ thought: 'Skill executed', answer: 'Skill result' });
    });

    it('should return error for unknown skill', async () => {
      const params = { test: 'data' };
      const session = {};
      const result = await skillManager.executeSkill('UnknownSkill', params, session);
      
      expect(result.thought).toBe('未知技能');
      expect(result.answer).toBe('抱歉，我还不会处理这类问题。请用简单清晰的语言告诉我您的需求，谢谢！');
    });

    it('should handle skill execution error', async () => {
      const mockSkill = {
        execute: jest.fn().mockRejectedValue(new Error('Skill execution failed'))
      };
      
      // 模拟技能实例
      skillManager.skills.TestSkill = mockSkill;
      
      const params = { test: 'data' };
      const session = {};
      const result = await skillManager.executeSkill('TestSkill', params, session);
      
      expect(result.thought).toBe('技能执行失败');
      expect(result.answer).toBe('抱歉，处理您的请求时出现了问题，请稍后重试。');
    });
  });

  describe('getSkillList', () => {
    it('should return list of skill names', () => {
      const skillList = skillManager.getSkillList();
      expect(skillList).toContain('RouteSkill');
      expect(skillList).toContain('WeatherSkill');
      expect(skillList).toContain('POISkill');
      expect(skillList).toContain('GeneralInfoSkill');
      expect(skillList).toContain('AskUserSkill');
      expect(skillList).toContain('ShowMoreSkill');
    });
  });
});
