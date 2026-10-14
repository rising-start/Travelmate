/**
 * SkillManager - 技能管理器，统一管理所有技能
 */

const RouteSkill = require('./RouteSkill');
const WeatherSkill = require('./WeatherSkill');
const POISkill = require('./POISkill');
const GeneralInfoSkill = require('./GeneralInfoSkill');
const AskUserSkill = require('./AskUserSkill');
const ShowMoreSkill = require('./ShowMoreSkill');

class SkillManager {
  constructor(mcp, weather) {
    this.mcp = mcp;
    this.weather = weather;
    this.skills = {};
    this.initializeSkills();
  }

  /**
   * 初始化技能
   */
  initializeSkills() {
    this.skills = {
      RouteSkill: new RouteSkill(this.mcp, this.weather),
      WeatherSkill: new WeatherSkill(this.weather),
      POISkill: new POISkill(this.mcp),
      GeneralInfoSkill: new GeneralInfoSkill(this.mcp),
      AskUserSkill: new AskUserSkill(),
      ShowMoreSkill: new ShowMoreSkill(),
    };
  }

  /**
   * 执行技能
   * @param {string} skillName - 技能名称
   * @param {Object} params - 参数
   * @param {Object} session - 会话对象
   * @returns {Promise<Object>} - 执行结果
   */
  async executeSkill(skillName, params, session) {
    try {
      const skill = this.skills[skillName];
      if (skill && typeof skill.execute === 'function') {
        return await skill.execute(params, session);
      }
      return {
        thought: '未知技能',
        answer: '抱歉，我还不会处理这类问题。请用简单清晰的语言告诉我您的需求，谢谢！',
      };
    } catch (error) {
      console.error(`执行技能 ${skillName} 失败:`, error);
      return {
        thought: '技能执行失败',
        answer: '抱歉，处理您的请求时出现了问题，请稍后重试。',
      };
    }
  }

  /**
   * 获取技能列表
   * @returns {Array} - 技能列表
   */
  getSkillList() {
    return Object.keys(this.skills);
  }
}

module.exports = SkillManager;