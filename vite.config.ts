import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import type { ProxyOptions } from 'vite'
import type { IncomingMessage } from 'node:http'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const businessTarget = env.VITE_ZZH_REMOTE_ORIGIN || 'http://localhost:9000'
  const deepAuthTarget = env.VITE_DEEPAUTH_REMOTE_ORIGIN || 'http://localhost:8080'
  // AI 润色/文本:本地部署的 vLLM(OpenAI 兼容)模型,后端就绪后改 VITE_AI_MODEL_ORIGIN 即可
  const aiModelTarget = env.VITE_AI_MODEL_ORIGIN || 'http://172.10.0.102:8001'
  // AI 视觉(图片解析):专用 VL 模型(Qwen3-VL),用于素材分析/智能预填/带图脚本
  const aiVlTarget = env.VITE_AI_VL_ORIGIN || 'http://172.10.0.102:8003'
  // AI 图片生成(Qwen-Image),用于「AI 自动生成」素材/分镜图
  const aiImgTarget = env.VITE_AI_IMG_ORIGIN || 'http://172.10.0.102:8004'
  const businessCallbackUrl = `${normalizeBaseUrl(businessTarget)}/auth/callback`

  return {
    plugins: [react()],
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
              // 其它跨域跳转（如真正的第三方 SSO 跳转）原样透传，避免被错误地改写成同源 404。
              try {
                const url = new URL(location)
                if (normalizeBaseUrl(url.origin) === normalizeBaseUrl(businessTarget)) {
                  proxyRes.headers.location = url.pathname + url.search + url.hash || '/'
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
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.removeHeader('origin')
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
