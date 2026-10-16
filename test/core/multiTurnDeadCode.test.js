/**
 * MultiTurnTravelAssistant 死代码清理测试
 * 类内重写的 Skill 与 handlePlanRoute 已删除，路线规划统一由 SkillManager 分发
 */

const MultiTurnTravelAssistant = require('../../src/core/multiTurnTravelAssistant');

describe('MultiTurnTravelAssistant 死代码清理', () => {
  let assistant;

  beforeAll(() => {
    assistant = new MultiTurnTravelAssistant();
  });

  afterAll(async () => {
    // 释放清理定时器与 Redis 连接，避免 jest 进程挂住
    assistant.sessionManager.stopCleanupTimer();
    await assistant.sessionManager.close();
  });

  it('should not redefine skills inside the assistant', () => {
    expect(assistant.GeneralInfoSkill).toBeUndefined();
    expect(assistant.AskUserSkill).toBeUndefined();
    expect(assistant.ShowMoreSkill).toBeUndefined();
    expect(assistant.handlePlanRoute).toBeUndefined();
  });

  it('should still dispatch through SkillManager', () => {
    expect(typeof assistant.skillManager.executeSkill).toBe('function');
  });
});
