/**
 * 中大统一前端日志客户端 —— 把浏览器 console / 未捕获错误 / 用户行为 上报到 OpenObserve。
 *
 * 任何前端项目复用步骤:
 *   1) npm i @openobserve/browser-logs @openobserve/browser-rum
 *   2) 把本文件拷进项目(如 src/observability/），在应用入口最早处 import 并调用 initObservability()
 *   3) 在 .env 配置下面这些 VITE_O2_* 变量(clientToken 从 O2 UI「Ingestion → Custom → RUM」拿）
 *
 * 设计:失败绝不阻塞业务(SDK 内部静默失败）；本文件对「未配置」也做降级(直接返回,不报错)。
 */
import { openobserveLogs } from '@openobserve/browser-logs'
import { openobserveRum } from '@openobserve/browser-rum'

type Env = Record<string, string | undefined>
// 兼容 Vite(import.meta.env) 与注入的全局；取不到就空,initObservability 直接降级跳过。
const ENV: Env = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}

const cfg = {
  clientToken: ENV.VITE_O2_CLIENT_TOKEN || '',
  // 形如 "logs.example.com:5080" 或内网 "iah101.ruc:5080"(不带 scheme）
  site: ENV.VITE_O2_SITE || '',
  org: ENV.VITE_O2_ORG || 'default',
  service: ENV.VITE_O2_SERVICE || 'web',
  env: ENV.VITE_O2_ENV || 'local',
  version: ENV.VITE_O2_VERSION || '0.0.0',
  // 本地 http 部署置 true;上线 https 置 false
  insecure: (ENV.VITE_O2_INSECURE ?? 'true') === 'true',
}

let started = false

/** 在应用入口最早处调用一次。未配置(缺 clientToken/site)时安全跳过。 */
export function initObservability(): void {
  if (started) return
  if (!cfg.clientToken || !cfg.site) {
    // 未配置:降级为无操作,不影响业务。
    if (ENV.DEV) console.info('[observability] 未配置 VITE_O2_*，前端日志上报已跳过')
    return
  }
  started = true

  const common = {
    clientToken: cfg.clientToken,
    apiVersion: 'v1',
    organizationIdentifier: cfg.org,
    site: cfg.site,
    service: cfg.service,
    env: cfg.env,
    version: cfg.version,
    insecureHTTP: cfg.insecure,
  }

  // 日志:自动转发 console.error / 未捕获异常 / 网络错误
  openobserveLogs.init({
    ...common,
    forwardErrorsToLogs: true,
    forwardConsoleLogs: ['error', 'warn'],
    forwardReports: 'all',
  })

  // RUM:页面性能 / 用户行为 / 前端错误(会话级追踪）
  openobserveRum.init({
    ...common,
    applicationId: cfg.service,
    sessionSampleRate: 100,
    sessionReplaySampleRate: 0,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    defaultPrivacyLevel: 'mask-user-input',
  })
}

/** 结构化日志：logger.info('登录成功', { userId }) 等 */
export const logger = {
  debug: (msg: string, ctx?: object) => started && openobserveLogs.logger.debug(msg, ctx),
  info: (msg: string, ctx?: object) => started && openobserveLogs.logger.info(msg, ctx),
  warn: (msg: string, ctx?: object) => started && openobserveLogs.logger.warn(msg, ctx),
  error: (msg: string, ctx?: object) => started && openobserveLogs.logger.error(msg, ctx),
}

/** 关联当前用户(登录后调用），日志/RUM 会带上用户维度 */
export function setUser(user: { id: string | number; name?: string; email?: string }): void {
  if (!started) return
  openobserveRum.setUser({ id: String(user.id), name: user.name, email: user.email })
}
