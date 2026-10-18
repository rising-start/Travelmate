


module.exports = {
  env: {
    node: true,
    commonjs: true,
    es2021: true,
    jest: true
  },
  extends: [
    'eslint:recommended',
    'plugin:prettier/recommended'
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  rules: {
    'no-console': 'warn',
    'no-unused-vars': 'warn',
    'no-undef': 'error',
    'no-empty': 'warn',
    'no-extra-semi': 'error',
    'semi': ['error', 'always'],
    'quotes': ['error', 'single'],
    'indent': ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'comma-dangle': ['error', 'never'],
    'no-trailing-spaces': 'error',
    'eol-last': ['error', 'always'],
    'object-curly-spacing': ['error', 'always'],
    'array-bracket-spacing': ['error', 'never'],
    'arrow-spacing': ['error', { 'before': true, 'after': true }],
    'space-infix-ops': 'error',
    'space-before-function-paren': ['error', 'never'],
    'keyword-spacing': ['error', { 'before': true, 'after': true }],
    'brace-style': ['error', '1tbs'],
    'curly': ['error', 'all'],
    'eqeqeq': ['error', 'always'],
    'no-case-declarations': 'error',
    'no-eval': 'error',
    'no-extend-native': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-new-wrappers': 'error',
    'no-redeclare': 'error',
    'no-return-assign': 'error',
    'no-sequences': 'error',
    'no-throw-literal': 'error',
    'no-undef-init': 'error',
    'no-unused-expressions': 'error',
    'no-useless-call': 'error',
    'no-useless-concat': 'error',
    'no-useless-escape': 'error',
    'no-void': 'error',
    'no-with': 'error',
    'radix': 'error',
    'wrap-iife': ['error', 'inside'],
    'yoda': ['error', 'never']
  }
};
