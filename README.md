<div align="center">

# Travel Assistant Agent

**基于 MCP 服务与 Skills 能力的智能旅行助手 Agent**

</div>

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D16.0.0-green.svg?style=flat-square&logo=node.js)](https://nodejs.org/)
[![CI/CD](https://img.shields.io/badge/CI-GitHub%20Actions-blue.svg?style=flat-square&logo=githubactions)](.github/workflows/ci-cd.yml)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?style=flat-square&logo=docker)](docker-compose.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/your-username/travel-assistant/pulls)

</div>

一个集成 **路线规划 / 天气查询 / 周边搜索 / 多轮对话** 的智能旅行助手。通过 LLM 理解用户意图，调度地图与天气等外部能力，并通过 Skills 插件化机制对外提供统一对话入口。

> [!IMPORTANT]
> **首次运行前必须先配置 API 密钥。**
> 本项目依赖第三方服务，`npm install` 与 `npm start` **不会**自动获取密钥。请先在根目录创建 `.env` 并填入
> `MAP_API_KEY`、`WEATHER_API_KEY`、`LLM_API_KEY`，否则路线规划、天气查询、多轮对话等能力会直接报错或降级不可用。
> 详见 [环境变量](#环境变量)。

> [!CAUTION]
> `.env` 已被 `.gitignore` 忽略，**切勿将密钥提交到仓库**。若密钥曾外泄，请立即到对应平台重新生成。

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [项目结构](#项目结构)
- [API 文档](#api-文档)
- [Docker 部署](#docker-部署)
- [测试与代码检查](#测试与代码检查)
- [技术栈](#技术栈)
- [许可证](#许可证)

---

## 功能特性

| 功能 | 说明 |
| :--- | :--- |
| **路线规划** | 输入起点与终点，调用地图 API 规划出行路线 |
| **多方案推荐** | 输出驾车 / 公交 / 步行等多种方案，并基于时间、成本、便捷性给出最优推荐 |
| **天气查询** | 查询指定城市天气，并生成出行建议 |
| **周边搜索** | 按关键词搜索指定地点附近的 POI（餐饮、景点等） |
| **多轮对话** | 基于会话上下文理解指代与追问（如 "那明天呢？"） |
| **会话安全** | 服务端签发并校验会话 Token，避免会话被枚举 / 冒用 |
| **Skills 机制** | 意图 → 技能路由，`SkillManager` 统一管理，便于横向扩展 |
| **输入防护** | 输入清洗与长度限制，`/api/*` 统一按 IP 限流（超限返回 `429`） |

---

## 快速开始

### 1. 环境要求

- **Node.js** >= 16.0.0
- **npm** >= 7.0.0

### 2. 克隆与安装

```bash
git clone https://github.com/your-username/travel-assistant.git
cd travel-assistant
npm install
```

### 3. 配置环境变量（必做）

> [!IMPORTANT]
> 这一步是运行前置条件，跳过会导致地图、天气、对话接口全部不可用。

在项目根目录创建 `.env` 文件（**请勿提交到仓库**）：

```dotenv
# 运行环境
NODE_ENV=development

# API 密钥
MAP_API_KEY=your_amap_api_key
WEATHER_API_KEY=your_qweather_api_key
LLM_API_KEY=your_llm_api_key
SILICON_FLOW_API_KEY=your_siliconflow_api_key

# 服务配置
PORT=3001

# 日志：silent / error / warn / info / debug，缺省 info（DEBUG=true 等价于 debug）
DEBUG=false
LOG_LEVEL=info
```

#### 密钥从哪里获取

| 变量 | 申请地址 | 类型 |
| :--- | :--- | :--- |
| `MAP_API_KEY` | [高德开放平台](https://console.amap.com/dev/key/app) → 创建应用 → 添加 Key → 服务平台选 **Web服务** | 必填 |
| `WEATHER_API_KEY` | [和风天气控制台](https://console.qweather.com/) → 项目管理 → 创建 Key → 订阅类型选 **Web API** | 必填 |
| `LLM_API_KEY` | 所用 LLM 服务商控制台（如 [Silicon Flow](https://cloud.siliconflow.cn/)） | 必填 |
| `SILICON_FLOW_API_KEY` | [Silicon Flow](https://cloud.siliconflow.cn/) → API 密钥 | 可选 |

> [!WARNING]
> 未配置 `MAP_API_KEY` / `WEATHER_API_KEY` / `LLM_API_KEY` 时：
> - 路线规划、周边搜索、逆地理编码会失败
> - 天气查询不可用
> - 多轮对话退化为关键词兜底，无法理解自然语言意图

配置完成后可执行 `node -e "require('./src/config/env')"` 快速确认 `.env` 是否被正确加载（值为 `undefined` 说明变量名写错或文件未放在根目录）。

### 4. 启动

```bash
# 命令行示例：依次演示路线规划、天气查询、周边搜索
npm run dev

# 启动 HTTP 服务
npm start
```

服务启动后访问 <http://localhost:3001> 即可使用内置 Web 界面。

### 5. 以模块方式调用

```javascript
const TravelAssistant = require('./src/core/main');

(async () => {
  const assistant = new TravelAssistant();

  // 路线规划
  const route = await assistant.planRoute('北京', '上海');
  console.log(route);

  // 自然语言意图处理
  const weather = await assistant.processUserInput('北京天气如何');
  console.log(weather);

  // 周边搜索
  const nearby = await assistant.searchNearby('北京天安门', '餐厅');
  console.log(nearby);
})();
```

---

## 环境变量

> [!IMPORTANT]
> 变量表中「必填」列为 `是` 的密钥为**运行必需项**，必须在 `.env` 中配置后服务才能正常工作。申请方式见 [密钥从哪里获取](#密钥从哪里获取)。
> `.env` 需在进程启动时加载，**修改后必须重启服务**才会生效。

| 变量 | 必填 | 默认值 | 说明 |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | 否 | `development` | 运行环境，生产建议 `production` |
| `MAP_API_KEY` | 是 | — | 高德地图 Web 服务 Key |
| `WEATHER_API_KEY` | 是 | — | 和风天气 Key |
| `LLM_API_KEY` | 是 | — | LLM 服务 Key |
| `SILICON_FLOW_API_KEY` | 否 | — | Silicon Flow Key（Embedding / 备用模型） |
| `PORT` | 否 | `3001` | HTTP 服务监听端口 |
| `DEBUG` | 否 | `false` | `true` 时等价 `LOG_LEVEL=debug` |
| `LOG_LEVEL` | 否 | `info` | `silent`/`error`/`warn`/`info`/`debug`；`error`、`warn` 输出到 stderr，`key`/`token`/`secret` 类字段自动脱敏 |
| `REDIS_URL` | 否 | — | Redis 连接串（Docker 环境默认 `redis://redis:6379`） |
| `MILVUS_ADDRESS` | 否 | — | Milvus 地址（Docker 环境默认 `milvus:19530`） |

---

## 项目结构

```text
travel-assistant/
├── src/
│   ├── config/           # 配置加载（config.js / env.js）
│   ├── core/             # 核心：TravelAssistant 主类、多轮对话助手
│   ├── server/           # HTTP 服务（server.js）与命令行入口（app.js）
│   ├── services/         # 外部能力：LLM、MCP（地理编码/路线）、天气、向量存储
│   ├── session/          # 会话与对话状态管理
│   ├── skills/           # 技能插件：Route / Weather / POI / GeneralInfo / AskUser / ShowMore
│   └── utils/            # 日志、调试、输入防护、会话 Token
├── test/                 # Jest 测试（core / skills / services / session / utils）
├── docs/                 # 项目文档
├── .github/workflows/    # GitHub Actions CI/CD
├── index.html            # Web 交互页面
├── 404.html              # 404 页面
├── docker-compose.yml    # 应用 + Redis + Milvus
├── docker-compose-milvus.yml
├── Dockerfile
├── index.js              # 示例入口
└── package.json
```

---

## API 文档

所有接口基于 `http://localhost:3001`，请求 / 响应均为 `application/json`。

> `/api/*` 统一按 IP 限流，触发限制时返回 `HTTP 429`。

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/ip-location` | 根据客户端 IP 获取粗略定位 |
| `POST` | `/api/plan-route` | 路线规划 |
| `POST` | `/api/process-input` | 单轮意图识别与处理 |
| `GET` `POST` | `/api/session` | 由服务端签发会话 ID |
| `POST` | `/api/update-location` | 更新会话中的当前位置 |
| `POST` | `/api/reverse-geocode` | 逆地理编码（经纬度 → 行政区地址） |
| `POST` | `/api/chat` | 多轮对话主入口 |

### `POST /api/plan-route`

```jsonc
// Request
{ "origin": "北京", "destination": "上海" }
```

### `POST /api/chat`

```jsonc
// Request
{ "message": "明天适合去爬长城吗", "sessionId": "<由 /api/session 签发>" }

// Response
{ "success": true, "sessionId": "<服务端会话 Token>", "reply": "……" }
```

> 会话 ID 必须由服务端签发（`/api/session`）并回传，无效 ID 会被自动分配新会话，防止会话枚举 / 冒用。

### `POST /api/update-location`

```jsonc
// Request
{ "sessionId": "…", "location": "北京南站", "lat": 39.865, "lng": 116.379 }

// Response
{ "success": true }
```

### `POST /api/reverse-geocode`

```jsonc
// Request
{ "latitude": 39.9087, "longitude": 116.3975 }

// Response
{ "success": true, "location": "北京市东城区东华门街道" }
```

---

## Docker 部署

> [!IMPORTANT]
> `docker-compose.yml` 通过 `env_file` 读取根目录的 `.env`，**容器同样需要密钥**。请先完成 [第 3 步密钥配置](#3-配置环境变量必做)，否则容器内服务会启动但接口全部不可用。

```bash
# 一键启动应用 + Redis + Milvus
docker compose up -d

# 查看运行状态
docker compose ps

# 停止并清理数据卷
docker compose down -v
```

镜像内置健康检查，容器就绪后可访问 `http://localhost:3001`。

---

## 测试与代码检查

```bash
npm test          # 运行 Jest 测试
npm run lint      # ESLint 检查
npm run lint:fix  # 自动修复 ESLint 问题
npm run format    # Prettier 格式化
```

推送到 `main` / `master` 或发起 PR 时，GitHub Actions 会自动执行安装依赖 → Lint → 测试 → 构建。

---

## 技术栈

| 分类 | 选型 |
| :--- | :--- |
| 运行时 | Node.js（原生 `http` 模块） |
| 外部能力 | 高德地图 API、和风天气 API |
| AI | LLM 意图理解、`@xenova/transformers` 本地 Embedding |
| 存储 | Redis（会话）、Milvus / Vectra（向量检索） |
| 工程化 | ESLint、Prettier、Jest、GitHub Actions |
| 部署 | Docker / Docker Compose |

---

---

## 许可证

本项目基于 [MIT License](https://opensource.org/licenses/MIT) 开源，详见 [LICENSE](LICENSE)。

---

<div align="center">

Created by the Travel Assistant team

</div>
