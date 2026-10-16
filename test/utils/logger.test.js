const {
  createLogger,
  currentLevel,
  LEVELS
} = require('../../src/utils/logger');

describe('logger', () => {
  let stdoutSpy;
  let stderrSpy;
  let originalLevel;

  beforeEach(() => {
    originalLevel = process.env.LOG_LEVEL;
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (originalLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLevel;
    }
  });

  const lastStdout = () => stdoutSpy.mock.calls.join('\n');
  const lastStderr = () => stderrSpy.mock.calls.join('\n');

  test('默认级别为 info，屏蔽 debug 输出', () => {
    process.env.LOG_LEVEL = 'info';
    const logger = createLogger();
    logger.debug('调试细节');
    expect(stdoutSpy).not.toHaveBeenCalled();
    logger.info('普通信息');
    expect(lastStdout()).toContain('普通信息');
  });

  test('error 与 warn 在默认级别下依然输出', () => {
    process.env.LOG_LEVEL = 'info';
    const logger = createLogger();
    logger.error('失败原因');
    logger.warn('降级提示');
    expect(lastStderr()).toContain('失败原因');
    expect(lastStderr()).toContain('降级提示');
  });

  test('error 不受 DEBUG=false 影响（回归用例）', () => {
    process.env.LOG_LEVEL = '';
    const logger = createLogger();
    logger.error('地理编码失败');
    expect(lastStderr()).toContain('地理编码失败');
  });

  test('silent 关闭全部输出', () => {
    process.env.LOG_LEVEL = 'silent';
    const logger = createLogger();
    logger.error('x');
    logger.warn('x');
    logger.info('x');
    logger.debug('x');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  test('LOG_LEVEL=debug 时输出 debug', () => {
    process.env.LOG_LEVEL = 'debug';
    expect(currentLevel()).toBe('debug');
    const logger = createLogger();
    logger.debug('调试细节');
    expect(lastStdout()).toContain('调试细节');
  });

  test('非法级别回落到 info', () => {
    process.env.LOG_LEVEL = 'verbose';
    expect(currentLevel()).toBe('info');
  });

  test('Error 会打印 message 与 stack，而不是空对象', () => {
    process.env.LOG_LEVEL = 'error';
    const logger = createLogger();
    logger.error('调用失败:', new Error('connect ECONNREFUSED'));
    const output = lastStderr();
    expect(output).toContain('connect ECONNREFUSED');
    expect(output).toContain('Error:');
    expect(output).not.toContain('{}');
  });

  test('敏感字段被脱敏', () => {
    process.env.LOG_LEVEL = 'info';
    const logger = createLogger();
    logger.info('请求参数:', {
      address: '广州塔',
      api_key: 'amap-secret-value',
      nested: { Authorization: 'Bearer abc' }
    });
    const output = lastStdout();
    expect(output).toContain('广州塔');
    expect(output).not.toContain('amap-secret-value');
    expect(output).not.toContain('Bearer abc');
    expect(output).toContain('***');
  });

  test('循环引用不会导致日志抛错', () => {
    process.env.LOG_LEVEL = 'info';
    const logger = createLogger();
    const circular = { name: 'loop' };
    circular.self = circular;
    expect(() => logger.info('快照:', circular)).not.toThrow();
    expect(lastStdout()).toContain('快照:');
  });

  test('child 附加上下文到每条日志', () => {
    process.env.LOG_LEVEL = 'info';
    const logger = createLogger().child({ requestId: 'req-1' });
    logger.info('收到请求');
    logger.error('处理失败');
    expect(lastStdout()).toContain('req-1');
    expect(lastStderr()).toContain('req-1');
  });

  test('超长日志被截断', () => {
    process.env.LOG_LEVEL = 'info';
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
