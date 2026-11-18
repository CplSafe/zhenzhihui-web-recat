import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import MCPSettingsView from '@/views/MCPSettingsView'

vi.mock('@/components/home/AppSidebar', () => ({ default: () => null }))
vi.mock('@/components/layout/AppTopbar', () => ({ default: () => null }))
vi.mock('@/composables/useSidebarNavigate', () => ({ useSidebarNavigate: () => vi.fn() }))
vi.mock('@/stores/workspaceSession', () => ({ useWorkspaceId: () => 1, useCurrentWorkspace: () => ({ name: 'Test' }) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it.each(['html', 'empty', 'malformed'])('不把错误的发现响应 %s 当成正常服务', async (kind) => {
  const body =
    kind === 'empty'
      ? {}
      : {
          resource: `${window.location.origin}/mcp`,
          authorization_servers: ['https://auth.example'],
          scopes_supported: 'bad',
        }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => {
        if (kind === 'html') throw new SyntaxError('HTML')
        return body
      },
    })),
  )
  render(<MCPSettingsView />)
  expect(await screen.findByText('服务发现暂不可用')).toBeInTheDocument()
  expect(screen.queryByText('服务发现正常')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /打开授权入口/ })).not.toBeInTheDocument()
})
it('有效发现信息引导客户端发起带参数的授权', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        resource: `${window.location.origin}/mcp`,
        authorization_servers: ['https://auth.example'],
        scopes_supported: ['ai.read'],
      }),
    })),
  )
  render(<MCPSettingsView />)
  expect(await screen.findByText('服务发现正常')).toBeInTheDocument()
  expect(screen.getByText('请在 MCP 客户端发起连接，客户端会打开授权确认页。')).toBeInTheDocument()
})
