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
const {
  sanitizeUserInput,
  isValidInstruction,
  sanitizeInstructionParams,
} = require('../utils/inputGuard');



class MultiTurnTravelAssistant {
  

  constructor() {
    this.llm = new LLMService();
    this.mcp = new MCPService();
    this.weather = new Weather();
    this.skillManager = new SkillManager(this.mcp, this.weather);
    this.sessionManager = new SessionManager();
    this.sessionManager.startCleanupTimer();
  }

  

  async processUserInput(userInput, sessionId = 'default') {
    const startTime = Date.now();
    userInput = sanitizeUserInput(userInput, 1000);
    if (!userInput) {
      return {
        thought: '空输入',
        answer: '请输入您想查询的内容哦～',
        success: true,
      };
    }
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

      const contextPrompt = await buildContextAwarePrompt(session, userInput);
      const llmResponse = await this.llm.callLLM(
        contextPrompt,
        userInput,
        true,
        session
      );

      let response;

      if (llmResponse) {
        try {
          let instruction = llmResponse;
          if (typeof instruction === 'string') {
            instruction = JSON.parse(instruction);
          }

          if (!isValidInstruction(instruction)) {
            console.warn(
              '[安全] LLM 返回非法指令结构，已丢弃:',
              JSON.stringify(instruction).slice(0, 200)
            );
            throw new Error('非法指令结构');
          }
          instruction.params = sanitizeInstructionParams(instruction.params);

          instruction._originalMessage = sanitizeUserInput(userInput);

          response = await this.executeInstruction(instruction, session);

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
        }
      }

      if (this.isRouteRequest(userInput)) {
        const endpoints = this.parseOriginAndDestination(userInput);
        try {
          const routeResult = await this.skillManager.executeSkill(
            'RouteSkill',
            {
              origin: endpoints.origin,
              destination: endpoints.destination,
              originalMessage: userInput,
            },
            session
          );
          if (routeResult && routeResult.answer && !routeResult.needs_user_input) {
            const elapsed = Date.now() - startTime;
            console.log(`[响应时间] 路线兜底(RouteSkill): ${elapsed}ms`);
            await session.addToHistory(userInput, routeResult.answer);
            await this.sessionManager.saveSession(session);
            return { ...routeResult, responseTime: elapsed };
          }
        } catch (error) {
          console.error('RouteSkill 兜底失败:', error);
        }
      }

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

      if (localResult.handled) {
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

  

  fallbackIntentParsing(userInput, session) {
    const text = String(userInput);

    let cleanedText = text.replace(/^用户:\s*/, '').trim();

    if (session) {
      const bestLocation = session.getBestLocationForContext(userInput);
      if (bestLocation) {
        cleanedText = cleanedText.replace(
          /(那里|这里|那儿|这儿|那边|这边)/g,
          bestLocation
        );
      }
    }

    const poiPattern =
      /(.+?)(?:附近|周边|周围|有什么|有|有没有|推荐|好玩)(?:的)?(?:地方|景点|餐厅|酒店)?(?:吗|呢|啊)?$/;
    const poiMatch = cleanedText.match(poiPattern);
    if (poiMatch && poiMatch[1] && poiMatch[1].trim().length > 0) {
      let center = poiMatch[1].trim();
      let keywords = poiMatch[2]?.trim() || '好玩的';
      return {
        intent: INTENT_TYPES.QUERY,
        poi_search: { enabled: true, keywords },
        origin: center,
      };
    }
    
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

    const weatherPattern = /(.+?)(?:天气|气温|温度)(?:怎么样|如何)?/;
    const weatherMatch = cleanedText.match(weatherPattern);

    const genericWeatherPattern = /^(?:天气|气温|温度)(?:怎么样|如何)?[？?]?$/;
    const isGenericWeather = genericWeatherPattern.test(cleanedText);

    const referenceWeatherPattern =
      /^(那|这|那里|这里)(?:的)?(?:天气|气温|温度)(?:怎么样|如何)?[？?]?$/;
    const isReferenceWeather = referenceWeatherPattern.test(cleanedText);

    if ((isGenericWeather || isReferenceWeather) && session) {
      const lastSearched = session.getLastSearchedLocation();
      const lastOrigin = session.getLastOrigin();
      const lastDestination = session.getLastDestination();

      if (lastSearched) {
        return {
          intent: INTENT_TYPES.QUERY,
          isWeather: true,
          location: lastSearched,
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

    if (intentResult.origin) {
      session.updateLastMentionedLocation(intentResult.origin);
    } else if (intentResult.destination) {
      session.updateLastMentionedLocation(intentResult.destination);
    }
  }

  

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

  

  async handlePoiSearch(session, center, poiSearch) {
    const params = {
      center: center,
      keywords: poiSearch.keywords,
      radius: poiSearch.radius || 500,
      limit: 10,
    };
    return await this.skillManager.executeSkill('POISkill', params, session);
  }

  

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

  

  async handleConfirmation(session, intentResult) {
    if (intentResult.intent === INTENT_TYPES.CONFIRM) {
      return {
        thought: '用户确认，开始规划',
        answer: '好的，正在为您规划最佳路线...',
      };
    } else if (intentResult.intent === INTENT_TYPES.NEGATE) {
      await session.reset();
      await this.sessionManager.saveSession(session);
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

  

  async handleRecommendation(session, intentResult) {
    return {
      thought: '提供推荐',
      answer: '根据您的情况，我为您推荐以下方案...',
    };
  }

  

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

    const enrichedParams = {
      ...params,
      originalMessage:
        instruction._originalMessage || params.originalMessage || '',
    };

    return await this.skillManager.executeSkill(selected_skill, enrichedParams, session);
  }
  isRouteRequest(message) {
    const { origin, destination } = this.parseOriginAndDestination(message);
    return Boolean(origin && destination);
  }

  parseOriginAndDestination(message) {
    const result = { origin: null, destination: null };

    const fromToMatch = message.match(/从\s*(.+?)\s*到\s*(.+)/);
    if (fromToMatch) {
      result.origin = fromToMatch[1].trim();
      result.destination = fromToMatch[2].trim();
      return result;
    }

    const fromMatch = message.match(/从\s*(.+)/);
    if (fromMatch) {
      result.origin = fromMatch[1].trim();
      return result;
    }

    const toMatch = message.match(/(到|去)\s*(.+)/);
    if (toMatch) {
      result.destination = toMatch[2].trim();
      return result;
    }

    return result;
  }

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

  generateNaturalRouteAdvice(directions, origin, destination) {
    if (!directions || directions.length === 0) {
      return null;
    }

    const recommended = directions[0];
    const suggestions = [];

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

      if (recommended.transfers && recommended.transfers.length > 2) {
        suggestions.push(
          `需要换乘${recommended.transfers.length - 1}次，记得握好扶手哦🚌`
        );
      }

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

  async handleAdjust(params, session) {
    const { preference } = params;


    return {
      thought: '调整偏好',
      answer: `好的，已经根据您的偏好"${preference}"调整了推荐方案。`,
    };
  }

  

  async handleFallbackLogic(session, intentResult, userInput) {
    this.updateSessionFromIntent(session, intentResult);

    let response;

    if (intentResult.isWeather) {
      if (intentResult.multi_location && intentResult.locations) {
        return await this.skillManager.executeSkill('WeatherSkill',
          {
            locations: intentResult.locations,
            multi_location: true,
            time: intentResult.time || null,
          },
          session
        );
      } else if (intentResult.origin) {
        return await this.skillManager.executeSkill('WeatherSkill',
          {
            location: intentResult.origin,
            time: intentResult.time || null,
          },
          session
        );
      } else if (intentResult.location) {
        return await this.skillManager.executeSkill('WeatherSkill',
          {
            location: intentResult.location,
            time: intentResult.time || null,
          },
          session
        );
      }
    }

    const poiSearch = intentResult.poi_search || session.poiSearch;
    if (poiSearch && poiSearch.enabled) {
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