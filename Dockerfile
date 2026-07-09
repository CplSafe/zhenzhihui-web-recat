# 帧智汇前端 — 多阶段:node 构建 dist → nginx 托管 + 反代后端/AI
# 构建产物是纯静态 SPA;所有 /api /auth 请求由 nginx 同源反代到业务后端,
# 因此无需构建期注入 VITE_* origin(前端调用的都是相对路径 /api)。

FROM node:20-alpine AS build
WORKDIR /app
# 依赖层单独缓存
COPY package.json package-lock.json ./
RUN npm ci
# 源码 + 构建
COPY . .
# 构建期注入前端 origin:toNavigationUrl 靠它把 DeepAuth authorize 绝对 URL 映射回同源 /deepauth 路径,
# 否则未知 origin 会被当开放重定向拦成 '/',导致登录后「缺少 SSO 跳转地址」。
ARG VITE_ZZH_REMOTE_ORIGIN=""
ENV VITE_ZZH_REMOTE_ORIGIN=$VITE_ZZH_REMOTE_ORIGIN
# 素材直传目标白名单:生产构建只允许白名单内的 host 直传 MinIO,需放行本地 MinIO 端点。
ARG VITE_ZZH_ALLOWED_UPLOAD_ORIGINS=""
ENV VITE_ZZH_ALLOWED_UPLOAD_ORIGINS=$VITE_ZZH_ALLOWED_UPLOAD_ORIGINS
# 统一日志(OpenObserve 浏览器 SDK)构建期配置;缺 TOKEN/SITE 时前端自动跳过不上报。
ARG VITE_O2_CLIENT_TOKEN=""
ENV VITE_O2_CLIENT_TOKEN=$VITE_O2_CLIENT_TOKEN
ARG VITE_O2_SITE=""
ENV VITE_O2_SITE=$VITE_O2_SITE
ARG VITE_O2_ORG="default"
ENV VITE_O2_ORG=$VITE_O2_ORG
ARG VITE_O2_SERVICE="zhenzhihui-web"
ENV VITE_O2_SERVICE=$VITE_O2_SERVICE
ARG VITE_O2_ENV="local"
ENV VITE_O2_ENV=$VITE_O2_ENV
ARG VITE_O2_INSECURE="true"
ENV VITE_O2_INSECURE=$VITE_O2_INSECURE
RUN npm run build

FROM nginx:alpine
# 反代配置(见同目录 nginx.conf)
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
