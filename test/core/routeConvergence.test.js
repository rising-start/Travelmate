/**
 * 路线规划实现收敛测试
 * RouteSkill 是路线规划的唯一实现；multiTurn 不再自带 handlePlanRoute
 */

const MultiTurnTravelAssistant = require('../../src/core/multiTurnTravelAssistant');
const RouteSkill = require('../../src/skills/RouteSkill');
const { ConversationSession } = require('../../src/session/conversationSession');

describe('路线规划实现收敛', () => {
  let assistant;

  beforeAll(() => {
    assistant = new MultiTurnTravelAssistant();
  });

  afterAll(async () => {
    assistant.sessionManager.stopCleanupTimer();
    await assistant.sessionManager.close();
  });

  it('should detect route requests', () => {
    expect(assistant.isRouteRequest('从广州到深圳怎么走')).toBe(true);
    // 只含 POI/天气意图或只有目的地时不能判定为路线，否则会吞掉后续兜底
    expect(assistant.isRouteRequest('这附近有没有地铁站')).toBe(false);
    expect(assistant.isRouteRequest('广州天气怎么样')).toBe(false);
    expect(assistant.isRouteRequest('去北京')).toBe(false);
  });

  it('should parse endpoints for route requests', () => {
    const { origin, destination } = assistant.parseOriginAndDestination(
      '从广州到深圳'
    );

    expect(origin).toBe('广州');
    expect(destination).toBe('深圳');
  });

  it('should keep RouteSkill as the single route implementation', () => {
    expect(typeof RouteSkill.prototype.handlePlanRoute).toBe('function');
    expect(assistant.handlePlanRoute).toBeUndefined();
  });

  it('should return unified route result shape', async () => {
    const session = new ConversationSession('converge-test');
    const skill = new RouteSkill(
      {
        geocode: jest.fn().mockResolvedValue({
          longitude: 113.1,
          latitude: 23.2,
          adcode: '440100',
        }),
        getDirections: jest.fn().mockResolvedValue([
          {
            type: '驾车',
            duration: '30分钟',
            cost: '¥20',
            distance: '10000',
          },
        ]),
      },
      {}
    );

    const result = await skill.handlePlanRoute(
      { origin: '广州', destination: '深圳' },
      session
    );

    expect(result).toHaveProperty('thought');
    expect(typeof result.answer).toBe('string');
  });
});
