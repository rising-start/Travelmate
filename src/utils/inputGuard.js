/**
 * 输入/输出安全护栏
 *
 * 1. sanitizeUserInput：清洗进入 LLM 提示词的自由文本，防止用户输入突破提示词结构
 * 2. isValidInstruction / sanitizeInstructionParams：校验并收敛 LLM 的决策输出，
 *    防止伪造技能名或注入非法参数结构
 */

// 进入提示词的单段文本长度上限
const MAX_PROMPT_TEXT_LENGTH = 500;
// 单个技能参数值的长度上限
const MAX_PARAM_LENGTH = 100;
// 允许的技能白名单（与 SkillManager 保持一致）
const VALID_SKILLS = [
  'RouteSkill',
  'WeatherSkill',
  'POISkill',
  'GeneralInfoSkill',
  'AskUserSkill',
  'ShowMoreSkill'
];

// 用于伪角色/截断/包裹攻击的字符与标记
// 我们就是要匹配控制字符（用来清除），关闭 no-control-regex
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');
const CODE_FENCE = /```/g;
const SPECIAL_TOKENS = /<\|[^|]{0,64}\|>/g;
// 允许标签内出现空白与换行变体，例如 < user_input >、<\nuser_input>
const ROLE_TAGS = /<\s*\/?\s*(user_input|user|system|assistant|im_start|im_end)\s*>/gi;
// 单次 replace 会被嵌套构造重组（<use<user_input>r_input> 清洗后正好得到 <user_input>），
// 必须反复清洗直到结果稳定
const MAX_STRIP_ROUNDS = 5;
// 这些键赋值到普通对象会改写原型链，必须从 LLM 输出里剔除
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function stripRoleTags(text) {
  let current = text;
  for (let round = 0; round < MAX_STRIP_ROUNDS; round += 1) {
    const next = current.replace(ROLE_TAGS, '').replace(SPECIAL_TOKENS, '');
    if (next === current) {
      return next;
    }
    current = next;
  }
  return current;
}

/**
 * 清洗自由文本，供拼接到提示词前使用
 * @param {*} input - 原始输入
 * @param {number} maxLength - 最大长度
 * @returns {string} 清洗后的文本
 */
function sanitizeUserInput(input, maxLength = MAX_PROMPT_TEXT_LENGTH) {
  let text = input === undefined || input === null ? '' : String(input);
  text = text
    .replace(CONTROL_CHARS, ' ')
    .replace(CODE_FENCE, '"""');
  text = stripRoleTags(text);
  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
  }
  return text.trim();
}

/**
 * 把用户输入包裹成数据区，明确告诉模型这是"被分析的数据"而非指令
 * @param {*} input - 原始用户输入
 * @returns {string} 包裹后的片段
 */
function wrapUserInput(input) {
  return `<user_input>\n${sanitizeUserInput(input)}\n</user_input>`;
}

/**
 * 校验 LLM 返回的指令对象是否合法
 * @param {*} instruction - 待校验对象
 * @returns {boolean} 是否合法
 */
function isValidInstruction(instruction) {
  if (
    !instruction ||
    typeof instruction !== 'object' ||
    Array.isArray(instruction)
  ) {
    return false;
  }
  if (typeof instruction.selected_skill !== 'string') {
    return false;
  }
  if (!VALID_SKILLS.includes(instruction.selected_skill)) {
    return false;
  }
  if (instruction.params !== undefined && instruction.params !== null) {
    if (
      typeof instruction.params !== 'object' ||
      Array.isArray(instruction.params)
    ) {
      return false;
    }
    if (Object.keys(instruction.params).length > 20) {
      return false;
    }
  }
  return true;
}

/**
 * 清洗指令参数：只保留字符串/数字/布尔/字符串数组，并限制长度
 * @param {Object} params - 原始参数
 * @returns {Object} 清洗后的参数
 */
function sanitizeInstructionParams(params) {
  // 先用无原型对象承载，写回普通对象时就不会触发 __proto__ setter
  const collected = Object.create(null);
  if (!params || typeof params !== 'object') {
    return Object.assign({}, collected);
  }
  Object.entries(params).forEach(([key, value]) => {
    const safeKey = sanitizeUserInput(key, 50);
    if (!safeKey || UNSAFE_KEYS.has(safeKey)) {
      return;
    }
    // 清洗后重名时保留先到的键，避免后者静默覆盖前者
    if (collected[safeKey] !== undefined) {
      return;
    }
    if (typeof value === 'string') {
      collected[safeKey] = sanitizeUserInput(value, MAX_PARAM_LENGTH);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      collected[safeKey] = value;
    } else if (Array.isArray(value)) {
      collected[safeKey] = value
        .slice(0, 10)
        .map(item => sanitizeUserInput(item, MAX_PARAM_LENGTH))
        .filter(item => item !== '');
    }
  });
  return Object.assign({}, collected);
}

module.exports = {
  sanitizeUserInput,
  wrapUserInput,
  isValidInstruction,
  sanitizeInstructionParams,
  VALID_SKILLS,
  MAX_PARAM_LENGTH,
  MAX_PROMPT_TEXT_LENGTH
};
