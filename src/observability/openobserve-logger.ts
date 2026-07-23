/**
 * 中大统一前端日志客户端 —— 把浏览器 console / 未捕获错误 / 用户行为 上报到 OpenObserve。
 *
 * 任何前端项目复用步骤:
 *   1) npm i @openobserve/browser-logs @openobserve/browser-rum
 *   2) 把本文件拷进项目(如 src/observability/），在应用入口最早处 import 并调用 initObservability()
 *   3) 在 .env 配置下面这些 VITE_O2_* 变量(clientToken 从 O2 UI「Ingestion → Custom → RUM」拿）
 *
 * 设计:失败绝不阻塞业务(SDK 内部静默失败）；本文件对「未配置」也做降级(直接返回,不报错)。
 * 文本和事件 URL 在离开浏览器前经过脱敏；context 中不应主动填入 token、cookie 或完整请求头。
 */
import { sanitizeObservabilityEventUrls, sanitizeTelemetryText } from '@/utils/observabilitySanitizer'

/** OpenObserve 可识别的 Vite 环境变量字典。 */
type Env = Record<string, string | undefined>

/** 显式列出构建期变量，便于裁剪并允许测试环境逐项注入。 */
const ENV: Env = {
  VITE_O2_CLIENT_TOKEN: import.meta.env.VITE_O2_CLIENT_TOKEN,
  VITE_O2_SITE: import.meta.env.VITE_O2_SITE,
  VITE_O2_ORG: import.meta.env.VITE_O2_ORG,
  VITE_O2_SERVICE: import.meta.env.VITE_O2_SERVICE,
  VITE_O2_ENV: import.meta.env.VITE_O2_ENV,
  VITE_O2_VERSION: import.meta.env.VITE_O2_VERSION,
  VITE_O2_INSECURE: import.meta.env.VITE_O2_INSECURE,
  DEV: import.meta.env.DEV ? 'true' : '',
}

/** OpenObserve SDK 的归一化运行配置。 */
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

/** 支持的结构化日志级别。 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 日志 SDK 的最小适配器接口，用于隔离第三方类型变化。 */
type LogClient = {
  init: (options: Record<string, unknown>) => void
  logger: Record<LogLevel, (message: string, context?: object) => void>
}

/** RUM SDK 的最小适配器接口。 */
type RumClient = {
  init: (options: Record<string, unknown>) => void
  setUser: (user: { id: string; name?: string; email?: string }) => void
}

/** SDK 尚未就绪时暂存的日志记录。 */
type PendingLog = { level: LogLevel; message: string; context?: object }

/** 初始化前日志的最大队列长度，防止 SDK 长时间失败导致内存无界增长。 */
const PENDING_LOG_LIMIT = 50

/** OpenObserve 延迟加载期间的队列、用户与初始化状态。 */
const pendingLogs: PendingLog[] = []
/** SDK 未就绪时等待关联的最新用户。 */
let pendingUser: { id: string; name?: string; email?: string } | null = null
/** 延迟加载后的 OpenObserve 日志客户端。 */
let openobserveLogs: LogClient | null = null
/** 延迟加载后的 OpenObserve RUM 客户端。 */
let openobserveRum: RumClient | null = null
/** 防止重入初始化的进行中标记。 */
let initializing = false
/** 日志与 RUM SDK 已成功启动的标记。 */
let started = false

/** SDK 初始化成功后按顺序送出暂存日志和当前用户。 */
function flushPendingCalls(): void {
  if (!started || !openobserveLogs || !openobserveRum) return
  pendingLogs.splice(0).forEach(({ level, message, context }) => {
    openobserveLogs?.logger[level](message, context)
  })
  if (pendingUser) {
    openobserveRum.setUser(pendingUser)
    pendingUser = null
  }
}

/** 先脱敏日志文本，再直接上报或有界暂存；未配置 SDK 时安全丢弃。 */
function writeLog(level: LogLevel, message: string, context?: object): void {
  const safeMessage = sanitizeTelemetryText(message)
  if (started && openobserveLogs) {
    openobserveLogs.logger[level](safeMessage, context)
    return
  }
  if (!cfg.clientToken || !cfg.site) return
  pendingLogs.push({ level, message: safeMessage, context })
  if (pendingLogs.length > PENDING_LOG_LIMIT) pendingLogs.shift()
}

/**
 * 在应用入口最早处初始化日志与 RUM。
 * 未配置、SDK 下载失败或初始化异常时安全降级，不阻塞页面业务。
 */
export function initObservability(): void {
  if (started || initializing) return
  if (!cfg.clientToken || !cfg.site) {
    // 未配置:降级为无操作,不影响业务。
    if (ENV.DEV) console.info('[observability] 未配置 VITE_O2_*，前端日志上报已跳过')
    return
  }
  initializing = true

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

  // SDK 体积较大，只在配置了上报时下载；加载或初始化失败时静默降级，不阻塞首屏。
  void Promise.all([import('@openobserve/browser-logs'), import('@openobserve/browser-rum')])
    .then(([logsModule, rumModule]) => {
      openobserveLogs = logsModule.openobserveLogs as unknown as LogClient
      openobserveRum = rumModule.openobserveRum as unknown as RumClient

      // 日志:自动转发 console.error / 未捕获异常 / 网络错误
      openobserveLogs.init({
        ...common,
        forwardErrorsToLogs: true,
        forwardConsoleLogs: ['error', 'warn'],
        forwardReports: 'all',
        beforeSend: sanitizeObservabilityEventUrls,
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
        beforeSend: sanitizeObservabilityEventUrls,
      })

      started = true
      initializing = false
      flushPendingCalls()
    })
    .catch(() => {
      initializing = false
      started = false
      openobserveLogs = null
      openobserveRum = null
    })
}

/** 结构化日志门面；消息会脱敏，context 仍应只传必要业务字段。 */
export const logger = {
  debug: (msg: string, ctx?: object) => writeLog('debug', msg, ctx),
  info: (msg: string, ctx?: object) => writeLog('info', msg, ctx),
  warn: (msg: string, ctx?: object) => writeLog('warn', msg, ctx),
  error: (msg: string, ctx?: object) => writeLog('error', msg, ctx),
}

/** 关联当前用户；SDK 未就绪时只保留最新一个用户等待初始化。 */
export function setUser(user: { id: string | number; name?: string; email?: string }): void {
  if (!cfg.clientToken || !cfg.site) return
  const normalized = { id: String(user.id), name: user.name, email: user.email }
  if (started && openobserveRum) {
    openobserveRum.setUser(normalized)
    return
  }
  pendingUser = normalized
}
