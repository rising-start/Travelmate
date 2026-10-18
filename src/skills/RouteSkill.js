


class RouteSkill {
  constructor(mcp, weather) {
    this.mcp = mcp;
    this.weather = weather;
  }

  

  isCorrectingInput(message) {
    if (!message) return false;
    const correctingPatterns = [/不是/i, /不对/i, /换/i, /改/i, /应该/i];
    return correctingPatterns.some((pattern) => pattern.test(message));
  }

  

  parseCorrectedInput(message) {
    const result = { origin: null, destination: null };

    const fromToPattern = /从(.+?)到(.+)/;
    const match = message.match(fromToPattern);
    if (match) {
      result.origin = match[1].trim();
      result.destination = match[2].trim();
    }

    return result;
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

  

  formatDistance(distance) {
    const num = parseInt(distance) || 0;
    return num >= 1000 ? `${(num / 1000).toFixed(1)}公里` : `${num}米`;
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

  

  async handlePlanRoute(params, session) {
    try {
      let { origin, destination } = params;

      if (!origin || !destination) {
        return {
          thought: '缺少路线信息',
          answer: '请问您从哪里出发，要去哪里？',
        };
      }

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

      if (!directions || directions.length === 0) {
        return {
          thought: '路线规划失败',
          answer: '抱歉，无法为您规划路线，请检查起点和终点是否正确。',
        };
      }

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

      session.updateLastOrigin(cleanOrigin);
      session.updateLastDestination(cleanDestination);
      session.addToLocationHistory(cleanOrigin, 'origin');
      session.addToLocationHistory(cleanDestination, 'destination');

      const naturalRouteAdvice = this.generateNaturalRouteAdvice(
        directions,
        cleanOrigin,
        cleanDestination
      );

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
    } catch (error) {
      console.error('路线规划失败:', error);
      return {
        thought: '路线规划失败',
        answer: '抱歉，处理您的路线请求时出现了问题，请稍后重试。',
      };
    }
  }

  

  async execute(params, session) {
    try {
      let { origin, destination, mode } = params;

      const continueMatch = (params.originalMessage || '').match(
        /(?:再去|然后去|接着去)\s*(.+)/
      );
      if (continueMatch && continueMatch[1] && !origin && !destination) {
        const lastDest = session.getLastDestination();
        if (lastDest) {
          origin = lastDest;
          destination = continueMatch[1].trim();
        }
      }

      const isRoutePlanningCmd = params.originalMessage === '__ROUTE_PLANNING__' || (params.originalMessage && params.originalMessage.includes('我想规划路线'));
      if (isRoutePlanningCmd) {
        origin = null;
        destination = null;
        session.clearPendingRouteInfo();
        return {
          thought: '等待用户输入路线信息',
          answer: '请问您从哪里出发？',
          needs_user_input: true,
          session_info: {
            waiting_for: 'origin'
          },
        };
      }

      const pendingRouteInfo = session.getPendingRouteInfo();
      if (pendingRouteInfo) {
        if (!origin && pendingRouteInfo.origin) {
          origin = pendingRouteInfo.origin;
        }
        if (!destination && pendingRouteInfo.destination) {
          destination = pendingRouteInfo.destination;
        }
        session.clearPendingRouteInfo();
      }

      const isCorrecting = this.isCorrectingInput(params.originalMessage || '');
      if (isCorrecting) {
        const corrected = this.parseCorrectedInput(params.originalMessage || '');
        if (corrected.origin) origin = corrected.origin;
        if (corrected.destination) destination = corrected.destination;
      }

      const originalMessage = params.originalMessage || '';
      if (originalMessage) {
        const hasFrom = originalMessage.includes('从');
        const hasTo =
          originalMessage.includes('到') || originalMessage.includes('去');

        if (hasFrom && !hasTo) {
          const parsed = this.parseOriginAndDestination(originalMessage);
          if (parsed.origin) origin = parsed.origin;
        } else if (hasTo && !hasFrom) {
          const parsed = this.parseOriginAndDestination(originalMessage);
          if (parsed.destination) destination = parsed.destination;
        } else if (!hasFrom && !hasTo) {
          if (pendingRouteInfo) {
            if (!pendingRouteInfo.origin) {
              origin = originalMessage;
            } else if (!pendingRouteInfo.destination) {
              destination = originalMessage;
            }
          } else if (!origin) {
            origin = originalMessage;
          } else if (!destination) {
            destination = originalMessage;
          }
        }
      }

      if (!isRoutePlanningCmd) {
        if (!origin) {
          origin = session.getLastOrigin() || session.getCurrentLocation();
        }

        if (!destination) {
          destination = session.getLastDestination();
        }

        if (origin && !destination && params._implied_destination) {
          destination = session.getLastDestination();
        }
      }

      if (origin && !destination) {
        try {
          const geoOrigin = await this.mcp.geocode(origin);
          if (geoOrigin) {
            const pois = await this.mcp.searchNearby(geoOrigin, '', 500, 1);
            if (pois && pois.length > 0) {
              origin = pois[0].name;
            }
          }
        } catch (error) {
          console.error('搜索附近地址失败:', error);
        }
      }

      if (origin && destination && origin === destination) {
        destination = null;
      }

      if (!origin || !destination) {
        let question = '';
        let sessionInfo = {};
        let waitingFor = '';

        if (!origin && !destination) {
          const lastSearched = session.getLastSearchedLocation();
          const lastMentioned = session.getLastMentionedLocation();
          const currentLoc = session.getCurrentLocation();

          if (lastMentioned) {
            destination = lastMentioned;
            question = `请问您从哪里出发去${destination}？`;
            waitingFor = 'origin';
            sessionInfo = { destination };
          } else {
            question = '请问您从哪里出发？';
            waitingFor = 'origin';
          }
        } else if (!origin) {
          question = `请问您从哪里出发去${destination}？`;
          waitingFor = 'origin';
          sessionInfo = { destination };
        } else {
          question = `请问从${origin}去哪里？`;
          waitingFor = 'destination';
          sessionInfo = { origin };
        }

        if (sessionInfo.origin || sessionInfo.destination) {
          session.setPendingRouteInfo(sessionInfo);
        }

        return {
          thought: '等待用户输入路线信息',
          answer: question,
          needs_user_input: true,
          session_info: {
            ...sessionInfo,
            waiting_for: waitingFor,
          },
        };
      }

      return await this.handlePlanRoute({ origin, destination, mode }, session);
    } catch (error) {
      console.error('执行路线规划技能失败:', error);
      return {
        thought: '执行失败',
        answer: '抱歉，处理您的请求时出现了问题，请稍后重试。',
      };
    }
  }
}

module.exports = RouteSkill;
