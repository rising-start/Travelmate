const {
  createLogger,
  currentLevel,
  LEVELS
} = require('../../src/utils/logger');

function setEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe('logger', () => {
  let stdoutSpy;
  let stderrSpy;
  let originalLevel;
  let originalDebug;

  beforeEach(() => {
    originalLevel = process.env.LOG_LEVEL;
    originalDebug = process.env.DEBUG;
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    setEnv('LOG_LEVEL', originalLevel);
    setEnv('DEBUG', originalDebug);
  });

  const lastStdout = () => stdoutSpy.mock.calls.join('\n');
  const lastStderr = () => stderrSpy.mock.calls.join('\n');

  test('默认级别为 info，屏蔽 debug 输出', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger();
    logger.debug('调试细节');
    expect(stdoutSpy).not.toHaveBeenCalled();
    logger.info('普通信息');
    expect(lastStdout()).toContain('普通信息');
  });

  test('error 与 warn 在默认级别下依然输出', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger();
    logger.error('失败原因');
    logger.warn('降级提示');
    expect(lastStderr()).toContain('失败原因');
    expect(lastStderr()).toContain('降级提示');
  });

  test('DEBUG=false 时 error 仍然输出（核心回归点）', () => {
    setEnv('DEBUG', 'false');
    setEnv('LOG_LEVEL', undefined);
    expect(currentLevel()).toBe('info');
    const logger = createLogger();
    logger.error('地理编码失败');
    expect(lastStderr()).toContain('地理编码失败');
  });

  test('DEBUG=true 等价 debug 级别', () => {
    setEnv('DEBUG', 'true');
    setEnv('LOG_LEVEL', undefined);
    expect(currentLevel()).toBe('debug');
    const logger = createLogger();
    logger.debug('调试细节');
    expect(lastStdout()).toContain('调试细节');
  });

  test('silent 关闭全部输出', () => {
    setEnv('LOG_LEVEL', 'silent');
    const logger = createLogger();
    logger.error('x');
    logger.warn('x');
    logger.info('x');
    logger.debug('x');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  test('非法级别回落到 info', () => {
    setEnv('LOG_LEVEL', 'verbose');
    expect(currentLevel()).toBe('info');
  });

  test('原型属性名不会被当成合法级别而静默关闭日志', () => {
    setEnv('LOG_LEVEL', 'constructor');
    expect(currentLevel()).toBe('info');
    const logger = createLogger();
    logger.error('必须输出');
    expect(lastStderr()).toContain('必须输出');
  });

  test('isLevelEnabled 对非法级别返回 false', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger();
    expect(logger.isLevelEnabled('info')).toBe(true);
    expect(logger.isLevelEnabled('bogus')).toBe(false);
  });

  test('Error 会打印 message 与 stack，而不是空对象', () => {
    setEnv('LOG_LEVEL', 'error');
    const logger = createLogger();
    logger.error('调用失败:', new Error('connect ECONNREFUSED'));
    const output = lastStderr();
    expect(output).toContain('connect ECONNREFUSED');
    expect(output).toContain('Error:');
    expect(output).not.toContain('{}');
  });

  test('嵌套在对象里的 Error 也会被展开', () => {
    setEnv('LOG_LEVEL', 'error');
    const logger = createLogger();
    logger.error('请求失败:', { err: new Error('nested boom') });
    const output = lastStderr();
    expect(output).toContain('nested boom');
    expect(output).not.toContain('"err":{}');
  });

  test('Date/Buffer/Map/Set 有可读输出', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger();
    logger.info('快照:', {
      at: new Date('2026-01-01T00:00:00.000Z'),
      raw: Buffer.from('hi'),
      counts: new Map([['a', 1]]),
      tags: new Set(['x'])
    });
    const output = lastStdout();
    expect(output).toContain('2026-01-01T00:00:00.000Z');
    expect(output).toContain('[Buffer 2B]');
    expect(output).toContain('"counts":{"a":1}');
    expect(output).toContain('"tags":["x"]');
  });

  test('敏感字段被脱敏', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger();
    logger.info('请求参数:', {
      address: '广州塔',
      api_key: 'amap-secret-value',
      accessTokens: 'abc',
      nested: { Authorization: 'Bearer abc' }
    });
    const output = lastStdout();
    expect(output).toContain('广州塔');
    expect(output).not.toContain('amap-secret-value');
    expect(output).not.toContain('Bearer abc');
    expect(output).toContain('***');
  });

  test('普通字段不被脱敏规则误伤', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger();
    logger.info('查询参数:', { keyword: '博物馆', monkey: 1, city: '广州' });
    const output = lastStdout();
    expect(output).toContain('博物馆');
    expect(output).toContain('"monkey":1');
  });

  test('深嵌套对象不会无限展开', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger();
    const deep = {
      level1: { level2: { level3: { level4: { level5: 'x' } } } }
    };
    logger.info('结构:', deep);
    expect(lastStdout()).toContain('[DeepObject]');
  });

  test('循环引用不会导致日志抛错', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger();
    const circular = { name: 'loop' };
    circular.self = circular;
    expect(() => logger.info('快照:', circular)).not.toThrow();
    expect(lastStdout()).toContain('快照:');
  });

  test('child 附加上下文到每条日志', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger().child({ requestId: 'req-1' });
    logger.info('收到请求');
    logger.error('处理失败');
    expect(lastStdout()).toContain('req-1');
    expect(lastStderr()).toContain('req-1');
  });

  test('child 传入空上下文不产生 undefined 前缀', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger().child(undefined);
    logger.info('收到请求');
    expect(lastStdout()).not.toContain('undefined');
  });

  test('超长日志被截断', () => {
    setEnv('LOG_LEVEL', 'info');
    const logger = createLogger();
    logger.info('x'.repeat(5000));
    const output = lastStdout();
    expect(output.length).toBeLessThan(2500);
    expect(output).toContain('truncated');
  });

  test('LEVELS 暴露全部级别', () => {
    expect(LEVELS).toEqual(['silent', 'error', 'warn', 'info', 'debug']);
  });
});
