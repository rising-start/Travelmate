/**
 * DialogManager 测试：验证死代码已移除、提示词要求 selected_skill、状态机容错
 */

const DialogManager = require('../../src/session/dialogManager');
const {
  ConversationSession,
  INTENT_TYPES,
  DIALOG_STATES,
} = require('../../src/session/conversationSession');

describe('DialogManager', () => {
  it('should not export dead parsers', () => {
    expect(DialogManager.parseIntentResponse).toBeUndefined();
    expect(DialogManager.generateFollowUpQuestion).toBeUndefined();
    expect(DialogManager.extractInfoFromText).toBeUndefined();
  });

  it('should ask model for selected_skill and wrap user input', async () => {
    const session = new ConversationSession('dialog-test');
    const prompt = await DialogManager.buildContextAwarePrompt(
      session,
      '从广州去北京'
    );

    expect(prompt).toContain('"selected_skill"');
    expect(prompt).toContain('<user_input>');
    expect(prompt).toContain('从广州去北京');
  });

  it('should ask for origin when poi_search is missing', () => {
    const session = new ConversationSession('dialog-test');
    const next = DialogManager.determineNextState(session, {
      intent: INTENT_TYPES.NEW_JOURNEY,
      missingInfo: ['origin'],
    });

    expect(next).toBe(DIALOG_STATES.COLLECTING_ORIGIN);
  });

  it('should honor poi_search when provided', () => {
    const session = new ConversationSession('dialog-test');
    const withCenter = DialogManager.determineNextState(session, {
      intent: INTENT_TYPES.QUERY,
      missingInfo: [],
      poi_search: { enabled: true },
      origin: '广州',
    });
    const withoutCenter = DialogManager.determineNextState(session, {
      intent: INTENT_TYPES.QUERY,
      missingInfo: [],
      poi_search: { enabled: true },
    });

    expect(withCenter).toBe(DIALOG_STATES.RECOMMENDING);
    expect(withoutCenter).toBe(DIALOG_STATES.COLLECTING_ORIGIN);
  });
});
