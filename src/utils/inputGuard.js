


const MAX_PROMPT_TEXT_LENGTH = 500;
const MAX_PARAM_LENGTH = 100;
const VALID_SKILLS = [
  'RouteSkill',
  'WeatherSkill',
  'POISkill',
  'GeneralInfoSkill',
  'AskUserSkill',
  'ShowMoreSkill'
];

const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');
const CODE_FENCE = /```/g;
const SPECIAL_TOKENS = /<\|[^|]{0,64}\|>/g;
const ROLE_TAGS = /<\s*\/?\s*(user_input|user|system|assistant|im_start|im_end)\s*>/gi;
const MAX_STRIP_ROUNDS = 5;
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



function wrapUserInput(input) {
  return `<user_input>\n${sanitizeUserInput(input)}\n</user_input>`;
}



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



function sanitizeInstructionParams(params) {
  const collected = Object.create(null);
  if (!params || typeof params !== 'object') {
    return Object.assign({}, collected);
  }
  Object.entries(params).forEach(([key, value]) => {
    const safeKey = sanitizeUserInput(key, 50);
    if (!safeKey || UNSAFE_KEYS.has(safeKey)) {
      return;
    }
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
