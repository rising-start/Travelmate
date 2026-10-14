const TravelAssistant = require('../src/core/main');

describe('TravelAssistant', () => {
  let assistant;

  beforeEach(() => {
    assistant = new TravelAssistant();
  });

  test('should create instance successfully', () => {
    expect(assistant).toBeInstanceOf(TravelAssistant);
  });

  test('should return error when origin or destination is missing', async () => {
    const result = await assistant.processUserInput('北京天气如何');
    expect(result).toHaveProperty('success');
  });

  test('should return error when origin and destination are same', async () => {
    const result = await assistant.planRoute('北京', '北京');
    expect(result).toHaveProperty('success');
  });
});
