


class AskUserSkill {
  

  async execute(params, session) {
    try {
      const { question, missing_field } = params;

      if (missing_field) {
        session.pendingField = missing_field;
      }

      return {
        thought: '询问用户',
        answer: question || '请问您能提供更多信息吗？',
      };
    } catch (error) {
      console.error('执行询问用户技能失败:', error);
      return {
        thought: '执行失败',
        answer: '请问您能提供更多信息吗？',
      };
    }
  }
}

module.exports = AskUserSkill;