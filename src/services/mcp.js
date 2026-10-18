const https = require('https');
const debug = require('../utils/debug');
const {
  getMapApiKey,
  API_BASE_URL,
  CITY_CENTERS,
  CITY_DISTANCES,
  TRANSPORT_HUBS,
  COMMON_CITIES,
  EXCLUDED_STREET_NAMES,
  DISTRICT_TO_CITY,
  PROVINCES,
} = require('../config/config');

const REQUEST_TIMEOUT = 10000;
const ADDRESS_SUFFIXES = [
  '风景名胜区',
  '旅游度假区',
  '地铁站',
  '公交站',
  '火车站',
  '汽车站',
  '停车场',
  '图书馆',
  '博物馆',
  '体育馆',
  '游泳馆',
  '飞机场',
  '植物园',
  '动物园',
  '风景区',
  '旅游区',
  '度假区',
  '步行街',
  '商业街',
  '机场',
  '公园',
  '广场',
  '大学',
  '医院',
  '景区',
];
const MAX_ADDRESS_VARIATIONS = 8;
const GEOCODE_CACHE_TTL_MS = 5 * 60 * 1000;
const GEOCODE_CACHE_MAX = 500;

class MCP {
  constructor(apiKey) {
    this.apiKey = apiKey || getMapApiKey();
    this.geocodeCache = new Map();
  }

  static maskApiKey(url) {
    return String(url).replace(/([?&]key=)[^&\s]+/gi, '$1***');
  }

  async httpGet(url, timeoutMs = REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, res => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          req.destroy();
          reject(new Error(`HTTP ${res.statusCode}: ${MCP.maskApiKey(url)}`));
          return;
        }

        const chunks = [];
        res.on('data', chunk => {
          chunks.push(chunk);
        });
        res.on('error', error => {
          reject(error);
        });
        res.on('end', () => {
          resolve(Buffer.concat(chunks).toString());
        });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`请求超时: ${MCP.maskApiKey(url)}`));
      });

      req.on('error', error => {
        reject(error);
      });
    });
  }

  async geocode(address) {
    let cleanedAddress = '';
    try {
      cleanedAddress = this.cleanAddress(address);
    } catch (error) {
      cleanedAddress = typeof address === 'string' ? address.trim() : '';
    }

    if (!cleanedAddress) {
      return null;
    }

    try {
      const cacheKey = `${cleanedAddress}|${this.extractCityName(
        cleanedAddress
      )}`;
      const cached = this.geocodeCache.get(cacheKey);
      if (cached) {
        if (cached.expiresAt > Date.now()) {
          return cached.value;
        }
        this.geocodeCache.delete(cacheKey);
      }

      const variations = this
        .generateAddressVariations(cleanedAddress)
        .slice(0, MAX_ADDRESS_VARIATIONS);

      for (const variation of variations) {
        try {
          const cityName = this.extractCityName(variation);
          const encodedAddress = encodeURIComponent(variation);
          const encodedCity = encodeURIComponent(cityName);
          const url = `https://restapi.amap.com/v3/geocode/geo?key=${this.apiKey}&address=${encodedAddress}&city=${encodedCity}`;

          const data = await this.httpGet(url);
          const result = JSON.parse(data);

          if (
            result.status === '1' &&
            result.geocodes &&
            result.geocodes.length > 0
          ) {
            const location = result.geocodes[0].location.split(',');
            const geo = {
              longitude: parseFloat(location[0]),
              latitude: parseFloat(location[1]),
              adcode: result.geocodes[0].adcode,
            };
            this.rememberGeocode(cacheKey, geo);
            return geo;
          }
        } catch (error) {
          console.log(
            `地理编码变体失败: ${variation}`,
            error && error.message ? error.message : error
          );
        }
      }

      const fallback = await this.geocodeByCity(cleanedAddress);
      this.rememberGeocode(cacheKey, fallback);
      return fallback;
    } catch (error) {
      const fallback = await this.geocodeByCity(cleanedAddress);
      this.rememberGeocode(cacheKey, fallback);
      return fallback;
    }
  }

  cleanAddress(address) {
    if (typeof address !== 'string') {
      return '';
    }
    return this
      .normalizeAddress(address)
      .replace(/\（.*?\）/g, '')
      .replace(/\(.*?\)/g, '')
      .trim();
  }

  rememberGeocode(key, value) {
    if (this.geocodeCache.size >= GEOCODE_CACHE_MAX) {
      const oldestKey = this.geocodeCache.keys().next().value;
      this.geocodeCache.delete(oldestKey);
    }
    this.geocodeCache.set(key, {
      value,
      expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
    });
  }

  generateAddressVariations(address) {
    const variations = [address];

    const matchedSuffix = ADDRESS_SUFFIXES.find(
      suffix => address.length > suffix.length && address.endsWith(suffix)
    );
    if (matchedSuffix) {
      const withoutSuffix = address.slice(0, -matchedSuffix.length).trim();
      if (withoutSuffix) {
        variations.push(withoutSuffix);
      }
    }

    const city = this.extractCityName(address);
    const cityPrefixMatch = address.match(/^(.+?[市区县]|北京|上海|天津|重庆)(.+)$/);
    if (cityPrefixMatch) {
      const rest = cityPrefixMatch[2].trim();
      if (rest.length >= 2 && !/^[市区县镇]/.test(rest)) {
        variations.push(rest);
      }
    } else if (city && !address.startsWith(city)) {
      variations.push(`${city}${address}`);
    }

    return [...new Set(variations)].filter(Boolean);
  }

  async geocodeByCity(address) {
    try {
      const cityName = this.extractCityName(address);
      if (!cityName) {
        return null;
      }

      const encodedCityName = encodeURIComponent(cityName);
      const url = `https://restapi.amap.com/v3/geocode/geo?key=${this.apiKey}&address=${encodedCityName}`;

      const data = await this.httpGet(url);
      const result = JSON.parse(data);

      if (
        result.status === '1' &&
        result.geocodes &&
        result.geocodes.length > 0
      ) {
        const location = result.geocodes[0].location.split(',');
        const adcode = result.geocodes[0].adcode;
        return {
          longitude: parseFloat(location[0]),
          latitude: parseFloat(location[1]),
          adcode: adcode,
        };
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  getCityAdcode(adcode) {
    if (!adcode) return '440100';
    return DISTRICT_TO_CITY[adcode] || adcode.substring(0, 2) + '0000';
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

  normalizeAddress(address) {
    if (!address) return address;

    let normalized = address.trim();

    normalized = normalized.replace(/[，。！？；：]/g, '').trim();

    const addressAliasMap = {
      大学城南: '大学城南地铁站',
      大学城北: '大学城北地铁站',
      广州南站: '广州南地铁站',
      广州东站: '广州东地铁站',
      广州站: '广州地铁站',
      体育西路: '体育西路地铁站',
      客村: '客村地铁站',
      珠江新城: '珠江新城地铁站',
      天河客运站: '天河客运站地铁站',

      广州塔: '广州塔',
      小蛮腰: '广州塔',
      白云山: '白云山',
      云台花园: '云台花园',
      北京路: '北京路步行街',
      上下九: '上下九步行街',

      体育场: '体育中心',
      体育馆: '体育中心',
      天河体育中心: '天河体育中心',
      广州体育中心: '广州体育中心',
      大湾区体育中心: '广州大湾区文化体育中心',

      华工: '华南理工大学',
      华农: '华南农业大学',
      中大: '中山大学',
      华师: '华南师范大学',
      暨大: '暨南大学',

      天河城: '天河城',
      正佳广场: '正佳广场',
      太古汇: '太古汇',
      万菱汇: '万菱汇',

      广州南站: '广州南站',
      广州东站: '广州东站',
      白云机场: '广州白云国际机场',
      南沙港: '广州南沙港',

      越秀公园: '越秀公园',
      流花湖公园: '流花湖公园',
      麓湖公园: '麓湖公园',
      天河公园: '天河公园',
    };

    for (const [alias, fullName] of Object.entries(addressAliasMap)) {
      if (normalized.includes(alias)) {
        normalized = normalized.replace(alias, fullName);
        break;
      }
    }

    const suffixMap = {
      地铁站: '地铁站',
      站: '地铁站',
      广场: '广场',
      大厦: '大厦',
      酒店: '酒店',
      公园: '公园',
      花园: '花园',
      中心: '中心',
      医院: '医院',
      学校: '学校',
      大学: '大学',
      学院: '学院',
      商场: '商场',
      步行街: '步行街',
      街道: '街道',
      路: '路',
      街: '街',
      巷: '巷',
      弄: '弄',
      村: '村',
      社区: '社区',
      小区: '小区',
      大厦: '大厦',
      写字楼: '写字楼',
      酒店: '酒店',
      宾馆: '宾馆',
      饭店: '饭店',
      餐厅: '餐厅',
      咖啡厅: '咖啡厅',
      酒吧: '酒吧',
      KTV: 'KTV',
      电影院: '电影院',
      剧院: '剧院',
      体育馆: '体育馆',
      体育场: '体育场',
      游泳馆: '游泳馆',
      健身房: '健身房',
      医院: '医院',
      诊所: '诊所',
      药店: '药店',
      银行: '银行',
      邮局: '邮局',
      超市: '超市',
      便利店: '便利店',
      加油站: '加油站',
      停车场: '停车场',
      加油站: '加油站',
      汽车站: '汽车站',
      火车站: '火车站',
      机场: '机场',
      港口: '港口',
      码头: '码头',
      公园: '公园',
      花园: '花园',
      植物园: '植物园',
      动物园: '动物园',
      博物馆: '博物馆',
      美术馆: '美术馆',
      图书馆: '图书馆',
      科技馆: '科技馆',
      少年宫: '少年宫',
      文化宫: '文化宫',
      体育馆: '体育馆',
      体育场: '体育场',
      游泳馆: '游泳馆',
      健身房: '健身房',
      学校: '学校',
      幼儿园: '幼儿园',
      小学: '小学',
      中学: '中学',
      大学: '大学',
      学院: '学院',
      研究院: '研究院',
      研究所: '研究所',
      实验室: '实验室',
      公司: '公司',
      企业: '企业',
      工厂: '工厂',
      工地: '工地',
      仓库: '仓库',
      物流中心: '物流中心',
      批发市场: '批发市场',
      零售市场: '零售市场',
      商场: '商场',
      购物中心: '购物中心',
      步行街: '步行街',
      商业街: '商业街',
      店铺: '店铺',
      商店: '商店',
      门店: '门店',
      摊位: '摊位',
      摊位: '摊位',
      摊点: '摊点',
      摊位: '摊位',
      摊点: '摊点',
      摊位: '摊位',
      摊点: '摊点',
      摊位: '摊位',
      摊点: '摊点',
    };

    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }

  getDefaultLocation(address) {
    for (const city in CITY_CENTERS) {
      if (address.includes(city)) {
        return CITY_CENTERS[city];
      }
    }

    return CITY_CENTERS['广州'];
  }

  async driving(origin, destination, extensions = 'all', strategy = 10) {
    try {
      const url = `https://restapi.amap.com/v3/direction/driving?key=${this.apiKey}&origin=${origin.longitude},${origin.latitude}&destination=${destination.longitude},${destination.latitude}&extensions=${extensions}&strategy=${strategy}`;

      const data = await this.httpGet(url);
      const result = JSON.parse(data);

      if (
        result.status === '1' &&
        result.route &&
        result.route.paths &&
        result.route.paths.length > 0
      ) {
        const path = result.route.paths[0];
        const duration = Math.round(path.duration / 60);
        const distance = path.distance;
        const tolls =
          path.tolls !== undefined && path.tolls > 0
            ? path.tolls
            : Math.round((parseInt(distance) / 1000) * 1.05);
        const cost = tolls;

        let roadNames = [];
        let trafficLights = 0;
        if (path.steps && path.steps.length > 0) {
          const roads = new Set();
          path.steps.forEach((step) => {
            if (
              step.road_name &&
              step.road_name !== '' &&
              step.road_name !== '无名路'
            ) {
              roads.add(step.road_name);
            }
          });
          roadNames = Array.from(roads).slice(0, 5);

          path.steps.forEach((step) => {
            if (step.traffic_lights !== undefined) {
              trafficLights += step.traffic_lights;
            }
          });
        }

        return {
          type: '驾车',
          duration: `${duration}分钟`,
          cost: `¥${cost}`,
          distance: distance,
          roadNames: roadNames,
          trafficLights: trafficLights,
          path: path,
        };
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  async transit(
    origin,
    destination,
    originCity,
    destinationCity,
    maxResults = 3
  ) {
    try {
      const city = originCity || '广州';
      const cityd = destinationCity || '广州';
      const url = `https://restapi.amap.com/v3/direction/transit/integrated?key=${this.apiKey}&origin=${origin.longitude},${origin.latitude}&destination=${destination.longitude},${destination.latitude}&city=${encodeURIComponent(city)}&cityd=${encodeURIComponent(cityd)}&nightflag=0&strategy=10`;
      debug.log(` transit API URL: ${MCP.maskApiKey(url)}`);

      const data = await this.httpGet(url);
      const result = JSON.parse(data);

      if (
        result.status === '1' &&
        result.route &&
        result.route.transits &&
        result.route.transits.length > 0
      ) {
        const transitResults = [];
        const transitsToProcess = result.route.transits.slice(0, maxResults);

        transitsToProcess.forEach((transit, index) => {
          const duration = Math.round(transit.duration / 60);
          const distance = transit.distance;
          const cost = transit.cost && transit.cost !== '' ? transit.cost : 2;

          let totalWalkingTime = 0;
          let totalWalkingDistance = 0;
          const walkingDetails = [];

          const metroLines = [];
          const metroDetails = [];

          const segments = [];
          const structuredSteps = [];
          if (transit.segments) {
            transit.segments.forEach((segment) => {
              if (segment.walking) {
                let walkDist = parseInt(segment.walking.distance) || 0;
                let walkTime = parseInt(segment.walking.duration) || 0;

                if (walkTime > 1000000) {
                  walkTime = Math.round(walkTime / 1000);
                }
                if (walkDist > 100000) {
                  walkDist = Math.round(walkDist / 100);
                }

                totalWalkingDistance += walkDist;
                totalWalkingTime += walkTime;

                if (walkDist > 0) {
                  walkingDetails.push(
                    `步行${Math.round(walkDist / 100) * 100}米`
                  );
                }

                const isLastSegment =
                  transit.segments.indexOf(segment) ===
                  transit.segments.length - 1;
                if (isLastSegment) {
                  segments.push(`步行${walkDist}米到目的地`);
                  structuredSteps.push({
                    type: 'walk',
                    distance_meters: walkDist,
                    distance_km: walkDist / 1000,
                    duration_minutes: Math.round(walkTime / 60),
                  });
                } else if (walkDist > 50) {
                  segments.push(`步行${walkDist}米到车站`);
                  structuredSteps.push({
                    type: 'walk',
                    distance_meters: walkDist,
                    distance_km: walkDist / 1000,
                    duration_minutes: Math.round(walkTime / 60),
                  });
                }
              }

              if (segment.bus) {
                segment.bus.buslines.forEach((busline) => {
                  let name = busline.name || '未知线路';

                  let passStops = '若干';
                  if (busline.via_num && busline.via_num > 0) {
                    passStops = busline.via_num;
                  } else if (busline.pass_stops) {
                    if (Array.isArray(busline.pass_stops)) {
                      passStops = busline.pass_stops.length;
                    } else if (
                      typeof busline.pass_stops === 'number' &&
                      busline.pass_stops > 0
                    ) {
                      passStops = busline.pass_stops;
                    }
                  }

                  if (name.includes('地铁')) {
                    const startStop = busline.departure_stop?.name || '起点站';
                    const endStop = busline.arrival_stop?.name || '终点站';
                    const lineName = name
                      .replace(/^[地铁\s]+/, '')
                      .replace(/[`#*_[\]]/g, '');
                    segments.push(
                      `地铁${lineName}(${startStop}→${endStop})，经过${passStops}站`
                    );
                    metroLines.push(lineName);
                    metroDetails.push({
                      line: lineName,
                      start: startStop,
                      end: endStop,
                      stops: passStops,
                    });
                    structuredSteps.push({
                      type: 'metro',
                      line: lineName,
                      direction: `${startStop}→${endStop}`,
                      start: startStop,
                      end: endStop,
                      stops: passStops,
                    });
                  } else if (name !== '未知线路' && !name.includes('城际')) {
                    if (!name.includes('(') && !name.includes('（')) {
                      const startStop =
                        busline.departure_stop?.name || '起点站';
                      const endStop = busline.arrival_stop?.name || '终点站';
                      segments.push(
                        `公交${name}(${startStop}→${endStop})，经过${passStops}站`
                      );
                      structuredSteps.push({
                        type: 'bus',
                        line: name,
                        direction: `${startStop}→${endStop}`,
                        start: startStop,
                        end: endStop,
                        stops: passStops,
                      });
                    } else {
                      segments.push(`公交${name}，经过${passStops}站`);
                      structuredSteps.push({
                        type: 'bus',
                        line: name,
                        direction: '',
                        start: '起点站',
                        end: '终点站',
                        stops: passStops,
                      });
                    }
                  }
                });
              }

              if (segment.railway) {
                const name = segment.railway.name || '未知线路';
                if (name !== '未知线路') {
                  const viaNum =
                    segment.railway.via_num && segment.railway.via_num > 0
                      ? segment.railway.via_num
                      : '若干';
                  const startStation =
                    segment.railway.departure_station || '起点站';
                  const arrivalStation =
                    segment.railway.arrival_station || '目的地站';
                  segments.push(
                    `火车${name}(${startStation}→${arrivalStation})，经过${viaNum}站`
                  );
                  structuredSteps.push({
                    type: 'railway',
                    line: name,
                    direction: `${startStation}→${arrivalStation}`,
                    start: startStation,
                    end: arrivalStation,
                    stops: viaNum,
                  });
                }
              }
            });
          }

          const ridingTime = Math.max(0, transit.duration - totalWalkingTime);
          const ridingTimeMinutes = Math.round(ridingTime / 60);

          let type = '公交';
          let recommendedReason = '';
          if (metroLines.length > 0) {
            type = '公共交通';
            if (walkingDetails.length > 0) {
              recommendedReason = `地铁+步行，含${metroLines.length}条地铁线`;
            } else {
              recommendedReason = `纯地铁出行，乘坐${metroLines.join('、')}`;
            }
          }

          let estimatedCost = 2;
          const distanceKm = parseInt(distance) / 1000;
          const metroCount = metroLines.length;

          if (metroCount > 0) {
            estimatedCost = 2 + Math.floor(distanceKm * 0.45);
            if (estimatedCost > 25) estimatedCost = 25;
            if (estimatedCost < 2) estimatedCost = 2;
          } else {
            estimatedCost = 2 + Math.floor(distanceKm * 0.25);
            if (estimatedCost > 8) estimatedCost = 8;
            if (estimatedCost < 2) estimatedCost = 2;
          }

          let displayCost = '¥2';
          let originalCost = null;

          if (cost && !isNaN(cost) && cost > 0) {
            originalCost = parseInt(cost);
            displayCost = `¥${originalCost}`;
          } else if (
            transit.cost &&
            transit.cost !== '' &&
            !isNaN(transit.cost)
          ) {
            originalCost = parseInt(transit.cost);
            displayCost = `¥${originalCost}`;
          }

          if (
            originalCost &&
            originalCost < estimatedCost * 0.5 &&
            distanceKm > 20
          ) {
            displayCost = `¥${estimatedCost}`;
            console.log(
              `费用估算: API返回¥${originalCost}，估算¥${estimatedCost}，使用估算值`
            );
          } else if (!originalCost || originalCost <= 0) {
            displayCost = `¥${estimatedCost}`;
            console.log(
              `费用估算: 距离${distanceKm.toFixed(1)}公里，${metroCount}条地铁，估算¥${estimatedCost}`
            );
          }

          const timeBreakdown = [];
          if (walkingDetails.length > 0) {
            timeBreakdown.push(...walkingDetails);
          }
          if (metroDetails.length > 0) {
            metroDetails.forEach((m) => {
              timeBreakdown.push(`地铁${m.line} ${m.start}→${m.end}`);
            });
          }

          transitResults.push({
            type: type,
            duration: `${duration}分钟`,
            cost: displayCost,
            distance: distance,
            transfers: segments,
            structuredSteps: structuredSteps,
            walkingTime: Math.round(totalWalkingTime / 60),
            walkingDistance: totalWalkingDistance,
            ridingTime: ridingTimeMinutes,
            metroLines: metroLines,
            metroDetails: metroDetails,
            timeBreakdown: timeBreakdown,
            recommendedReason: recommendedReason,
            isRecommended: index === 0 && metroLines.length > 0,
          });
        });

        return transitResults;
      } else {
        return null;
      }
    } catch (error) {
      debug.error('[DEBUG] 公交 API 解析错误:', error.message);
      return null;
    }
  }

  async walking(origin, destination) {
    try {
      const url = `https://restapi.amap.com/v3/direction/walking?key=${this.apiKey}&origin=${origin.longitude},${origin.latitude}&destination=${destination.longitude},${destination.latitude}`;

      const data = await this.httpGet(url);
      const result = JSON.parse(data);

      if (
        result.status === '1' &&
        result.route &&
        result.route.paths &&
        result.route.paths.length > 0
      ) {
        const path = result.route.paths[0];
        const duration = Math.round(path.duration / 60);
        const distance = path.distance;

        return {
          type: '步行',
          duration: `${duration}分钟`,
          cost: '¥0',
          distance: distance,
        };
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  async bicycling(origin, destination) {
    try {
      const url = `https://restapi.amap.com/v3/direction/bicycling?key=${this.apiKey}&origin=${origin.longitude},${origin.latitude}&destination=${destination.longitude},${destination.latitude}`;

      const data = await this.httpGet(url);
      const result = JSON.parse(data);

      if (
        result.status === '1' &&
        result.route &&
        result.route.paths &&
        result.route.paths.length > 0
      ) {
        const path = result.route.paths[0];
        const duration = Math.round(path.duration / 60);
        const distance = path.distance;

        return {
          type: '骑行',
          duration: `${duration}分钟`,
          cost: '¥0',
          distance: distance,
        };
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  calculateDistance(origin, destination) {
    const R = 6371;
    const dLat = this.deg2rad(destination.latitude - origin.latitude);
    const dLon = this.deg2rad(destination.longitude - origin.longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(origin.latitude)) *
        Math.cos(this.deg2rad(destination.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
  }

  deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  getCityDistance(originCity, destinationCity) {
    const key1 = `${originCity}-${destinationCity}`;
    const key2 = `${destinationCity}-${originCity}`;

    return CITY_DISTANCES[key1] || CITY_DISTANCES[key2] || 100;
  }

  async getDirections(
    originAddress,
    destinationAddress,
    originCoord = null,
    destCoord = null
  ) {
    debug.log('[DEBUG] getDirections 方法被调用');
    debug.log('[DEBUG] originAddress:', originAddress);
    debug.log('[DEBUG] destinationAddress:', destinationAddress);
    debug.log('[DEBUG] originCoord:', originCoord);
    debug.log('[DEBUG] destCoord:', destCoord);
    try {
      const originCity = this.extractCityName(originAddress);
      const destinationCity = this.extractCityName(destinationAddress);

      const isSameCity = originCity === destinationCity;

      const originHub = this.getMainTransportHub(originCity, originAddress);
      const destinationHub = this.getMainTransportHub(
        destinationCity,
        destinationAddress
      );

      debug.log(
        ` 提取城市: originCity=${originCity}, destinationCity=${destinationCity}`
      );
      debug.log(` isSameCity=${isSameCity}`);
      debug.log(
        ` 交通枢纽: originHub=${JSON.stringify(originHub)}, destinationHub=${JSON.stringify(destinationHub)}`
      );

      const directions = [];

      const cityDistance = this.getCityDistance(originCity, destinationCity);
      debug.log(` 城市间距离: ${cityDistance}km`);

      if (cityDistance >= 500) {
        debug.log('[DEBUG] 长途出行，生成高铁和飞机方案');
        const trainDuration = Math.round((cityDistance / 250) * 60);
        const trainCost = Math.round(cityDistance * 0.55);
        directions.push({
          type: '高铁',
          duration: `${trainDuration}分钟`,
          cost: `¥${trainCost}`,
          distance: `${Math.round(cityDistance * 1000)}`,
          transfers: [
            `步行或打车到${originHub.railway}`,
            `乘坐高铁（车次以12306实时查询为准，耗时与票价为估算），在${destinationHub.railway}下车`,
            '步行或打车到目的地',
          ],
          structuredSteps: [
            {
              type: 'walk',
              distance_meters: 500,
              duration_minutes: 6,
            },
            {
              type: 'train',
              line: '高铁（班次以12306实时查询为准）',
              start: originHub.railway,
              end: destinationHub.railway,
              duration_minutes: trainDuration,
            },
            {
              type: 'walk',
              distance_meters: 500,
              duration_minutes: 6,
            },
          ],
        });

        const flightDuration = Math.round((cityDistance / 650) * 60);
        const totalFlightDuration = 120 + flightDuration + 30;
        const flightCost = Math.round(200 + cityDistance * 0.35);
        directions.push({
          type: '飞机',
          duration: `${totalFlightDuration}分钟`,
          cost: `¥${flightCost}`,
          distance: `${Math.round(cityDistance * 1000)}`,
          transfers: [
            `步行或打车到${originHub.airport}（建议提前2小时到达）`,
            `乘坐航班（航班号以航司/票务平台实时查询为准，耗时与票价为估算），在${destinationHub.airport}降落`,
            '落地后约30分钟出站，步行或打车到目的地',
          ],
          structuredSteps: [
            {
              type: 'walk',
              distance_meters: 1000,
              duration_minutes: 12,
            },
            {
              type: 'plane',
              line: '航班（班次以实时查询为准）',
              start: originHub.airport,
              end: destinationHub.airport,
              duration_minutes: totalFlightDuration,
            },
            {
              type: 'walk',
              distance_meters: 1000,
              duration_minutes: 12,
            },
          ],
        });
      }

      let origin = originCoord;
      let destination = destCoord;

      if (!origin) {
        debug.log('[DEBUG] 调用地理编码 API 获取起点坐标');
        origin = await this.geocode(originAddress);
      } else {
        debug.log('[DEBUG] 使用传入的起点坐标');
      }

      if (!destination) {
        debug.log('[DEBUG] 调用地理编码 API 获取终点坐标');
        destination = await this.geocode(destinationAddress);
      } else {
        debug.log('[DEBUG] 使用传入的终点坐标');
      }
      debug.log('[DEBUG] 地理编码完成');

      if (!origin) {
        debug.log('[DEBUG] 起点地理编码失败，尝试使用降级坐标');
        origin = this.getDefaultLocation(originAddress);
        if (origin) {
          debug.log('[DEBUG] 使用降级坐标作为起点:', origin);
        } else {
          debug.log('[DEBUG] 无法获取起点降级坐标');
        }
      }

      if (!destination) {
        debug.log('[DEBUG] 终点地理编码失败，尝试使用降级坐标');
        destination = this.getDefaultLocation(destinationAddress);
        if (destination) {
          debug.log('[DEBUG] 使用降级坐标作为终点:', destination);
        } else {
          debug.log('[DEBUG] 无法获取终点降级坐标');
        }
      }

      if (!origin || !destination) {
        debug.log('[DEBUG] 地理编码失败且无法获取降级坐标，返回空数组');
        return [];
      }

      const distance = this.calculateDistance(origin, destination);
      debug.log(` 直线距离计算: ${distance}km`);
      debug.log(` 起点坐标: ${origin.longitude}, ${origin.latitude}`);
      debug.log(` 终点坐标: ${destination.longitude}, ${destination.latitude}`);

      if (isSameCity && distance > 200) {
        console.log(`[WARN] 同城距离异常: ${distance}km，可能是地理编码错误`);
      }
      if (
        !isSameCity &&
        this.isSameProvince(originAddress, destinationAddress) &&
        distance > 500
      ) {
        console.log(`[WARN] 跨市距离异常: ${distance}km`);
      }
      if (
        !this.isSameProvince(originAddress, destinationAddress) &&
        distance > 3000
      ) {
        console.log(`[WARN] 跨省距离异常: ${distance}km`);
      }

      debug.log('[DEBUG] 调用驾车 API');
      try {
        const drivingResult = await this.driving(
          origin,
          destination,
          'all',
          10
        );
        debug.log('[DEBUG] 驾车结果:', drivingResult);
        if (drivingResult) {
          const drivingDistance = parseInt(drivingResult.distance) / 1000;
          debug.log(` 驾车距离: ${drivingDistance}km, 直线距离: ${distance}km`);

          let maxDistanceRatio = 1.5;
          if (isSameCity && distance < 10) {
            maxDistanceRatio = 3;
          } else if (isSameCity) {
            maxDistanceRatio = 2;
          }

          debug.log(` 阈值: ${distance * maxDistanceRatio}km`);
          if (drivingDistance <= distance * maxDistanceRatio) {
            if (!drivingResult.structuredSteps) {
              drivingResult.structuredSteps = [
                {
                  type: 'drive',
                  start: originAddress,
                  end: destinationAddress,
                  duration_minutes: parseInt(drivingResult.duration),
                  distance_meters: parseInt(drivingResult.distance),
                },
              ];
            }
            directions.push(drivingResult);
            debug.log('[DEBUG] 驾车方案已添加');
          } else {
            debug.log('[DEBUG] 驾车距离超过阈值，被过滤');
          }
        }
      } catch (error) {
        debug.error('[DEBUG] 驾车 API 调用失败:', error.message);
      }

      if (isSameCity || distance < 500) {
        debug.log('[DEBUG] 调用公交 API');
        let transitResults = null;

        try {
          transitResults = await this.transit(
            origin,
            destination,
            originCity,
            destinationCity
          );
          debug.log('[DEBUG] 公交结果:', transitResults);

          if ((!transitResults || transitResults.length === 0) && isSameCity) {
            debug.log('[DEBUG] 公交 API 返回空，尝试简化地址重新查询');
            const simplifiedOrigin = originAddress.replace(
              /.*(\w+地铁站).*/,
              '$1'
            );
            const simplifiedDest = destinationAddress.replace(
              /.*(\w+地铁站).*/,
              '$1'
            );

            if (
              simplifiedOrigin !== originAddress ||
              simplifiedDest !== destinationAddress
            ) {
              debug.log(
                '[DEBUG] 使用简化地址重新查询:',
                simplifiedOrigin,
                '→',
                simplifiedDest
              );
              const simplifiedOriginGeo = await this.geocode(simplifiedOrigin);
              const simplifiedDestGeo = await this.geocode(simplifiedDest);

              if (simplifiedOriginGeo && simplifiedDestGeo) {
                transitResults = await this.transit(
                  simplifiedOriginGeo,
                  simplifiedDestGeo,
                  originCity,
                  destinationCity
                );
                debug.log('[DEBUG] 简化地址查询结果:', transitResults);
              }
            }
          }

          if (transitResults && transitResults.length > 0) {
            transitResults.forEach((transit, index) => {
              if (
                transit.metroLines &&
                transit.metroLines.length > 0 &&
                index === 0
              ) {
                transit.isRecommended = true;
              }
              directions.push(transit);
            });
          } else if (isSameCity) {
            debug.log('[DEBUG] 同城出行公交查询失败，添加提示信息');
            directions.push({
              type: '公共交通',
              duration: '未知',
              cost: '未知',
              distance: '未知',
              transfers: [
                '检测到同城出行，建议使用地铁',
                '但具体线路查询失败，请使用本地地图APP查询',
                '或尝试使用更精确的地铁站名',
              ],
            });
          }
        } catch (error) {
          debug.error('[DEBUG] 公交 API 调用失败:', error.message);
          if (isSameCity) {
            directions.push({
              type: '公共交通',
              duration: '未知',
              cost: '未知',
              distance: '未知',
              transfers: [
                '检测到同城出行，建议使用地铁',
                '但具体线路查询失败，请使用本地地图APP查询',
                '或尝试使用更精确的地铁站名',
              ],
            });
          }
        }
      } else {
        debug.log(
          ` 跳过公交 API（isSameCity=${isSameCity}, distance=${distance}）`
        );
      }

      if (distance < 50) {
        debug.log('[DEBUG] 调用骑行 API');
        try {
          const bicyclingResult = await this.bicycling(origin, destination);
          debug.log('[DEBUG] 骑行结果:', bicyclingResult);
          if (bicyclingResult) {
            directions.push(bicyclingResult);
          }
        } catch (error) {
          debug.error('[DEBUG] 骑行 API 调用失败:', error.message);
        }
      } else {
        debug.log(
          ` 跳过骑行 API（distance=${distance} >= 50km，距离过远不支持骑行）`
        );
      }

      if (distance < 10) {
        debug.log('[DEBUG] 调用步行 API');
        try {
          const walkingResult = await this.walking(origin, destination);
          debug.log('[DEBUG] 步行结果:', walkingResult);
          if (walkingResult) {
            directions.push(walkingResult);
          }
        } catch (error) {
          debug.error('[DEBUG] 步行 API 调用失败:', error.message);
        }
      } else {
        debug.log(` 跳过步行 API（distance=${distance} >= 10km）`);
      }

      debug.log(` 最终路线方案数量: ${directions.length}`);

      if (directions.length === 0) {
        return [];
      }

      return directions;
    } catch (error) {
      debug.error('[DEBUG] getDirections 发生错误:', error.message || error);
      debug.error('[DEBUG] 错误堆栈:', error.stack);
      return [];
    }
  }

  async getDirectionsByCoordinates(originCoord, destCoord) {
    try {
      let origin, destination;
      if (
        typeof originCoord === 'object' &&
        originCoord.longitude &&
        originCoord.latitude
      ) {
        origin = originCoord;
        destination = destCoord;
      } else {
        const [originLon, originLat] = originCoord.split(',').map(Number);
        const [destLon, destLat] = destCoord.split(',').map(Number);
        origin = { longitude: originLon, latitude: originLat };
        destination = { longitude: destLon, latitude: destLat };
      }

      const distance = this.calculateDistance(origin, destination);


      const directions = [];

      const drivingResult = await this.driving(origin, destination, 'all', 10);
      if (drivingResult) {
        directions.push(drivingResult);
      }

      if (distance < 500) {
        const transitResults = await this.transit(
          origin,
          destination,
          null,
          null
        );
        if (transitResults && transitResults.length > 0) {
          transitResults.forEach((transit) => {
            directions.push(transit);
          });
        }
      }

      if (distance < 50) {
        const bicyclingResult = await this.bicycling(origin, destination);
        if (bicyclingResult) {
          directions.push(bicyclingResult);
        }
      }

      if (distance < 10) {
        const walkingResult = await this.walking(origin, destination);
        if (walkingResult) {
          directions.push(walkingResult);
        }
      }

      if (directions.length === 0) {
        return [];
      }

      return directions;
    } catch (error) {
      return [];
    }
  }

  getDefaultLocation(address) {
    const cityName = this.extractCityName(address);
    const cityCenter = CITY_CENTERS[cityName];
    return cityCenter
      ? { longitude: cityCenter.longitude, latitude: cityCenter.latitude }
      : null;
  }

  getMainTransportHub(city, address) {
    const hub = TRANSPORT_HUBS[city];
    if (hub) {
      return {
        railway: hub.railway,
        airport:
          typeof hub.airport === 'function'
            ? hub.airport(address)
            : hub.airport,
      };
    }
    return {
      railway: `${city}站`,
      airport: `${city}机场`,
    };
  }

  isSameProvince(address1, address2) {
    for (const province of PROVINCES) {
      if (address1.includes(province) && address2.includes(province)) {
        return true;
      }
    }

    return false;
  }

  async searchNearby(location, keywords, radius = 500, limit = 5) {
    try {
      if (!location || !location.longitude || !location.latitude) {
        return [];
      }

      const locationStr = `${location.longitude},${location.latitude}`;
      const encodedKeywords = encodeURIComponent(keywords);
      const url = `https://restapi.amap.com/v3/place/around?key=${this.apiKey}&location=${locationStr}&keywords=${encodedKeywords}&radius=${radius}&offset=${limit}&sortrule=distance`;

      const data = await this.httpGet(url);
      const result = JSON.parse(data);

      if (result.status === '1' && result.pois && result.pois.length > 0) {
        return result.pois
          .map((poi) => ({
            name: poi.name,
            address: poi.address || '',
            distance: parseInt(poi.distance) || 0,
            location: {
              longitude: parseFloat(poi.location.split(',')[0]),
              latitude: parseFloat(poi.location.split(',')[1]),
            },
            tel: poi.tel || '',
            type: poi.type || '',
          }))
          .slice(0, limit);
      } else {
        return [];
      }
    } catch (error) {
      console.error('POI搜索失败:', error);
      return [];
    }
  }
}

module.exports = MCP;
