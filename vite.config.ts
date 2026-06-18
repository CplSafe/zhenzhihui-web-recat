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

              const devOrigin = getDevOrigin(req)

              // /auth/callback 完成后跳回前端 → 保留路径，只改域名
              if (location.startsWith('http://') || location.startsWith('https://')) {
                try {
                  const url = new URL(location)
                  proxyRes.headers.location = url.pathname + url.search + url.hash || '/'
                } catch {
                  proxyRes.headers.location = `${devOrigin}/`
                }
              }
            })
          },
        },
        '/zzh-api': {
          ...createBusinessProxy(businessTarget),
          rewrite: (p) => p.replace(/^\/zzh-api/, ''),
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
