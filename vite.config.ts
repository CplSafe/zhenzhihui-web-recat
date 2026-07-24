import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import type { ProxyOptions } from 'vite'
import type { IncomingMessage } from 'node:http'
import { resolveProxyTarget } from './src/build/proxyTarget'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Proxy destinations are Node-only configuration. Prefer the unprefixed
  // names; legacy VITE_* aliases remain accepted so existing local env files
  // keep working without exposing those values to browser code.
  const businessOrigin = env.ZZH_REMOTE_ORIGIN || env.VITE_ZZH_REMOTE_ORIGIN
  const deepAuthOrigin = env.DEEPAUTH_REMOTE_ORIGIN || env.VITE_DEEPAUTH_REMOTE_ORIGIN
  const ssoOrigin = env.SSO_REMOTE_ORIGIN || env.VITE_SSO_REMOTE_ORIGIN
  const businessTarget = resolveProxyTarget(businessOrigin, 'http://localhost:9000', 'ZZH_REMOTE_ORIGIN')
  const deepAuthTarget = resolveProxyTarget(deepAuthOrigin, 'http://localhost:8080', 'DEEPAUTH_REMOTE_ORIGIN')
  const ssoTarget = resolveProxyTarget(ssoOrigin, 'http://localhost:8001', 'SSO_REMOTE_ORIGIN')
  // AI 润色/文本:本地部署的 vLLM(OpenAI 兼容)模型,后端就绪后改 AI_MODEL_ORIGIN 即可
  const aiModelTarget = resolveProxyTarget(
    env.AI_MODEL_ORIGIN || env.VITE_AI_MODEL_ORIGIN,
    'http://172.10.0.102:8001',
    'AI_MODEL_ORIGIN',
  )
  // AI 视觉(图片解析):专用 VL 模型(Qwen3-VL),用于素材分析/智能预填/带图脚本
  const aiVlTarget = resolveProxyTarget(
    env.AI_VL_ORIGIN || env.VITE_AI_VL_ORIGIN,
    'http://172.10.0.102:8003',
    'AI_VL_ORIGIN',
  )
  // AI 图片生成(Qwen-Image),用于「AI 自动生成」素材/分镜图
  const aiImgTarget = resolveProxyTarget(
    env.AI_IMG_ORIGIN || env.VITE_AI_IMG_ORIGIN,
    'http://172.10.0.102:8004',
    'AI_IMG_ORIGIN',
  )
  const businessCallbackUrl = `${normalizeBaseUrl(businessTarget)}/auth/callback`

  return {
    plugins: [react()],
    define: {
      'import.meta.env.ZZH_DEV_PROXY_CONFIGURED': JSON.stringify(mode === 'test' || Boolean(businessOrigin)),
    },
    build: {
      target: 'safari13',
      rollupOptions: {
        output: {
          // Merge only tiny chunks that share the same loading boundary. This
          // keeps route-level lazy loading intact while avoiding dozens of
          // separate gzip streams and import wrappers in the production build.
          experimentalMinChunkSize: 6_000,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      proxy: {
        '/api': createBusinessProxy(businessTarget),
        '/auth': {
          ...createBusinessProxy(businessTarget),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
            })
            proxy.on('proxyRes', (proxyRes, req) => {
              const location = proxyRes.headers.location
              if (!location) return
              if (!location.startsWith('http://') && !location.startsWith('https://')) return

              const devOrigin = getDevOrigin(req)

              // 仅改写指向业务域自身的回跳（/auth/callback 完成后跳回前端）→ 保留路径只改域名。
              // 若业务域跳转到 SSO(8001) → 绕过代理会导致跨域离开，改写为 /sso 代理路径。
              try {
                const url = new URL(location)
                const locOrigin = normalizeBaseUrl(url.origin)
                if (locOrigin === normalizeBaseUrl(businessTarget)) {
                  proxyRes.headers.location = url.pathname + url.search + url.hash || '/'
                } else if (locOrigin === normalizeBaseUrl(ssoTarget)) {
                  proxyRes.headers.location = '/sso' + url.pathname + url.search + url.hash
                }
              } catch {
                proxyRes.headers.location = `${devOrigin}/`
              }
            })
          },
        },
        '/zzh-api': {
          ...createBusinessProxy(businessTarget),
          rewrite: (p) => p.replace(/^\/zzh-api/, ''),
        },
        '/aimodel-vl': {
          target: aiVlTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/aimodel-vl/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
            })
          },
        },
        '/aimodel-img': {
          target: aiImgTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/aimodel-img/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
            })
          },
        },
        '/aimodel': {
          target: aiModelTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/aimodel/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
            })
          },
        },
        '/sso': {
          target: ssoTarget,
          changeOrigin: true,
          cookieDomainRewrite: '',
          rewrite: (p) => p.replace(/^\/sso/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
            })
            proxy.on('proxyRes', (proxyRes, req) => {
              const location = proxyRes.headers.location
              if (!location) return
              const devOrigin = getDevOrigin(req)

              if (location.startsWith('http://') || location.startsWith('https://')) {
                try {
                  const url = new URL(location)
                  const locOrigin = normalizeBaseUrl(url.origin)
                  // SSO 自身的回跳 → 保留在 /sso 代理内
                  if (locOrigin === normalizeBaseUrl(ssoTarget)) {
                    proxyRes.headers.location = '/sso' + url.pathname + url.search + url.hash
                  } else if (locOrigin === normalizeBaseUrl(businessTarget)) {
                    proxyRes.headers.location = url.pathname + url.search + url.hash || '/'
                  } else if (locOrigin === normalizeBaseUrl(deepAuthTarget)) {
                    proxyRes.headers.location = '/deepauth' + url.pathname + url.search + url.hash
                  }
                } catch {
                  proxyRes.headers.location = `${devOrigin}/`
                }
              } else if (location.startsWith('/')) {
                // 8001 返回相对路径重定向 → 补回 /sso 前缀
                proxyRes.headers.location = '/sso' + location
              }
            })
          },
        },
        '/deepauth': {
          target: deepAuthTarget,
          changeOrigin: true,
          cookieDomainRewrite: '',
          rewrite: (p) => p.replace(/^\/deepauth/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
            })
            proxy.on('proxyRes', (proxyRes, req) => {
              const location = proxyRes.headers.location
              const devOrigin = getDevOrigin(req)

              if (location?.startsWith(businessCallbackUrl)) {
                proxyRes.headers.location = location.replace(businessCallbackUrl, `${devOrigin}/auth/callback`)
              } else if (location && (location.startsWith('http://') || location.startsWith('https://'))) {
                try {
                  const url = new URL(location)
                  const locOrigin = normalizeBaseUrl(url.origin)
                  if (locOrigin === normalizeBaseUrl(ssoTarget)) {
                    proxyRes.headers.location = '/sso' + url.pathname + url.search + url.hash
                  }
                } catch {
                  // 无法解析的绝对 URL 不处理
                }
              }
            })
          },
        },
      },
    },
  }
})

function createBusinessProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    secure: false,
    cookieDomainRewrite: '',
    proxyTimeout: 120000,
    timeout: 120000,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.removeHeader('origin')
      })
      proxy.on('error', (_err) => {
        // socket hang up 不影响，模型回退+重试会处理
      })
    },
  }
}

function getDevOrigin(req: IncomingMessage): string {
  return `http://${req?.headers?.host || 'localhost:5173'}`
}

function normalizeBaseUrl(url: string): string {
  return String(url || '').replace(/\/+$/, '')
}
