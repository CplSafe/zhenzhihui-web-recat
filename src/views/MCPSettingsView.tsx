import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApiOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  LinkOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useCurrentWorkspace, useWorkspaceId } from '@/stores/workspaceSession'
import './MCPSettingsView.css'

type ProtectedResourceMetadata = {
  resource?: string
  authorization_servers?: string[]
  scopes_supported?: string[]
  bearer_methods_supported?: string[]
}

const DEFAULT_SCOPES = [
  'ai.read',
  'ai.generate',
  'assets.read',
  'assets.write',
  'billing.read',
  'canvas.read',
  'canvas.write',
]

const SCOPE_LABELS: Record<string, string> = {
  'ai.read': '读取生成任务',
  'ai.generate': '提交图片、视频与重试任务',
  'assets.read': '读取素材中心',
  'assets.write': '创建素材上传票据',
  'billing.read': '查询余额、用量与账单',
  'canvas.read': '读取画布内容',
  'canvas.write': '写入画布与发起渲染',
}

function joinUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return true
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

export default function MCPSettingsView() {
  const handleNavigate = useSidebarNavigate()
  const workspaceId = useWorkspaceId()
  const currentWorkspace = useCurrentWorkspace()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [metadata, setMetadata] = useState<ProtectedResourceMetadata | null>(null)
  const [metadataError, setMetadataError] = useState('')
  const [metadataLoading, setMetadataLoading] = useState(true)
  const [copied, setCopied] = useState('')

  const endpoint = useMemo(() => joinUrl('/mcp'), [])
  const metadataUrl = useMemo(() => joinUrl('/.well-known/oauth-protected-resource/mcp'), [])
  const workspaceName = String(currentWorkspace?.name || '当前工作空间')
  const scopes = metadata?.scopes_supported?.length ? metadata.scopes_supported : DEFAULT_SCOPES

  const loadMetadata = useCallback(async () => {
    setMetadataLoading(true)
    setMetadataError('')
    try {
      const response = await fetch(metadataUrl, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`发现接口返回 ${response.status}`)
      const body = await response.json().catch(() => null)
      const strings = (value: unknown): value is string[] =>
        Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '')
      if (
        !body ||
        typeof body.resource !== 'string' ||
        body.resource !== endpoint ||
        !strings(body.authorization_servers) ||
        body.authorization_servers.length === 0 ||
        (body.scopes_supported !== undefined && !strings(body.scopes_supported)) ||
        (body.bearer_methods_supported !== undefined && !strings(body.bearer_methods_supported))
      ) {
        throw new Error('服务发现返回的数据不完整或格式不正确')
      }
      setMetadata(body as ProtectedResourceMetadata)
    } catch (error) {
      setMetadata(null)
      setMetadataError(error instanceof Error ? error.message : '暂时无法读取 MCP 发现信息')
    } finally {
      setMetadataLoading(false)
    }
  }, [metadataUrl, endpoint])

  useEffect(() => {
    void loadMetadata()
  }, [loadMetadata])

  const copy = async (key: string, value: string) => {
    try {
      if (await copyText(value)) {
        setCopied(key)
        window.setTimeout(() => setCopied((current) => (current === key ? '' : current)), 1800)
      }
    } catch {
      setCopied('')
    }
  }

  return (
    <div className="mcp-settings">
      <AppSidebar
        activeKey="settings"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="mcp-settings__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <main className="mcp-settings__content">
          <header className="mcp-settings__header">
            <div>
              <p className="mcp-settings__eyebrow">开发者接入</p>
              <h1>MCP 接入</h1>
              <p className="mcp-settings__lede">把当前工作空间的生成、素材和画布能力授权给标准 MCP 客户端。</p>
            </div>
            <div className="mcp-settings__workspace" aria-label="当前工作空间">
              <span className="mcp-settings__workspace-dot" />
              <span>{workspaceName}</span>
              <small>ID {workspaceId || '—'}</small>
            </div>
          </header>

          <section className="mcp-settings__connection" aria-labelledby="mcp-connection-title">
            <div className="mcp-settings__section-heading">
              <div>
                <h2 id="mcp-connection-title">连接信息</h2>
                <p>在 Qoder、Claude 或其他支持 Streamable HTTP 的 MCP 客户端中填入服务地址。</p>
              </div>
              <span className="mcp-settings__status">
                <CheckCircleOutlined /> 标准 OAuth 保护
              </span>
            </div>
            <div className="mcp-settings__endpoint-row">
              <div className="mcp-settings__endpoint-label">
                <ApiOutlined />
                <span>MCP 服务地址</span>
              </div>
              <code>{endpoint}</code>
              <button type="button" className="mcp-settings__copy" onClick={() => void copy('endpoint', endpoint)}>
                {copied === 'endpoint' ? <CheckCircleOutlined /> : <CopyOutlined />}
                {copied === 'endpoint' ? '已复制' : '复制'}
              </button>
            </div>
            <div className="mcp-settings__endpoint-row mcp-settings__endpoint-row--secondary">
              <div className="mcp-settings__endpoint-label">
                <LinkOutlined />
                <span>保护资源元数据</span>
              </div>
              <code>{metadataUrl}</code>
              <button type="button" className="mcp-settings__copy" onClick={() => void copy('metadata', metadataUrl)}>
                {copied === 'metadata' ? <CheckCircleOutlined /> : <CopyOutlined />}
                {copied === 'metadata' ? '已复制' : '复制'}
              </button>
            </div>
          </section>

          <section className="mcp-settings__discovery" aria-live="polite">
            <div className="mcp-settings__discovery-icon">
              <SafetyCertificateOutlined />
            </div>
            <div className="mcp-settings__discovery-copy">
              <strong>
                {metadataLoading ? '正在检查服务发现…' : metadataError ? '服务发现暂不可用' : '服务发现正常'}
              </strong>
              <span>
                {metadataLoading
                  ? '正在读取 OAuth 保护资源元数据。'
                  : metadataError
                    ? `${metadataError} 仍可先复制 MCP 地址，检查后端服务是否已启动。`
                    : `已发现 ${metadata?.authorization_servers?.length || 0} 个授权服务，客户端会自动进入授权流程。`}
              </span>
            </div>
            {metadataError && (
              <button type="button" className="mcp-settings__retry" onClick={() => void loadMetadata()}>
                <ReloadOutlined /> 重试
              </button>
            )}
          </section>

          <div className="mcp-settings__columns">
            <section className="mcp-settings__scope-panel" aria-labelledby="mcp-scope-title">
              <div className="mcp-settings__section-heading">
                <div>
                  <h2 id="mcp-scope-title">可授权能力</h2>
                  <p>每次连接都会显示确认页，授权范围绑定到当前工作空间。</p>
                </div>
              </div>
              <ul className="mcp-settings__scope-list">
                {scopes.map((scope) => (
                  <li key={scope}>
                    <span className="mcp-settings__scope-mark">
                      <CheckCircleOutlined />
                    </span>
                    <div>
                      <code>{scope}</code>
                      <span>{SCOPE_LABELS[scope] || '受控的 MCP 能力'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mcp-settings__guide" aria-labelledby="mcp-guide-title">
              <h2 id="mcp-guide-title">接入步骤</h2>
              <ol>
                <li>
                  <b>添加服务地址</b>
                  <span>在 MCP 客户端粘贴上方地址。</span>
                </li>
                <li>
                  <b>完成一次授权</b>
                  <span>客户端会打开业务登录与授权确认页。</span>
                </li>
                <li>
                  <b>开始调用</b>
                  <span>客户端按 scope 调用工具，任务结果可异步查询。</span>
                </li>
              </ol>
              <p>请在 MCP 客户端发起连接，客户端会打开授权确认页。</p>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
