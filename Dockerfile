FROM node:18-alpine

# 创建非root用户
RUN addgroup -g 1001 -S nodejs
RUN adduser -S travel-assistant -u 1001

# 设置工作目录
WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制应用代码
COPY . .

# 设置文件权限
RUN chown -R travel-assistant:nodejs /app

# 切换到非root用户
USER travel-assistant

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider http://localhost:3001 || exit 1

# 启动应用
CMD ["npm", "start"]