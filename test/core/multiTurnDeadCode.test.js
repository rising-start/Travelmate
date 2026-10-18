


const MultiTurnTravelAssistant = require('../../src/core/multiTurnTravelAssistant');

describe('MultiTurnTravelAssistant 死代码清理', () => {
  let assistant;

  beforeAll(() => {
    assistant = new MultiTurnTravelAssistant();
  });

  afterAll(async () => {
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
