


const MCP = require('../../src/services/mcp');

const OK_RESPONSE = JSON.stringify({
  status: '1',
  geocodes: [{ location: '113.1,23.2', adcode: '440111' }],
});

describe('MCP.geocode 请求治理', () => {
  let mcp;

  beforeEach(() => {
    mcp = new MCP('test-key');
    mcp.geocodeCache.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should cap address variations', () => {
    const list = mcp.generateAddressVariations('广州白云山风景名胜区');
    expect(list.length).toBeLessThanOrEqual(8);
  });

  it('should not mangle place names', () => {
    const list = mcp.generateAddressVariations('白云山');
    expect(list[0]).toBe('白云山');
    expect(list).not.toContain('白山');
  });

  it('should cache geocode result', async () => {
    const spy = jest.spyOn(mcp, 'httpGet').mockResolvedValue(OK_RESPONSE);

    const first = await mcp.geocode('广州白云山');
    const second = await mcp.geocode('广州白云山');

    expect(first).toEqual({
      longitude: 113.1,
      latitude: 23.2,
      adcode: '440111',
    });
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should stop at first successful variant', async () => {
    const spy = jest.spyOn(mcp, 'httpGet').mockResolvedValue(OK_RESPONSE);
    const variants = mcp.generateAddressVariations('广州白云山风景名胜区');

    await mcp.geocode('广州白云山风景名胜区');

    expect(variants.length).toBeLessThanOrEqual(3);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should bound requests when every variant fails', async () => {
    const spy = jest
      .spyOn(mcp, 'httpGet')
      .mockResolvedValue(JSON.stringify({ status: '0', geocodes: [] }));
    const fallbackSpy = jest
      .spyOn(mcp, 'geocodeByCity')
      .mockResolvedValue(null);

    await mcp.geocode('广州白云山风景名胜区');

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
  });
});
