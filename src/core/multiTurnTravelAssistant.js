const LLMService = require('../services/llm');
const MCPService = require('../services/mcp');
const Weather = require('../services/weather');
const {
  SessionManager,
  DIALOG_STATES,
  INTENT_TYPES,
} = require('../session/conversationSession');
const {
  determineNextState,
  buildContextAwarePrompt,
} = require('../session/dialogManager');
const SkillManager = require('../skills/SkillManager');

/**
 * MultiTurnTravelAssistant - 多轮旅行助手核心类
 * 处理用户输入，协调各个技能模块，提供智能旅行相关服务
 */
class MultiTurnTravelAssistant {
  /**
   * 构造函数
   */
  constructor() {
    this.llm = new LLMService();
    this.mcp = new MCPService();
    this.weather = new Weather();
    this.skillManager = new SkillManager(this.mcp, this.weather);
    this.sessionManager = new SessionManager();
    this.sessionManager.startCleanupTimer();
  }

  /**
   * 处理用户输入
   * @param {string} userInput - 用户输入的文本
   * @param {string} sessionId - 会话ID，默认为'default'
   * @returns {Promise<Object>} - 处理结果，包含thought、answer、responseTime等字段
   */
  async processUserInput(userInput, sessionId = 'default') {
    const startTime = Date.now();
    try {
      const session = await this.sessionManager.getSession(sessionId);
      session.updateTimestamp();

      if (this.isResetCommand(userInput)) {
        await session.reset();
        await this.sessionManager.saveSession(session);
        const elapsed = Date.now() - startTime;
        console.log(`[响应时间] 重置会话: ${elapsed}ms`);
        return {
          thought: '重置会话',
          answer: '好的，我们重新开始！请问您想去哪里？',
          responseTime: elapsed,
        };
      }

      // 检查是否是规划路线请求
      if (userInput.includes('我想规划路线') || userInput.includes('规划路线')) {
        console.log('检测到规划路线请求，直接调用RouteSkill');
        const instruction = {
          selected_skill: 'RouteSkill',
          params: {
            origin: null,
            destination: null,
            _originalMessage: userInput,
          },
          confidence: 1.0,
        };

        const response = await this.executeInstruction(instruction, session);
        if (response && response.answer) {
          const elapsed = Date.now() - startTime;
          console.log(`[响应时间] 路线规划处理: ${elapsed}ms`);
          await session.addToHistory(userInput, response.answer);
          await this.sessionManager.saveSession(session);
          return {
            ...response,
            responseTime: elapsed,
          };
        }
      }

      // 检查是否是POI搜索请求（如"X有什么好玩的"）
      const directPoiPattern = /(.+?)(?:有什么好玩的|有什么地方玩|有什么景点|有什么好玩的地方)/;
      const directPoiMatch = userInput.match(directPoiPattern);
      if (directPoiMatch && directPoiMatch[1] && directPoiMatch[1].trim().length > 0) {
        console.log('检测到POI搜索请求，直接调用POISkill');
        const center = directPoiMatch[1].trim();
        const instruction = {
          selected_skill: 'POISkill',
          params: {
            center: center,
            keywords: '好玩的',
            _originalMessage: userInput,
          },
          confidence: 1.0,
        };

        const response = await this.executeInstruction(instruction, session);
        if (response && response.answer) {
          const elapsed = Date.now() - startTime;
          console.log(`[响应时间] POI搜索处理: ${elapsed}ms`);
          await session.addToHistory(userInput, response.answer);
          await this.sessionManager.saveSession(session);
          return {
            ...response,
            responseTime: elapsed,
          };
        }
      }

      // 检查是否有未完成的路线信息，优先处理路线规划
      const pendingRouteInfo = session.getPendingRouteInfo();
      if (pendingRouteInfo) {
        console.log('检测到未完成的路线信息，优先处理路线规划');
        const instruction = {
          selected_skill: 'RouteSkill',
          params: {
            origin: null,
            destination: null,
            _originalMessage: userInput,
          },
          confidence: 1.0,
        };

        const response = await this.executeInstruction(instruction, session);
        if (response && response.answer) {
          const elapsed = Date.now() - startTime;
          console.log(`[响应时间] 路线规划处理: ${elapsed}ms`);
          await session.addToHistory(userInput, response.answer);
          await this.sessionManager.saveSession(session);
          return {
            ...response,
            responseTime: elapsed,
          };
        }
      }

      // 1. 优先调用LLM
      const contextPrompt = await buildContextAwarePrompt(session, userInput);
      const llmResponse = await this.llm.callLLM(
        contextPrompt,
        userInput,
        true,
        session // 传入 session 而不是 sessionId
      );

      let response;

      // 尝试解析LLM返回的指令
      if (llmResponse) {
        try {
          let instruction = llmResponse;
          if (typeof instruction === 'string') {
            instruction = JSON.parse(instruction);
          }

          // 保存原始消息到 instruction 对象中，供 Skill 使用
          instruction._originalMessage = userInput;

          response = await this.executeInstruction(instruction, session);

          // 成功则返回
          if (response && response.answer) {
            const elapsed = Date.now() - startTime;
            console.log(`[响应时间] LLM解析: ${elapsed}ms`);
            await session.addToHistory(userInput, response.answer);
            await this.sessionManager.saveSession(session);
            return {
              ...response,
              responseTime: elapsed,
            };
          }
        } catch (error) {
          console.error('LLM指令解析失败:', error);
          // 继续走fallback
        }
      }

      // 2. LLM失败，尝试localReact
      const localResult = await this.llm.localReact(userInput, {
        geocode: async (address) => {
          return await this.mcp.geocode(address);
        },
        get_directions: async (origin, destination, originCoord, destCoord) => {
          return await this.mcp.getDirections(
            origin,
            destination,
            originCoord,
            destCoord
          );
        },
        route_bicycling: async (origin, destination) => {
          return await this.mcp.bicycling(origin, destination);
        },
        route_walking: async (origin, destination) => {
          return await this.mcp.walking(origin, destination);
        },
        search_nearby: async (location, keywords, radius, limit) => {
          return await this.mcp.searchNearby(location, keywords, radius, limit);
        },
        weather: async (city) => {
          try {
            return await this.weather.getWeatherByCityName(city);
          } catch (error) {
            console.error('天气查询失败:', error);
            return null;
          }
        },
        travel_advice: async (city, type) => {
          try {
            const weather = await this.weather.getWeatherByCityName(city);
            if (weather?.weather) {
              return this.weather.generateSmartAdvice(weather.weather);
            }
            return [];
          } catch (error) {
            console.error('生成出行建议失败:', error);
            return [];
          }
        },
      });

      // 如果localReact能够处理，直接返回结果
      if (localResult.handled) {
        // 更新地点信息
        if (localResult.lastMentionedLocation) {
          session.updateLastMentionedLocation(
            localResult.lastMentionedLocation
          );
        }
        if (localResult.lastOrigin) {
          session.updateLastOrigin(localResult.lastOrigin);
          session.addToLocationHistory(localResult.lastOrigin, 'origin');
        }
        if (localResult.lastDestination) {
          session.updateLastDestination(localResult.lastDestination);
          session.addToLocationHistory(
            localResult.lastDestination,
            'destination'
          );
        }
        const elapsed = Date.now() - startTime;
        console.log(`[响应时间] 本地处理: ${elapsed}ms`);
        await session.addToHistory(userInput, localResult.answer);
        await this.sessionManager.saveSession(session);
        return {
          ...localResult,
          responseTime: elapsed,
        };
      }

      // 3. 最后用简化的fallback
      const quickFallbackResult = this.fallbackIntentParsing(
        userInput,
        session
      );
      response = await this.handleFallbackLogic(
        session,
        quickFallbackResult,
        userInput
      );

      const elapsed = Date.now() - startTime;
      console.log(`[响应时间] Fallback解析: ${elapsed}ms`);
      await session.addToHistory(userInput, response.answer);
      await this.sessionManager.saveSession(session);
      return {
        ...response,
        responseTime: elapsed,
      };
    } catch (error) {
      console.error('多轮对话处理失败:', error);
      const elapsed = Date.now() - startTime;
      console.log(`[响应时间] 处理失败: ${elapsed}ms`);
      return {
        thought: '处理失败',
        answer: '抱歉，处理您的请求时出现了问题，请稍后重试。',
        responseTime: elapsed,
      };
    }
  }

  /**
   * 检查是否是重置命令
   * @param {string} userInput - 用户输入的文本
   * @returns {boolean} - 是否是重置命令
   */
  isResetCommand(userInput) {
    const resetPatterns = [
      '重新开始',
      '重新来',
      '算了',
      '取消',
      'reset',
      '重新',
    ];
    return resetPatterns.some((pattern) => userInput.includes(pattern));
  }

  /**
   * 解析用户输入的意图（fallback机制）
   * @param {string} userInput - 用户输入的文本
   * @param {Object} session - 会话对象
   * @returns {Object} - 解析结果，包含intent、origin、destination等字段
   */
  fallbackIntentParsing(userInput, session) {
    const text = String(userInput);

    // 输入清理：移除"用户: "前缀
    let cleanedText = text.replace(/^用户:\s*/, '').trim();

    // 只做指代词替换
    if (session) {
      const bestLocation = session.getBestLocationForContext(userInput);
      if (bestLocation) {
        // 只做替换，不检测隐含意图
        cleanedText = cleanedText.replace(
          /(那里|这里|那儿|这儿|那边|这边)/g,
          bestLocation
        );
      }
    }

    // 规则1：POI 搜索匹配（只匹配有明确中心点的）
    const poiPattern =
      /(.+?)(?:附近|周边|周围|有什么|有|有没有|推荐|好玩)(?:的)?(?:地方|景点|餐厅|酒店)?(?:吗|呢|啊)?$/;
    const poiMatch = cleanedText.match(poiPattern);
    if (poiMatch && poiMatch[1] && poiMatch[1].trim().length > 0) {
      // 只有当 center 有值时才返回
      let center = poiMatch[1].trim();
      let keywords = poiMatch[2]?.trim() || '好玩的';
      // 关键词映射（吃→餐厅，玩→景点，住→酒店）
      return {
        intent: INTENT_TYPES.QUERY,
        poi_search: { enabled: true, keywords },
        origin: center,
      };
    }
    
    // 规则1.1：直接匹配"X有什么好玩的"格式
    const directPoiPattern = /(.+?)(?:有什么好玩的|有什么地方玩|有什么景点|有什么好玩的地方)/;
    const directPoiMatch = cleanedText.match(directPoiPattern);
    if (directPoiMatch && directPoiMatch[1] && directPoiMatch[1].trim().length > 0) {
      let center = directPoiMatch[1].trim();
      return {
        intent: INTENT_TYPES.QUERY,
        poi_search: { enabled: true, keywords: '好玩的' },
        origin: center,
      };
    }
    // 如果没有 center，继续往下走，不返回

    // 规则2：路线规划匹配
    const routePattern = /从\s*(.+?)\s*(?:到|去)\s*(.+?)(?:怎么|如何|路线|走)?/;
    const routeMatch = cleanedText.match(routePattern);
    if (routeMatch && routeMatch[1] && routeMatch[2]) {
      return {
        intent: INTENT_TYPES.PROVIDE_INFO,
        hasRouteIntent: true,
        origin: routeMatch[1].trim(),
        destination: routeMatch[2].trim(),
      };
    }

    // 规则3：续程检测（"再去珠海"）
    const continuePattern = /(?:再去|然后去|接着去)\s*(.+)/;
    const continueMatch = cleanedText.match(continuePattern);
    if (continueMatch && continueMatch[1] && session) {
      const lastDest = session.getLastDestination();
      if (lastDest) {
        return {
          intent: INTENT_TYPES.CONTINUE_JOURNEY,
          hasRouteIntent: true,
          origin: lastDest,
          destination: continueMatch[1].trim(),
        };
      }
    }

    // 规则4：天气查询匹配
    const weatherPattern = /(.+?)(?:天气|气温|温度)(?:怎么样|如何)?/;
    const weatherMatch = cleanedText.match(weatherPattern);

    // 纯"天气怎么样"的匹配（无地点）
    const genericWeatherPattern = /^(?:天气|气温|温度)(?:怎么样|如何)?[？?]?$/;
    const isGenericWeather = genericWeatherPattern.test(cleanedText);

    // 也匹配 "那天气怎么样" 这类带指代词的
    const referenceWeatherPattern =
      /^(那|这|那里|这里)(?:的)?(?:天气|气温|温度)(?:怎么样|如何)?[？?]?$/;
    const isReferenceWeather = referenceWeatherPattern.test(cleanedText);

    if ((isGenericWeather || isReferenceWeather) && session) {
      const lastSearched = session.getLastSearchedLocation(); // 和 POI 一样，优先
      const lastOrigin = session.getLastOrigin();
      const lastDestination = session.getLastDestination();

      // 和 POI 搜索保持一致的优先级
      if (lastSearched) {
        return {
          intent: INTENT_TYPES.QUERY,
          isWeather: true,
          location: lastSearched, // 优先使用最后搜索的地点
        };
      }

      if (lastOrigin && lastDestination) {
        return {
          intent: INTENT_TYPES.QUERY,
          isWeather: true,
          multi_location: true,
          locations: [lastOrigin, lastDestination],
        };
      }

      if (lastOrigin || lastDestination) {
        return {
          intent: INTENT_TYPES.QUERY,
          isWeather: true,
          location: lastOrigin || lastDestination,
        };
      }
    }

    if (weatherMatch && weatherMatch[1]) {
      return {
        intent: INTENT_TYPES.QUERY,
        origin: weatherMatch[1].trim(),
        isWeather: true,
      };
    }

    // 返回 UNKNOWN，让 LLM 处理
    return {
      intent: INTENT_TYPES.UNKNOWN,
      hasRouteIntent: false,
      origin: null,
      destination: null,
      missingInfo: [],
      clarification: null,
      adjustment: null,
    };
  }

  /**
   * 根据意图结果更新会话信息
   * @param {Object} session - 会话对象
   * @param {Object} intentResult - 意图解析结果
   */
  updateSessionFromIntent(session, intentResult) {
    if (!intentResult) return;

    if (intentResult.origin) {
      session.setOrigin(intentResult.origin);
    }

    if (intentResult.destination) {
      session.setDestination(intentResult.destination);
    }

    if (intentResult.hasRouteIntent) {
      if (intentResult.origin) {
        session.setOrigin(intentResult.origin);
      }
      if (intentResult.destination) {
        session.setDestination(intentResult.destination);
      }
    }

    if (intentResult.adjustment) {
      if (intentResult.adjustment.includes('便宜')) {
        session.collectedInfo.preferredTransport = '公共交通';
      } else if (intentResult.adjustment.includes('快')) {
        session.collectedInfo.preferredTransport = '驾车';
      }
    }

    // 更新最后提及的地点
    if (intentResult.origin) {
      session.updateLastMentionedLocation(intentResult.origin);
    } else if (intentResult.destination) {
      session.updateLastMentionedLocation(intentResult.destination);
    }
  }

  /**
   * 标准化意图结果
   * @param {Object} llmResult - LLM返回的意图结果
   * @returns {Object} - 标准化后的意图结果
   */
  normalizeIntentResult(llmResult) {
    const intent = llmResult.intent || INTENT_TYPES.UNKNOWN;

    if (intent === INTENT_TYPES.CLARIFY) {
      return {
        intent: INTENT_TYPES.CLARIFY,
        hasRouteIntent: false,
        origin: null,
        destination: null,
        missingInfo: [],
        clarification: llmResult.clarification || '您指的是哪里？',
      };
    }

    if (intent === INTENT_TYPES.CONFIRM || intent === INTENT_TYPES.NEGATE) {
      return {
        intent,
        hasRouteIntent: false,
        origin: llmResult.origin || null,
        destination: llmResult.destination || null,
        missingInfo: [],
      };
    }

    const hasRouteIntent =
      llmResult.has_route_intent || llmResult.hasRouteIntent || false;

    return {
      intent: intent,
      hasRouteIntent: hasRouteIntent,
      origin: llmResult.origin || null,
      destination: llmResult.destination || null,
      missingInfo: llmResult.missing_info || [],
      poi_search: llmResult.poi_search || null,
    };
  }

  /**
   * 处理POI搜索
   * @param {Object} session - 会话对象
   * @param {string} center - 搜索中心点
   * @param {Object} poiSearch - POI搜索参数
   * @returns {Promise<Object>} - 搜索结果
   */
  async handlePoiSearch(session, center, poiSearch) {
    // 将参数转换为 POISkill 需要的格式
    const params = {
      center: center,
      keywords: poiSearch.keywords,
      radius: poiSearch.radius || 500,
      limit: 10,
    };
    // 调用 POISkill
    return await this.skillManager.executeSkill('POISkill', params, session);
  }

  /**
   * 处理信息收集
   * @param {Object} session - 会话对象
   * @param {Object} intentResult - 意图解析结果
   * @returns {Promise<Object>} - 处理结果
   */
  async handleInfoCollection(session, intentResult) {
    if (intentResult.origin) {
      session.setOrigin(intentResult.origin);
    }

    if (intentResult.destination) {
      session.setDestination(intentResult.destination);
    }

    if (session.isInfoComplete()) {
      const originWeather = await this.weather.getWeatherByCityName(
        session.collectedInfo.origin
      );
      const destWeather = await this.weather.getWeatherByCityName(
        session.collectedInfo.destination
      );

      return {
        thought: '信息收集完成，准备生成路线',
        answer: `好的，从${session.collectedInfo.origin}到${session.collectedInfo.destination}。正在为您规划路线...`,
        metadata: {
          weather: {
            origin: originWeather ? originWeather.weather : null,
            destination: destWeather ? destWeather.weather : null,
          },
        },
      };
    }

    const missing = session.getMissingInfo();
    let question = '';
    if (missing.includes('origin')) {
      question = '请问您从哪里出发？';
    } else if (missing.includes('destination')) {
      question = '您想去哪里？';
    }

    return {
      thought: '继续收集信息',
      answer: question,
    };
  }

  /**
   * 处理用户确认
   * @param {Object} session - 会话对象
   * @param {Object} intentResult - 意图解析结果
   * @returns {Promise<Object>} - 处理结果
   */
  async handleConfirmation(session, intentResult) {
    if (intentResult.intent === INTENT_TYPES.CONFIRM) {
      return {
        thought: '用户确认，开始规划',
        answer: '好的，正在为您规划最佳路线...',
      };
    } else if (intentResult.intent === INTENT_TYPES.NEGATE) {
      session.reset();
      return {
        thought: '用户取消，重新开始',
        answer: '好的，我们重新开始。请告诉我您想去哪里？',
      };
    }

    return {
      thought: '等待用户确认',
      answer: '请问这样安排可以吗？',
    };
  }

  /**
   * 处理推荐
   * @param {Object} session - 会话对象
   * @param {Object} intentResult - 意图解析结果
   * @returns {Promise<Object>} - 处理结果
   */
  async handleRecommendation(session, intentResult) {
    return {
      thought: '提供推荐',
      answer: '根据您的情况，我为您推荐以下方案...',
    };
  }

  /**
   * 处理调整
   * @param {Object} session - 会话对象
   * @param {Object} intentResult - 意图解析结果
   * @returns {Promise<Object>} - 处理结果
   */
  async handleAdjustment(session, intentResult) {
    if (intentResult.adjustment) {
      return {
        thought: '调整偏好',
        answer: '好的，已经根据您的偏好调整了推荐方案。',
      };
    }

    return {
      thought: '等待调整指示',
      answer: '请问您想如何调整？',
    };
  }

  /**
   * 执行指令
   * @param {Object} instruction - 指令对象
   * @param {Object} session - 会话对象
   * @returns {Promise<Object>} - 执行结果
   */
  async executeInstruction(instruction, session) {
    if (!instruction || typeof instruction !== 'object') {
      return {
        thought: '指令格式错误',
        answer: '抱歉，无法理解您的需求，请稍后重试。',
      };
    }

    const { selected_skill, params, confidence } = instruction;

    console.log('执行Skill:', selected_skill, params, confidence);

    if (confidence !== undefined && confidence < 0.7) {
      return {
        thought: '置信度低',
        answer:
          '抱歉，我不太理解您的需求。请用简单清晰的语言告诉我您的需求，谢谢！',
      };
    }

    // 保存原始消息到 params 中，供 RouteSkill 等使用
    const enrichedParams = {
      ...params,
      originalMessage:
        instruction._originalMessage || params.originalMessage || '',
    };

    return await this.skillManager.executeSkill(selected_skill, enrichedParams, session);
  }







  async GeneralInfoSkill(params, session) {
    const { question, location } = params;

    if (!location) {
      return {
        thought: '缺少地点信息',
        answer: '请问您想了解哪个地点的信息？',
      };
    }

    const geo = await this.mcp.geocode(location);
    if (!geo) {
      return {
        thought: '地理编码失败',
        answer: `抱歉，无法找到"${location}"的位置信息。`,
      };
    }

    return {
      thought: '通用信息查询',
      answer: `关于${location}，${question || '我不太清楚具体信息'}。\n\n建议您：\n1. 查看官方网站获取最新信息\n2. 拨打当地旅游信息中心咨询\n3. 使用地图应用查看详情`,
    };
  }

  async AskUserSkill(params, session) {
    const { question, missing_field } = params;

    if (missing_field) {
      session.pendingField = missing_field;
    }

    return {
      thought: '询问用户',
      answer: question || '请问您能提供更多信息吗？',
    };
  }

  async ShowMoreSkill(params, session) {
    const lastPoiResults = session.getLastPoiResults();
    const currentIndex = session.getLastPoiIndex();

    if (!lastPoiResults || lastPoiResults.length === 0) {
      return {
        thought: '没有历史搜索结果',
        answer: '抱歉，没有更多结果了。请先搜索一个地点。',
      };
    }

    if (lastPoiResults.length <= currentIndex) {
      return {
        thought: '没有更多结果',
        answer: '抱歉，没有更多结果了。',
      };
    }

    const nextResults = lastPoiResults.slice(currentIndex, currentIndex + 5);
    session.setLastPoiIndex(currentIndex + nextResults.length);

    if (nextResults.length === 0) {
      return {
        thought: '没有更多结果',
        answer: '抱歉，没有更多结果了。',
      };
    }

    let answer = '更多结果：\n\n';
    nextResults.forEach((poi, index) => {
      answer += `${currentIndex + index + 1}. ${poi.name}（距离${poi.distance}米）\n`;
      if (poi.address) answer += `   地址：${poi.address}\n`;
      if (poi.tel) answer += `   电话：${poi.tel}\n`;
      answer += '\n';
    });
    answer += '还有更多需要帮助的吗？';

    // 获取搜索中心点和关键词
    const center = session.getLastSearchedLocation();
    const keywords = session.getLastPoiKeywords();

    return {
      thought: `ShowMoreSkill: 显示第${currentIndex + 1}到${currentIndex + nextResults.length}个结果`,
      answer: answer,
      data: {
        type: 'poi',
        center: center,
        keywords: keywords,
        results: nextResults.map((poi) => ({
          name: poi.name,
          distance: poi.distance,
          address: poi.address,
          tel: poi.tel,
          type: poi.type,
          lng: poi.location?.longitude,
          lat: poi.location?.latitude,
        })),
      },
    };
  }

  // 解析起点和终点
  parseOriginAndDestination(message) {
    const result = { origin: null, destination: null };

    // 匹配 "从 X 到 Y" 格式
    const fromToMatch = message.match(/从\s*(.+?)\s*到\s*(.+)/);
    if (fromToMatch) {
      result.origin = fromToMatch[1].trim();
      result.destination = fromToMatch[2].trim();
      return result;
    }

    // 匹配 "从 X" 格式
    const fromMatch = message.match(/从\s*(.+)/);
    if (fromMatch) {
      result.origin = fromMatch[1].trim();
      return result;
    }

    // 匹配 "到 Y" 或 "去 Y" 格式
    const toMatch = message.match(/(到|去)\s*(.+)/);
    if (toMatch) {
      result.destination = toMatch[2].trim();
      return result;
    }

    return result;
  }

  // 处理POI搜索
  async handleSearchPoi(params, session) {
    const { center, keywords } = params;

    if (!center) {
      return {
        thought: '缺少搜索中心点',
        answer: '请问您想在哪里附近搜索？',
      };
    }

    const poiSearch = {
      enabled: true,
      keywords: keywords || '地点',
    };

    return await this.handlePoiSearch(session, center, poiSearch);
  }

  // 处理路线规划
  async handlePlanRoute(params, session) {
    let { origin, destination } = params;

    if (!origin || !destination) {
      return {
        thought: '缺少路线信息',
        answer: '请问您从哪里出发，要去哪里？',
      };
    }

    // 清洗起点和终点名称，移除"怎么走？"、"路线"等后缀
    const cleanOrigin = origin
      .replace(/[？?]\s*$/, '')
      .replace(/怎么走.*$/, '')
      .replace(/路线.*$/, '')
      .replace(/从\s*/, '')
      .trim();
    const cleanDestination = destination
      .replace(/[？?]\s*$/, '')
      .replace(/怎么走.*$/, '')
      .replace(/路线.*$/, '')
      .replace(/到\s*/, '')
      .replace(/去\s*/, '')
      .trim();

    const geoOrigin = await this.mcp.geocode(cleanOrigin);
    const geoDest = await this.mcp.geocode(cleanDestination);

    console.log('GeoDest:', geoDest);
    console.log(
      'dest_coord:',
      geoDest ? geoDest.longitude : 'undefined',
      geoDest ? geoDest.latitude : 'undefined'
    );

    if (!geoOrigin || !geoDest) {
      return {
        thought: '地理编码失败',
        answer: '抱歉，无法获取起点或终点的位置信息，请检查地址是否正确。',
      };
    }

    const directions = await this.mcp.getDirections(
      cleanOrigin,
      cleanDestination
    );

    let answer = `从${cleanOrigin}到${cleanDestination}的出行方案：\n\n`;

    directions.forEach((scheme, index) => {
      const isRecommended = index === 0;

      answer += `${index + 1}. ${scheme.type}${isRecommended ? ' ⭐推荐' : ''}\n`;

      if (scheme.recommendedReason && isRecommended) {
        answer += `   推荐理由: ${scheme.recommendedReason}\n`;
      }

      answer += `   ⏱️ 预计时间: ${scheme.duration}\n`;
      answer += `   💰 预计费用: ${scheme.cost}\n`;
      answer += `   📍 距离: ${this.formatDistance(scheme.distance)}\n`;

      if (scheme.timeBreakdown) {
        const timeBreakdownText = Array.isArray(scheme.timeBreakdown)
          ? scheme.timeBreakdown.join(' + ')
          : scheme.timeBreakdown;
        answer += `   🚶 时间构成: ${timeBreakdownText}\n`;
      }

      if (scheme.metroLines) {
        const metroLinesText = Array.isArray(scheme.metroLines)
          ? scheme.metroLines.join('、')
          : scheme.metroLines;
        answer += `   🚇 途经地铁: ${metroLinesText}\n`;
      }

      if (scheme.transfers && scheme.transfers.length > 0) {
        const transfersText = Array.isArray(scheme.transfers)
          ? scheme.transfers.join(' -> ')
          : scheme.transfers;
        answer += `   🛤️ 详细换乘: ${transfersText}\n`;
      }

      answer += '\n';
    });

    // 更新会话信息
    session.updateLastOrigin(cleanOrigin);
    session.updateLastDestination(cleanDestination);
    session.addToLocationHistory(cleanOrigin, 'origin');
    session.addToLocationHistory(cleanDestination, 'destination');

    // 生成自然语言路线建议（亲切、带表情）
    const naturalRouteAdvice = this.generateNaturalRouteAdvice(
      directions,
      cleanOrigin,
      cleanDestination
    );

    // 构建结构化响应
    const structuredResponse = {
      type: 'route',
      origin: cleanOrigin,
      destination: cleanDestination,
      schemes: directions.map((scheme, index) => ({
        type: scheme.type,
        duration: scheme.duration,
        cost: scheme.cost,
        distance: this.formatDistance(scheme.distance),
        steps: scheme.transfers || [],
        structuredSteps: scheme.structuredSteps || [],
        metro_lines: scheme.metroLines || [],
        recommendation_reason:
          index === 0 ? scheme.recommendedReason : undefined,
        time_breakdown: scheme.timeBreakdown,
        dest_coord: {
          lng: geoDest.longitude,
          lat: geoDest.latitude,
        },
      })),
      recommended_index: 0,
      natural_advice: naturalRouteAdvice,
    };

    // 同时保持原有文本格式作为 fallback
    answer = `从${cleanOrigin}到${cleanDestination}的出行方案：\n\n`;

    directions.forEach((scheme, index) => {
      const isRecommended = index === 0;

      answer += `${index + 1}. ${scheme.type}${isRecommended ? ' ⭐推荐' : ''}\n`;

      if (scheme.recommendedReason && isRecommended) {
        answer += `   推荐理由: ${scheme.recommendedReason}\n`;
      }

      answer += `   ⏱️ 预计时间: ${scheme.duration}\n`;
      answer += `   💰 预计费用: ${scheme.cost}\n`;
      answer += `   📍 距离: ${this.formatDistance(scheme.distance)}\n`;

      if (scheme.timeBreakdown) {
        const timeBreakdownText = Array.isArray(scheme.timeBreakdown)
          ? scheme.timeBreakdown.join(' + ')
          : scheme.timeBreakdown;
        answer += `   🚶 时间构成: ${timeBreakdownText}\n`;
      }

      if (scheme.metroLines) {
        const metroLinesText = Array.isArray(scheme.metroLines)
          ? scheme.metroLines.join('、')
          : scheme.metroLines;
        answer += `   🚇 途经地铁: ${metroLinesText}\n`;
      }

      if (scheme.transfers && scheme.transfers.length > 0) {
        const transfersText = Array.isArray(scheme.transfers)
          ? scheme.transfers.join(' -> ')
          : scheme.transfers;
        answer += `   🛤️ 详细换乘: ${transfersText}\n`;
      }

      answer += '\n';
    });

    if (naturalRouteAdvice) {
      answer += '\n💡 ' + naturalRouteAdvice;
    }

    return {
      thought: '路线规划完成',
      answer: answer,
      data: structuredResponse,
    };
  }

  // 生成自然语言路线建议（亲切、带表情）
  generateNaturalRouteAdvice(directions, origin, destination) {
    if (!directions || directions.length === 0) {
      return null;
    }

    const recommended = directions[0];
    const suggestions = [];

    // 根据推荐方案类型生成建议
    if (recommended.type === '驾车') {
      suggestions.push(`推荐您驾车出行🚗，大约${recommended.duration}可达`);
      if (recommended.cost && recommended.cost !== '¥0') {
        suggestions.push(`过路费约${recommended.cost}`);
      }
    } else if (recommended.type === '公共交通') {
      suggestions.push('推荐公共交通🚌，经济实惠又环保');
      suggestions.push(
        `全程约${recommended.duration}，费用仅${recommended.cost}`
      );

      // 检查是否需要换乘
      if (recommended.transfers && recommended.transfers.length > 2) {
        suggestions.push(
          `需要换乘${recommended.transfers.length - 1}次，记得握好扶手哦🚌`
        );
      }

      // 检查步行距离
      const walkingMatch = recommended.duration.match(/步行(\d+)米/);
      if (walkingMatch) {
        const walkingDistance = parseInt(walkingMatch[1]);
        if (walkingDistance > 1000) {
          suggestions.push(
            `步行距离较长${walkingDistance}米，记得穿舒适的鞋子👟`
          );
        }
      }
    } else if (recommended.type === '骑行') {
      suggestions.push('骑行是个不错的选择🚴‍♂️，还能锻炼身体');
      suggestions.push(`大约${recommended.duration}可达`);
    } else if (recommended.type === '步行') {
      suggestions.push('距离较短，步行是最好的选择🚶‍♂️');
      suggestions.push(`大约${recommended.duration}，正好欣赏沿途风景🌸`);
    }

    // 检查其他方案的时间差异
    if (directions.length > 1) {
      const secondOption = directions[1];
      const firstDurationMatch = recommended.duration.match(/(\d+)分钟/);
      const secondDurationMatch = secondOption.duration.match(/(\d+)分钟/);

      if (firstDurationMatch && secondDurationMatch) {
        const firstDuration = parseInt(firstDurationMatch[1]);
        const secondDuration = parseInt(secondDurationMatch[1]);
        const diff = secondDuration - firstDuration;

        if (diff > 30 && recommended.type === '公共交通') {
          suggestions.push(
            `PS：第二方案驾车仅需${secondOption.duration}，比公交快${diff}分钟哦🚗`
          );
        }
      }
    }

    return suggestions.join('，') + '。';
  }

  // 显示更多结果
  async handleShowMore(session) {
    const lastPoiResults = session.getLastPoiResults();
    const currentIndex = session.getLastPoiIndex();

    if (!lastPoiResults || lastPoiResults.length <= currentIndex + 5) {
      return {
        thought: '没有更多结果',
        answer: '抱歉，没有更多结果了。',
      };
    }

    session.setLastPoiIndex(currentIndex + 5);
    const nextResults = lastPoiResults.slice(currentIndex, currentIndex + 5);

    let answer = '更多结果：\n\n';
    nextResults.forEach((poi, index) => {
      answer += `${currentIndex + index + 1}. ${poi.name}（距离${poi.distance}米）\n`;
      if (poi.address) {
        answer += `   地址：${poi.address}\n`;
      }
      if (poi.tel) {
        answer += `   电话：${poi.tel}\n`;
      }
      answer += `   类型：${poi.type}\n\n`;
    });

    return {
      thought: '显示更多结果',
      answer: answer,
    };
  }

  // 调整推荐参数
  async handleAdjust(params, session) {
    const { preference } = params;

    // 这里可以根据preference调整搜索参数
    // 例如：更便宜、更靠近、评分更高等

    return {
      thought: '调整偏好',
      answer: `好的，已经根据您的偏好"${preference}"调整了推荐方案。`,
    };
  }

  /**
   * 处理fallback逻辑
   * @param {Object} session - 会话对象
   * @param {Object} intentResult - 意图解析结果
   * @param {string} userInput - 用户输入的文本
   * @returns {Promise<Object>} - 处理结果
   */
  async handleFallbackLogic(session, intentResult, userInput) {
    this.updateSessionFromIntent(session, intentResult);

    let response;

    // 检查是否是天气查询请求
    if (intentResult.isWeather) {
      if (intentResult.multi_location && intentResult.locations) {
        // 多地点天气查询 - 需要传递 time 参数
        return await this.skillManager.executeSkill('WeatherSkill',
          {
            locations: intentResult.locations,
            multi_location: true,
            time: intentResult.time || null, // 添加 time 支持
          },
          session
        );
      } else if (intentResult.origin) {
        // 单地点天气查询（从 origin 字段）
        return await this.skillManager.executeSkill('WeatherSkill',
          {
            location: intentResult.origin,
            time: intentResult.time || null,
          },
          session
        );
      } else if (intentResult.location) {
        // 单地点天气查询（从 location 字段）
        return await this.skillManager.executeSkill('WeatherSkill',
          {
            location: intentResult.location,
            time: intentResult.time || null,
          },
          session
        );
      }
    }

    // 检查是否是POI搜索请求
    const poiSearch = intentResult.poi_search || session.poiSearch;
    if (poiSearch && poiSearch.enabled) {
      // 检查是否有搜索中心点
      if (intentResult.origin || session.collectedInfo.origin) {
        const center = intentResult.origin || session.collectedInfo.origin;
        response = await this.handlePoiSearch(session, center, poiSearch);
      } else {
        return {
          thought: '缺少搜索中心点',
          answer: '请问您想在哪里附近搜索？',
        };
      }
    } else if (intentResult.intent === INTENT_TYPES.UNKNOWN) {
      // 清除poiSearch，确保返回友好提示
      session.poiSearch = null;
      return {
        thought: '无法识别用户意图',
        answer:
          '抱歉，我不太理解您的需求。我可以帮您：\n\n1. 路线规划：例如 "从广州到北京怎么走"\n2. 周边搜索：例如 "广州塔附近有什么餐厅"\n3. 行程推荐：例如 "周末去哪里玩比较好"\n\n请用简单清晰的语言告诉我您的需求，谢谢！',
      };
    } else {
      const nextState = determineNextState(session, intentResult);
      session.setState(nextState);

      if (
        session.state === DIALOG_STATES.COLLECTING_ORIGIN ||
        session.state === DIALOG_STATES.COLLECTING_DESTINATION
      ) {
        response = await this.handleInfoCollection(session, intentResult);
      } else if (session.state === DIALOG_STATES.CONFIRMING) {
        response = await this.handleConfirmation(session, intentResult);
      } else if (session.state === DIALOG_STATES.RECOMMENDING) {
        response = await this.handleRecommendation(session, intentResult);
      } else if (session.state === DIALOG_STATES.ADJUSTING) {
        response = await this.handleAdjustment(session, intentResult);
      } else {
        response = await this.handleInitialState(session, intentResult);
      }
    }

    return response;
  }

  async handleInitialState(session, intentResult) {
    if (intentResult.hasRouteIntent) {
      return await this.handleInfoCollection(session, intentResult);
    }

    if (intentResult.poi_search && intentResult.poi_search.enabled) {
      if (intentResult.origin) {
        return await this.handlePoiSearch(
          session,
          intentResult.origin,
          intentResult.poi_search
        );
      }
      return {
        thought: '等待地点信息',
        answer: '请问您想在哪个地点附近搜索？',
      };
    }

    return {
      thought: '初始状态',
      answer:
        '您好！我是旅行助手。我可以帮您：\n1. 规划路线：例如"从广州到北京怎么走"\n2. 搜索周边：例如"广州塔附近有什么餐厅"\n3. 了解地点：例如"广州塔在哪里"\n\n请告诉我您的需求！',
    };
  }
}

module.exports = MultiTurnTravelAssistant;