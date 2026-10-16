const https = require('https');
const debug = require('../utils/debug');
const {
  getLlmApiKey,
  getLlmModel,
  LLM_BASE_URL,
  COMMON_CITIES,
  EXCLUDED_STREET_NAMES,
  SCORE_WEIGHTS,
  ROUTE_FILTER_THRESHOLDS,
  getScoreWeights,
  getRouteFilterThresholds,
  getSystemPrompt,
  getWeatherAdvicePrompt,
} = require('../config/config');
const { sanitizeUserInput } = require('../utils/inputGuard');

// LLM 请求超时（毫秒），可通过环境变量调整
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 15000;
// 系统提示词长度上限：原值 2000 会把输出格式规则与 Few-shot 直接切掉，
// 导致模型返回不可解析的内容
const MAX_SYSTEM_PROMPT_LENGTH = 20000;

// 缓存命中时返回深拷贝：调用方会就地改写返回对象（如补 _originalMessage），
// 直接返回缓存对象会污染后续所有命中
function cloneCachedValue(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

class LLMService {
  constructor(apiKey) {
    this.apiKey = apiKey || getLlmApiKey();
    this.baseUrl = LLM_BASE_URL;
    this.cache = new Map(); // 请求缓存
    this.cacheSize = 100; // 缓存大小限制
  }

  // 调用LLM API
  async callLLM(systemPrompt, userInput, parseJson = true, session = null) {
    // 生成上下文感知的缓存 key
    const crypto = require('crypto');

    // 收集会话上下文信息
    let contextFingerprint = '';
    if (session) {
      const lastOrigin = session.getLastOrigin() || '';
      const lastDestination = session.getLastDestination() || '';
      const lastSearched = session.getLastSearchedLocation() || '';
      const lastMentioned = session.getLastMentionedLocation() || '';
      contextFingerprint = `${lastOrigin}|${lastDestination}|${lastSearched}|${lastMentioned}`;
    }

    // 用户输入在进入提示词/缓存 key 之前先清洗，避免 forged 输入击穿提示词结构
    const safeUserInput = sanitizeUserInput(userInput);

    const sessionId = session?.sessionId || 'default';
    // 缓存 key 必须用原始输入：sanitizeUserInput 会截断到 500 字，
    // 用清洗后的取值会让“前 500 字相同、尾部不同”的请求共用同一份缓存
    const cacheInput = `${String(userInput ?? '')}|${contextFingerprint}|${sessionId}`;
    const inputHash = crypto.createHash('md5').update(cacheInput).digest('hex');
    // 缓存 key 必须包含提示词与模型指纹：否则不同技能/不同模型会串用同一份缓存
    const promptHash = crypto
      .createHash('md5')
      .update(`${systemPrompt}|${getLlmModel()}`)
      .digest('hex');
    const cacheKey = `${inputHash}_${promptHash}_${parseJson ? 'json' : 'text'}`;

    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // 检查是否过期
      if (cached.expiresAt && cached.expiresAt > Date.now()) {
        console.log('LLM API请求命中缓存 (上下文相关)');
        return cloneCachedValue(cached.data);
      } else {
        // 缓存已过期，删除
        this.cache.delete(cacheKey);
      }
    }

    // 2. 优化提示词（限制长度，但保留完整规则段）
    const optimizedSystemPrompt = systemPrompt.substring(
      0,
      MAX_SYSTEM_PROMPT_LENGTH
    );

    const maxRetries = 1; // 减少重试次数
    const timeoutMs = LLM_TIMEOUT_MS; // 默认15秒超时
    const retryDelayMs = 500; // 0.5秒重试间隔

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        console.log(`LLM API请求重试 ${attempt}/${maxRetries}...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }

      try {
        const result = await new Promise((resolve, reject) => {
          // 设置超时
          const timeout = setTimeout(() => {
            console.error('LLM API请求超时');
            // 必须真正销毁底层 socket：否则连接会一直挂到响应结束（甚至永不关闭），
            // 重试时又会新建连接，最终累积成 socket 句柄泄漏
            try {
              if (req && !req.destroyed) {
                req.destroy();
              }
            } catch (destroyError) {
              debug.log('销毁超时请求失败:', destroyError.message);
            }
            resolve(null);
          }, timeoutMs);

          const data = JSON.stringify({
            model: getLlmModel(),
            messages: [
              { role: 'system', content: optimizedSystemPrompt },
              { role: 'user', content: safeUserInput },
            ],
            temperature: 0.1,
          });

          const url = new URL(`${this.baseUrl}/chat/completions`);
          const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Length': Buffer.byteLength(data),
            },
          };

          const req = https.request(options, (res) => {
            clearTimeout(timeout); // 清除超时
            let responseData = '';
            res.on('data', (chunk) => {
              responseData += chunk;
            });
            res.on('end', () => {
              try {
                const result = JSON.parse(responseData);
                if (result.error) {
                  console.error('LLM API错误:', result.error);
                  resolve(null);
                  return;
                }
                if (
                  !result.choices ||
                  !result.choices[0] ||
                  !result.choices[0].message
                ) {
                  console.error('LLM响应格式错误，缺少choices字段:', result);
                  resolve(null);
                  return;
                }
                const content = result.choices[0].message.content;
                if (!content || content.trim() === '') {
                  console.error('LLM响应内容为空');
                  resolve(null);
                  return;
                }
                debug.log('LLM响应内容:', content);
                if (parseJson) {
                  try {
                    let jsonStr = content;
                    if (content.includes('```json')) {
                      jsonStr = content.split('```json')[1].split('```')[0];
                    } else if (content.includes('```')) {
                      jsonStr = content.split('```')[1].split('```')[0];
                    }
                    const parsed = JSON.parse(jsonStr.trim());
                    resolve(parsed);
                  } catch (parseError) {
                    console.error('JSON解析失败:', parseError);
                    const jsonMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                      try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        resolve(parsed);
                      } catch (e) {
                        resolve(null);
                      }
                    } else {
                      resolve(null);
                    }
                  }
                } else {
                  resolve(content);
                }
              } catch (error) {
                console.error('LLM响应处理失败:', error);
                resolve(null);
              }
            });
          });

          req.on('error', (error) => {
            clearTimeout(timeout); // 清除超时
            console.error('LLM API请求失败:', error);
            resolve(null);
          });

          req.write(data);
          req.end();
        });

        if (result !== null) {
          // 3. 更新缓存
          if (this.cache.size >= this.cacheSize) {
            // 移除最旧的缓存
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
          }

          // 判断是否是天气查询
          const isWeatherQuery = /天气|气温|温度/.test(safeUserInput);
          const ttl = isWeatherQuery ? 60000 : 3600000; // 天气查询缓存1分钟，其他1小时

          // 存储时带上时间戳
          this.cache.set(cacheKey, {
            data: result,
            expiresAt: Date.now() + ttl,
          });

          return result;
        }
      } catch (error) {
        console.error('LLM API请求异常:', error);
      }
    }

    // 所有重试都失败
    console.error('LLM API请求最终失败，返回null');
    return null;
  }

  // 路线规划已统一由 src/skills/RouteSkill.js 负责，这里只保留兜底问答能力
  async reactLoop(userInput, tools) {
    try {
      const systemPrompt = getSystemPrompt();

      const llmResult = await this.callLLM(systemPrompt, userInput);

      if (llmResult) {
        // 处理TRIP_PLANNING意图
        if (llmResult.intent === 'TRIP_PLANNING') {
          debug.log('识别到复杂行程规划意图');
          debug.log('提取的信息:', {
            origin: llmResult.origin,
            destination: llmResult.destination,
            time: llmResult.time,
            poi_search: llmResult.poi_search,
          });

          // 由于 TripPlanner 已删除，直接返回基本信息
          return {
            thought: '识别到复杂行程规划意图',
            answer: `您的行程规划需求已收到：从${llmResult.origin}到${llmResult.destination}，时间：${llmResult.time || '未指定'}。\n\n请提供更多具体信息，我将为您生成详细的行程方案。`,
          };
        }

        // 处理普通路线规划意图
        if (
          llmResult.has_route_intent &&
          llmResult.origin &&
          llmResult.destination &&
          !llmResult.origin.includes('__') &&
          !llmResult.destination.includes('__')
        ) {
          debug.log(
            '识别到路线规划意图，提取的起点:',
            llmResult.origin,
            '终点:',
            llmResult.destination
          );

          if (tools.geocode) {
            try {
              const originGeo = await tools.geocode(llmResult.origin);
              debug.log('起点地理编码结果:', originGeo);

              const destGeo = await tools.geocode(llmResult.destination);
              debug.log('终点地理编码结果:', destGeo);

              if (originGeo && destGeo) {
                let schemes = [];

                if (tools.get_directions) {
                  debug.log('调用get_directions工具');
                  const directions = await tools.get_directions(
                    llmResult.origin,
                    llmResult.destination,
                    originGeo,
                    destGeo
                  );
                  debug.log('获取到的出行方案:', directions);
                  if (directions && directions.length > 0) {
                    schemes = directions;
                  }
                }

                debug.log('添加骑行和步行方案');

                if (tools.route_bicycling) {
                  try {
                    const bicyclingRoute = await tools.route_bicycling(
                      originGeo,
                      destGeo
                    );
                    debug.log('骑行路线结果:', bicyclingRoute);
                    if (bicyclingRoute) {
                      schemes.push({
                        type: '骑行',
                        duration: bicyclingRoute.duration,
                        distance: bicyclingRoute.distance,
                        cost: bicyclingRoute.cost,
                      });
                    }
                  } catch (error) {
                    console.error('骑行路线工具调用失败:', error);
                  }
                }

                if (tools.route_walking) {
                  try {
                    const walkingRoute = await tools.route_walking(
                      originGeo,
                      destGeo
                    );
                    debug.log('步行路线结果:', walkingRoute);
                    if (walkingRoute) {
                      schemes.push({
                        type: '步行',
                        duration: walkingRoute.duration,
                        distance: walkingRoute.distance,
                        cost: walkingRoute.cost,
                      });
                    }
                  } catch (error) {
                    console.error('步行路线工具调用失败:', error);
                  }
                }

                const bicyclingScheme = schemes.find((s) => s.type === '骑行');
                const walkingScheme = schemes.find((s) => s.type === '步行');
                if (bicyclingScheme && walkingScheme) {
                  let bicyclingDistance = 0;
                  let walkingDistance = 0;

                  if (
                    typeof bicyclingScheme.distance === 'number' ||
                    !isNaN(bicyclingScheme.distance)
                  ) {
                    bicyclingDistance = parseInt(bicyclingScheme.distance);
                  } else {
                    const match = bicyclingScheme.distance.match(/(\d+)米/);
                    if (match) {
                      bicyclingDistance = parseInt(match[1]);
                    }
                  }

                  if (
                    typeof walkingScheme.distance === 'number' ||
                    !isNaN(walkingScheme.distance)
                  ) {
                    walkingDistance = parseInt(walkingScheme.distance);
                  } else {
                    const match = walkingScheme.distance.match(/(\d+)米/);
                    if (match) {
                      walkingDistance = parseInt(match[1]);
                    }
                  }

                  debug.log('骑行距离:', bicyclingDistance, '米');
                  debug.log('步行距离:', walkingDistance, '米');
                }

                debug.log('按距离过滤出行方案');
                const filteredSchemes = [];
                const rejectedSchemes = [];

                const avgDistance =
                  schemes.reduce((sum, scheme) => {
                    let distance = 0;
                    if (
                      typeof scheme.distance === 'number' ||
                      !isNaN(scheme.distance)
                    ) {
                      distance = parseInt(scheme.distance);
                    } else {
                      const match = scheme.distance.match(/(\d+)米/);
                      if (match) {
                        distance = parseInt(match[1]);
                      } else if (scheme.distance.match(/(\d+(\.\d+)?)公里/)) {
                        distance =
                          parseFloat(
                            scheme.distance.match(/(\d+(\.\d+)?)公里/)[1]
                          ) * 1000;
                      }
                    }
                    return sum + distance;
                  }, 0) /
                  (schemes.length || 1) /
                  1000;

                debug.log('平均距离:', avgDistance, '公里');

                const originCity = this.extractCityName(llmResult.origin);
                const destinationCity = this.extractCityName(
                  llmResult.destination
                );
                const isSameCity = originCity === destinationCity;
                debug.log(
                  '判断是否为同城:',
                  isSameCity,
                  '出发城市:',
                  originCity,
                  '目的城市:',
                  destinationCity
                );

                schemes.forEach((scheme) => {
                  let distanceKm = 0;
                  if (
                    typeof scheme.distance === 'number' ||
                    !isNaN(scheme.distance)
                  ) {
                    distanceKm = parseInt(scheme.distance) / 1000;
                  } else {
                    const distanceMatch =
                      scheme.distance.match(/(\d+(\.\d+)?)公里/);
                    if (distanceMatch) {
                      distanceKm = parseFloat(distanceMatch[1]);
                    } else if (scheme.distance.match(/(\d+)米/)) {
                      distanceKm =
                        parseFloat(scheme.distance.match(/(\d+)米/)[1]) / 1000;
                    }
                  }

                  debug.log('方案:', scheme.type, '距离:', distanceKm, '公里');

                  const thresholds = getRouteFilterThresholds();

                  if (scheme.type === '步行') {
                    if (distanceKm > thresholds.WALKING_MAX_KM) {
                      rejectedSchemes.push({
                        ...scheme,
                        reason: '距离较远，不建议步行',
                      });
                    } else if (
                      distanceKm >= thresholds.WALKING_WARN_KM &&
                      distanceKm <= thresholds.WALKING_MAX_KM
                    ) {
                      filteredSchemes.push({
                        ...scheme,
                        notRecommended: true,
                        reason: '距离较远，不建议步行',
                      });
                    } else {
                      filteredSchemes.push(scheme);
                    }
                  } else if (scheme.type === '骑行') {
                    if (distanceKm > thresholds.BICYCLING_MAX_KM) {
                      rejectedSchemes.push({
                        ...scheme,
                        reason: '距离较远，不建议骑行',
                      });
                    } else {
                      filteredSchemes.push(scheme);
                    }
                  } else if (
                    scheme.type === '公交' ||
                    scheme.type === '公共交通'
                  ) {
                    if (!isSameCity && distanceKm > thresholds.TRANSIT_MAX_KM) {
                      rejectedSchemes.push({
                        ...scheme,
                        reason: '距离较远，建议选择高铁或飞机',
                      });
                    } else {
                      filteredSchemes.push(scheme);
                    }
                  } else if (scheme.type === '驾车') {
                    filteredSchemes.push(scheme);
                  } else if (scheme.type === '高铁' || scheme.type === '飞机') {
                    filteredSchemes.push(scheme);
                  } else {
                    filteredSchemes.push(scheme);
                  }
                });

                const optimalSchemeIndex =
                  this.calculateOptimalRoute(filteredSchemes);

                let answer = `从${llmResult.origin}到${llmResult.destination}的出行方案：\n`;

                filteredSchemes.forEach((scheme, index) => {
                  let formattedDistance;
                  if (
                    typeof scheme.distance === 'number' ||
                    !isNaN(scheme.distance)
                  ) {
                    const distanceNum = parseInt(scheme.distance);
                    if (distanceNum >= 1000) {
                      formattedDistance = `${(distanceNum / 1000).toFixed(1)}公里`;
                    } else {
                      formattedDistance = `${distanceNum}米`;
                    }
                  } else {
                    formattedDistance = scheme.distance;
                  }

                  const isOptimal = index === optimalSchemeIndex;

                  if (isOptimal) {
                    const optimalReason = this.getOptimalReason(
                      scheme,
                      filteredSchemes
                    );
                    answer += `${index + 1}. ${scheme.type} [推荐]\n`;
                    if (scheme.reason) {
                      answer += `   推荐理由: ${scheme.reason}\n`;
                    } else if (optimalReason) {
                      answer += `   推荐理由: ${optimalReason}\n`;
                    }
                  } else {
                    answer += `${index + 1}. ${scheme.type}`;
                    if (scheme.notRecommended) {
                      answer += ' [不推荐]';
                    }
                    answer += '\n';
                  }

                  answer += `   预计时间: ${scheme.duration}\n`;
                  answer += `   预计费用: ${scheme.cost}\n`;
                  answer += `   距离: ${formattedDistance}\n`;

                  // 显示分段时间详情
                  if (scheme.walkingTime || scheme.ridingTime) {
                    const timeDetails = [];
                    if (scheme.walkingTime > 0) {
                      timeDetails.push(`步行${scheme.walkingTime}分钟`);
                    }
                    if (scheme.ridingTime > 0) {
                      timeDetails.push(`乘车${scheme.ridingTime}分钟`);
                    }
                    if (timeDetails.length > 0) {
                      answer += `   时间构成: ${timeDetails.join(' + ')}\n`;
                    }
                  }

                  // 显示地铁线路详情
                  if (scheme.metroLines && scheme.metroLines.length > 0) {
                    answer += `   途经地铁: ${scheme.metroLines.join('、')}\n`;
                  }

                  if (scheme.transfers && scheme.transfers.length > 0) {
                    answer += `   详细换乘: ${scheme.transfers.join(' -> ')}\n`;
                  }

                  // 显示推荐理由
                  if (scheme.isRecommended && scheme.recommendedReason) {
                    answer += `   推荐理由: ${scheme.recommendedReason}\n`;
                  }
                });

                if (rejectedSchemes.length > 0) {
                  answer += '\n不推荐的方案：\n';
                  rejectedSchemes.forEach((scheme, index) => {
                    let formattedDistance;
                    if (
                      typeof scheme.distance === 'number' ||
                      !isNaN(scheme.distance)
                    ) {
                      const distanceNum = parseInt(scheme.distance);
                      if (distanceNum >= 1000) {
                        formattedDistance = `${(distanceNum / 1000).toFixed(1)}公里`;
                      } else {
                        formattedDistance = `${distanceNum}米`;
                      }
                    } else {
                      formattedDistance = scheme.distance;
                    }

                    answer += `${index + 1}. ${scheme.type} [不推荐]\n`;
                    answer += `   预计时间: ${scheme.duration}\n`;
                    answer += `   预计费用: ${scheme.cost}\n`;
                    answer += `   距离: ${formattedDistance}\n`;
                    if (scheme.reason) {
                      answer += `   不推荐原因: ${scheme.reason}\n`;
                    }
                  });
                }

                // 获取天气信息
                let originWeather = null;
                let destinationWeather = null;
                let weatherAdvice = [];
                try {
                  if (tools.weather) {
                    originWeather = await tools.weather(llmResult.origin);
                    destinationWeather = await tools.weather(
                      llmResult.destination
                    );
                    if (tools.travel_advice) {
                      weatherAdvice = await tools.travel_advice(
                        llmResult.origin,
                        '出发地'
                      );
                    }
                  }
                } catch (error) {
                  console.error('获取天气信息失败:', error);
                }

                // 构建带天气信息的返回结果
                return {
                  thought: '已获取多种出行方案和信息足够生成回答',
                  answer: answer,
                  metadata: {
                    weather: {
                      origin: originWeather ? originWeather.weather : null,
                      destination: destinationWeather
                        ? destinationWeather.weather
                        : null,
                      airQuality: {
                        origin: originWeather ? originWeather.airQuality : null,
                        destination: destinationWeather
                          ? destinationWeather.airQuality
                          : null,
                      },
                    },
                    advice: weatherAdvice,
                  },
                };
              } else {
                return {
                  thought: '地理编码失败',
                  answer: '无法获取起点或终点的位置信息，请检查地址是否正确',
                };
              }
            } catch (error) {
              console.error('地理编码过程出错:', error);
              return {
                thought: '地理编码出错',
                answer: '处理地理位置时发生错误，请稍后重试',
              };
            }
          } else {
            return {
              thought: '地理编码工具不可用',
              answer: '系统暂时无法处理地理编码请求',
            };
          }
        } else {
          return {
            thought: '不是路线规划意图',
            answer:
              '抱歉，我没有理解您的需求。您可以告诉我出发地和目的地，我来帮您规划路线。',
          };
        }
      } else {
        return {
          thought: 'LLM返回格式错误',
          answer: '无法理解您的输入，请尝试重新描述您的出行需求。',
        };
      }
    } catch (error) {
      console.error('ReAct循环执行失败:', error);
      return {
        error: '处理请求时发生错误，请稍后重试',
      };
    }
  }

  calculateOptimalRoute(schemes) {
    if (schemes.length === 0) {
      return -1;
    }

    let bestScore = -Infinity;
    let bestIndex = 0;

    schemes.forEach((scheme, index) => {
      const durationMatch = scheme.duration.match(/(\d+)分钟/);
      const duration = durationMatch ? parseInt(durationMatch[1]) : 0;

      const costMatch = scheme.cost.match(/¥(\d+)/);
      const cost = costMatch ? parseInt(costMatch[1]) : 0;

      let distance = 0;
      if (typeof scheme.distance === 'number') {
        distance = scheme.distance;
      } else {
        const distanceMatch = scheme.distance.match(/(\d+)米/);
        if (distanceMatch) {
          distance = parseInt(distanceMatch[1]);
        }
      }

      const timeScore = duration > 0 ? 1000 / duration : 0;
      const costScore = cost > 0 ? 100 / cost : 100;
      const distanceScore = distance > 0 ? 1000000 / distance : 0;

      const weights = getScoreWeights();
      const score =
        timeScore * weights.TIME +
        costScore * weights.COST +
        distanceScore * weights.DISTANCE;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  getOptimalReason(optimalScheme, allSchemes) {
    if (!optimalScheme) {
      return '';
    }

    const optimalDurationMatch = optimalScheme.duration.match(/(\d+)分钟/);
    const optimalDuration = optimalDurationMatch
      ? parseInt(optimalDurationMatch[1])
      : 0;

    const optimalCostMatch = optimalScheme.cost.match(/¥(\d+)/);
    const optimalCost = optimalCostMatch ? parseInt(optimalCostMatch[1]) : 0;

    const optimalDistance =
      typeof optimalScheme.distance === 'number'
        ? optimalScheme.distance
        : parseInt(optimalScheme.distance.match(/(\d+)米/)?.[1] || 0);

    let totalDuration = 0;
    let totalCost = 0;
    let totalDistance = 0;
    let count = 0;

    allSchemes.forEach((scheme) => {
      if (scheme !== optimalScheme) {
        const durationMatch = scheme.duration.match(/(\d+)分钟/);
        const duration = durationMatch ? parseInt(durationMatch[1]) : 0;

        const costMatch = scheme.cost.match(/¥(\d+)/);
        const cost = costMatch ? parseInt(costMatch[1]) : 0;

        const distance =
          typeof scheme.distance === 'number'
            ? scheme.distance
            : parseInt(scheme.distance.match(/(\d+)米/)?.[1] || 0);

        totalDuration += duration;
        totalCost += cost;
        totalDistance += distance;
        count++;
      }
    });

    const avgDuration = count > 0 ? totalDuration / count : 0;
    const avgCost = count > 0 ? totalCost / count : 0;
    const avgDistance = count > 0 ? totalDistance / count : 0;

    const reasons = [];

    if (avgDuration > 0 && optimalDuration < avgDuration * 0.9) {
      const timeSaved = Math.round(avgDuration - optimalDuration);
      reasons.push(`时间更短，节省${timeSaved}分钟`);
    }

    if (avgCost > 0 && optimalCost < avgCost * 0.9) {
      const costSaved = Math.round(avgCost - optimalCost);
      reasons.push(`成本更低，节省¥${costSaved}`);
    }

    if (avgDistance > 0 && optimalDistance < avgDistance * 0.9) {
      const distanceSaved = Math.round((avgDistance - optimalDistance) / 1000);
      reasons.push(`距离更短，节省${distanceSaved}km`);
    }

    if (reasons.length === 0) {
      reasons.push('综合考虑最佳选择');
    }

    return reasons.join('，');
  }

  extractCityName(address) {
    for (const city of COMMON_CITIES) {
      if (address.includes(city)) {
        const isStreetName = EXCLUDED_STREET_NAMES.some(
          (street) => street.includes(city) && address.includes(street)
        );
        if (!isStreetName) {
          return city;
        }
      }
    }

    if (address.includes('大学')) {
      return '广州';
    }

    const districtMatch = address.match(/广州市(\w+区|\w+街道|\w+镇|\w+乡)/);
    if (districtMatch) {
      return '广州';
    }

    return address;
  }

  // 本地ReAct实现（降级方案）
  // 路线规划已统一由 src/skills/RouteSkill.js 负责，这里只保留兜底问答能力
  async localReact(userInput, tools) {
    // 处理编码问题，确保中文文本能够被正确处理
    const input = String(userInput);
    debug.log('本地意图识别处理:', input);

    // 清理输入，移除常见尾缀
    const cleanInput = input
      .replace(/\s*怎么走\s*$/, '')
      .replace(/\s*如何走\s*$/, '')
      .replace(/\s*怎么去\s*$/, '')
      .replace(/\s*如何去\s*$/, '')
      .replace(/\s*路线\s*$/, '')
      .replace(/\s*怎么\s*$/, '')
      .replace(/\s*如何\s*$/, '');

    // 1. 路线规划意图 - 更健壮的正则表达式
    const routePatterns = [
      /从\s*(.+?)\s*到\s*(.+?)\s*$/,
      /(.+?)\s*到\s*(.+?)\s*$/,
      /从\s*(.+?)\s*去\s*(.+?)\s*$/,
      /(.+?)\s*去\s*(.+?)\s*$/,
      /去\s*(.+?)\s*从\s*(.+?)\s*$/,
      /从\s*(.+?)\s*出发.*?去\s*(.+?)\s*$/,
      /(.+?)\s*->\s*(.+?)\s*$/,
      /(.+?)\s*->\s*(.+?)$/,
    ];

    for (const pattern of routePatterns) {
      const match = cleanInput.match(pattern);
      if (match) {
        let origin, destination;
        if (match[1] && match[2]) {
          origin = match[1].replace(/^[从\s]+/, '').replace(/\s+$/, '');
          destination = match[2].replace(/^[从\s]+/, '').replace(/\s+$/, '');
          debug.log(
            '识别到路线规划意图，提取的起点:',
            origin,
            '终点:',
            destination
          );

          if (tools.geocode) {
            try {
              const originGeo = await tools.geocode(origin);
              const destGeo = await tools.geocode(destination);

              if (originGeo && destGeo) {
                let schemes = [];

                // 调用get_directions工具获取所有方案
                if (tools.get_directions) {
                  const directions = await tools.get_directions(
                    origin,
                    destination
                  );
                  if (directions && directions.length > 0) {
                    schemes = directions;
                  }
                }

                // 添加骑行和步行方案
                if (tools.route_bicycling) {
                  const bicyclingRoute = await tools.route_bicycling(
                    originGeo,
                    destGeo
                  );
                  if (bicyclingRoute) {
                    schemes.push({
                      type: '骑行',
                      duration: bicyclingRoute.duration,
                      distance: bicyclingRoute.distance,
                      cost: bicyclingRoute.cost,
                    });
                  }
                }

                if (tools.route_walking) {
                  const walkingRoute = await tools.route_walking(
                    originGeo,
                    destGeo
                  );
                  if (walkingRoute) {
                    schemes.push({
                      type: '步行',
                      duration: walkingRoute.duration,
                      distance: walkingRoute.distance,
                      cost: walkingRoute.cost,
                    });
                  }
                }

                // 构建回答
                let answer = `从${origin}到${destination}的出行方案：\n`;
                schemes.forEach((scheme, index) => {
                  answer += `${index + 1}. ${scheme.type}: ${scheme.duration}, ${scheme.cost}, ${scheme.distance}\n`;
                });

                // 获取天气信息
                let originWeather = null;
                let destinationWeather = null;
                let weatherAdvice = [];
                try {
                  if (tools.weather) {
                    originWeather = await tools.weather(origin);
                    destinationWeather = await tools.weather(destination);
                    if (tools.travel_advice) {
                      weatherAdvice = await tools.travel_advice(
                        origin,
                        '出发地'
                      );
                    }
                  }
                } catch (error) {
                  console.error('获取天气信息失败:', error);
                }

                return {
                  handled: true,
                  thought: '已获取多种出行方案和信息足够生成回答',
                  answer: answer,
                  metadata: {
                    weather: {
                      origin: originWeather ? originWeather.weather : null,
                      destination: destinationWeather
                        ? destinationWeather.weather
                        : null,
                      airQuality: {
                        origin: originWeather ? originWeather.airQuality : null,
                        destination: destinationWeather
                          ? destinationWeather.airQuality
                          : null,
                      },
                    },
                    advice: weatherAdvice,
                  },
                  lastMentionedLocation: destination,
                  lastOrigin: origin,
                  lastDestination: destination,
                };
              }
            } catch (error) {
              console.error('本地路线规划失败:', error);
            }
          }

          return {
            handled: true,
            thought: '无法获取地理位置信息',
            answer: '抱歉，无法获取您提供地址的位置信息，请检查地址是否正确。',
            lastMentionedLocation: null,
          };
        }
      }
    }

    // 2. POI搜索意图
    const poiPatterns = [
      /(.+)附近有什么(.*)/,
      /(.+)周边有什么(.*)/,
      /(.+)附近推荐(.*)/,
      /(.+)周边推荐(.*)/,
      /(.+)附近的(.*)/,
      /(.+)周边的(.*)/,
    ];

    for (const pattern of poiPatterns) {
      const match = cleanInput.match(pattern);
      if (match) {
        const center = match[1].trim();
        let keywords = match[2].trim();

        // 清洗关键词
        keywords = keywords.replace(/[吗呢啊呀吧！？；：，。]/g, '').trim();

        // 提取关键词
        if (!keywords) {
          const poiTypes = [
            '景点',
            '餐厅',
            '酒店',
            '咖啡馆',
            '停车场',
            '商场',
            '银行',
            '便利店',
            '美食',
            '好吃的',
            '吃饭的地方',
            '餐馆',
          ];
          for (const type of poiTypes) {
            if (cleanInput.includes(type)) {
              keywords = type;
              break;
            }
          }
        }

        // 同义词映射
        const synonymMap = {
          美食: '餐厅',
          好吃的: '餐厅',
          吃饭的地方: '餐厅',
          餐馆: '餐厅',
        };
        if (synonymMap[keywords]) {
          keywords = synonymMap[keywords];
        }

        if (tools.geocode && tools.search_nearby) {
          try {
            const centerGeo = await tools.geocode(center);
            if (centerGeo) {
              const pois = await tools.search_nearby(
                centerGeo,
                keywords || '地点',
                500,
                5
              );

              let answer = `在${center}附近找到以下${keywords || '地点'}：\n\n`;
              if (pois.length === 0) {
                answer = `抱歉，在${center}附近未找到${keywords || '地点'}。`;
              } else {
                pois.forEach((poi, index) => {
                  answer += `${index + 1}. ${poi.name}（距离${poi.distance}米）\n`;
                  if (poi.address) {
                    answer += `   地址：${poi.address}\n`;
                  }
                  if (poi.tel) {
                    answer += `   电话：${poi.tel}\n`;
                  }
                  answer += `   类型：${poi.type}\n\n`;
                });
              }

              return {
                handled: true,
                thought: 'POI搜索完成',
                answer: answer,
                lastMentionedLocation: center,
              };
            }
          } catch (error) {
            console.error('POI搜索失败:', error);
          }
        }

        return {
          handled: true,
          thought: '无法获取地理位置信息',
          answer: '抱歉，无法获取您提供地址的位置信息，请检查地址是否正确。',
          lastMentionedLocation: null,
        };
      }
    }

    // 3. 地点查询意图
    const locationQueryPatterns = [
      /(.+)在哪里/,
      /(.+)的位置/,
      /(.+)在什么地方/,
      /(.+)位置/,
      /(.+)地址/,
      /(.+)在哪里啊/,
      /(.+)在哪个位置/,
      /(.+)在什么位置/,
    ];

    for (const pattern of locationQueryPatterns) {
      const match = cleanInput.match(pattern);
      if (match) {
        const location = match[1].trim();

        if (tools.geocode) {
          try {
            const geo = await tools.geocode(location);
            if (geo) {
              return {
                handled: true,
                thought: '地点查询完成',
                answer: `${location}的位置已找到，坐标：(${geo.longitude}, ${geo.latitude})`,
                lastMentionedLocation: location,
              };
            }
          } catch (error) {
            console.error('地点查询失败:', error);
          }
        }

        return {
          handled: true,
          thought: '无法获取地理位置信息',
          answer: '抱歉，无法获取该地点的位置信息，请检查地点名称是否正确。',
          lastMentionedLocation: null,
        };
      }
    }

    // 4. 其他无法识别的情况
    return {
      handled: false,
      thought: '无法识别意图',
      answer: null,
      lastMentionedLocation: null,
    };
  }

  async sendTravelAdviceLLM(weatherAdviceRequest) {
    const systemPrompt = `你是一个旅行助手，根据天气信息和路线信息生成出行建议。

请根据以下信息生成出行建议：
1. 根据温度给出穿衣建议
2. 根据天气现象给出装备建议（如是否需要带伞、墨镜等）
3. 根据空气质量给出健康建议（如是否需要戴口罩）
4. 根据湿度给出舒适度建议
5. 根据路线特点给出出行注意事项

请用简洁的语言给出3-4条建议。`;

    try {
      const result = await this.callLLM(
        systemPrompt,
        weatherAdviceRequest,
        false
      );
      return result;
    } catch (error) {
      console.error('发送出行建议LLM请求失败:', error);
      return null;
    }
  }
}

module.exports = LLMService;
