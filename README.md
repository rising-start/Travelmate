# 旅行助手Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-16%2B-blue.svg)](https://nodejs.org/)

一个基于MCP服务与Skills能力的智能旅行助手Agent，提供路线规划、多方案推荐、天气查询、周边搜索等功能，支持多轮对话交互。

## 目录

- [项目简介](#项目简介)
- [核心功能](#核心功能)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [安装与开始](#安装与开始)
- [使用说明](#使用说明)
- [API接口](#api接口)
- [配置管理](#配置管理)
- [技术栈](#技术栈)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

## 项目简介

旅行助手Agent是一个专注于提供智能旅行相关服务的应用，旨在解决用户在旅行过程中的各种需求。它通过整合多种API服务，为用户提供路线规划、天气查询、周边搜索等功能，并支持自然语言交互，让用户能够以更直观的方式获取所需信息。

该项目采用模块化设计，具有良好的可扩展性，可根据需求添加更多功能和服务。

## 核心功能

- **路线规划**：接收当前地址和目的地址，规划可行路线
- **多方案与最优推荐**：提供至少两种出行方案（如驾车、公交、步行），并基于时间/成本/便捷性给出一个最优方案
- **天气查询**：获取指定地点的天气信息和出行建议
- **周边搜索**：搜索指定地点附近的POI（兴趣点）
- **多轮对话**：支持自然语言交互，理解用户意图，提供智能响应
- **HTTP服务器**：提供API接口，支持Web端访问
- **可扩展性**：模块化设计，预留接口以便后续添加更多功能

## 项目结构

```
├── src/                 # 源代码目录
│   ├── core/            # 核心功能模块
│   │   ├── main.js      # TravelAssistant主类
│   │   └── multiTurnTravelAssistant.js # 多轮对话助手
│   ├── services/        # 服务模块
│   │   ├── llm.js        # LLM服务（自然语言理解）
│   │   ├── mcp.js       # MCP服务（地理编码、路线规划等）
│   │   ├── vectorStore.js # 向量存储
│   │   ├── weather.js    # 天气服务
│   │   └── weatherAdvice.js # 天气建议
│   ├── session/         # 会话管理
│   │   ├── conversationSession.js # 会话管理
│   │   └── dialogManager.js # 对话管理
│   ├── skills/          # 技能模块
│   │   ├── AskUserSkill.js # 用户问答技能
│   │   ├── GeneralInfoSkill.js # 通用信息技能
│   │   ├── POISkill.js  # 周边搜索技能
│   │   ├── RouteSkill.js # 路线规划技能
│   │   ├── ShowMoreSkill.js # 显示更多技能
│   │   ├── SkillManager.js # 技能管理
│   │   └── WeatherSkill.js # 天气查询技能
│   ├── utils/           # 工具模块
│   │   └── debug.js     # 调试工具
│   ├── config/          # 配置模块
│   │   ├── config.js    # 配置信息
│   │   └── env.js        # 环境配置
│   └── server/          # 服务器模块
│       ├── app.js        # 命令行接口
│       └── server.js     # HTTP服务器
├── test/                # 测试目录
│   ├── core/            # 核心模块测试
│   │   └── multiTurnTravelAssistant.test.js # 多轮对话助手测试
│   ├── skills/           # 技能模块测试
│   │   ├── RouteSkill.test.js # 路线规划技能测试
│   │   └── SkillManager.test.js # 技能管理测试
│   └── main.test.js     # 主测试文件
├── .dockerignore        # Docker忽略文件
├── .eslintrc.js         # ESLint配置
├── .gitignore           # Git忽略文件
├── .prettierrc.js       # Prettier配置
├── 404.html             # 404页面
├── Dockerfile           # Docker构建文件
├── index.html           # 首页
├── index.js             # 项目入口
├── jest.config.js       # Jest测试配置
├── package-lock.json    # 依赖版本锁定
├── package.json         # 项目配置
└── README.md            # 项目说明
```

## 环境要求

- Node.js 16.0 或更高版本
- npm 7.0 或更高版本

## 安装与开始

### 安装依赖

```bash
npm install
```

### 配置环境变量

在项目根目录创建 `.env` 文件，并填写以下配置：

```env
# 环境配置
NODE_ENV=development

# API密钥
MAP_API_KEY=your_map_api_key
WEATHER_API_KEY=your_weather_api_key
LLM_API_KEY=your_llm_api_key

# 服务器配置
PORT=3001

# 调试模式
DEBUG=false
```

### 运行开发模式

```bash
npm run dev
```

### 启动服务器

```bash
npm start
```

服务器将运行在 `http://localhost:3001`

### 运行测试

```bash
npm test
```

### 代码检查

```bash
# 运行 ESLint 检查
npm run lint

# 自动修复 ESLint 问题
npm run lint:fix

# 格式化代码
npm run format
```

## 使用说明

### 基本使用

```javascript
const TravelAssistant = require('./src/core/main');

async function main() {
  const assistant = new TravelAssistant();
  
  // 规划路线
  const routeResult = await assistant.planRoute('北京', '上海');
  console.log('路线规划结果:', routeResult);

  // 处理用户输入
  const result = await assistant.processUserInput('北京天气如何');
  console.log('处理结果:', result);
}

main();
```

### Web端使用

启动服务器后，打开浏览器访问 `http://localhost:3001`，即可使用Web界面进行交互。

## API接口

### 1. 路线规划

**URL**: `/api/plan-route`
**方法**: POST
**请求体**:
```json
{
  "origin": "出发地",
  "destination": "目的地"
}
```

### 2. 处理用户输入

**URL**: `/api/process-input`
**方法**: POST
**请求体**:
```json
{
  "input": "用户输入内容"
}
```

### 3. 聊天接口

**URL**: `/api/chat`
**方法**: POST
**请求体**:
```json
{
  "message": "聊天消息",
  "sessionId": "会话ID"
}
```

### 4. 更新位置

**URL**: `/api/update-location`
**方法**: POST
**请求体**:
```json
{
  "sessionId": "会话ID",
  "location": "位置名称",
  "lat": 纬度,
  "lng": 经度
}
```

### 5. 逆地理编码

**URL**: `/api/reverse-geocode`
**方法**: POST
**请求体**:
```json
{
  "latitude": 纬度,
  "longitude": 经度
}
```

## 配置管理

项目使用 `.env` 文件管理配置，主要配置项包括：

- `NODE_ENV`：环境类型（development, production）
- `MAP_API_KEY`：高德地图API密钥
- `WEATHER_API_KEY`：天气API密钥
- `LLM_API_KEY`：LLM API密钥
- `SILICON_FLOW_API_KEY`：Silicon Flow API密钥
- `PORT`：服务器端口
- `DEBUG`：调试模式

## 技术栈

- **核心技术**：Node.js
- **API服务**：高德地图API、和风天气API
- **AI能力**：LLM自然语言理解
- **工程化工具**：ESLint, Prettier, Jest, GitHub Actions
- **容器化**：Docker

## 贡献指南

我们欢迎任何形式的贡献，包括但不限于：

1. **报告Bug**：在GitHub Issues中提交详细的Bug报告
2. **修复Bug**：Fork项目，修复Bug后提交PR
3. **添加功能**：实现新功能并提交PR
4. **完善文档**：改进README或添加新的文档

### 贡献流程

1. Fork项目仓库
2. 克隆到本地：`git clone https://github.com/your-username/travel-assistant.git`
3. 创建分支：`git checkout -b feature/your-feature`
4. 安装依赖：`npm install`
5. 开发并测试
6. 提交代码：`git commit -m "Add your feature"`
7. 推送到远程：`git push origin feature/your-feature`
8. 在GitHub上创建PR

## 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。