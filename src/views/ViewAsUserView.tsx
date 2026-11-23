import { useCallback, useEffect, useState } from 'react'
import { useLoaderData } from 'react-router-dom'
import { ArrowLeft, Eye } from 'lucide-react'
import CanvasUsagePanel from '@/components/billing/CanvasUsagePanel'
import { creditLedgerKindLabel, extractCreditLedgerPage, formatCreditDelta } from '@/utils/creditLedger'
import { formatCredits } from '@/utils/creditsFormat'
import { endViewAsUser, readAsUser, ViewAsUserError, type loadViewAsUser } from '@/api/viewAsUser'
import styles from './ViewAsUserView.module.css'

const PAGE_SIZE = 20
const dateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
const taskStatuses: Readonly<Record<string, string>> = {
  queued: '排队中',
  pending: '等待中',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

interface UsageSummary {
  used_credits: number
  remaining_credits: number | null
  image_count: number
  video_count: number
  video_duration_seconds: number | null
  known_video_duration_seconds: number
  estimated_video_count: number
  missing_video_duration_count: number
}

interface ActivityItem {
  id: number
  title?: string
  status?: string
  operation_code?: string
  updated_at?: string
  created_at?: string
  actual_cost?: number
}

interface ActivityRow {
  id: string
  name: string
  status: string
  at?: string
}

interface ActivityPage {
  items: ActivityItem[] | null
  total: number
}

const activityViews = {
  projects: { label: '创作项目', path: '/api/v1/creative/projects', details: '状态' },
  tasks: { label: '生成任务', path: '/api/v1/ai/tasks', details: '状态及结算积分' },
  canvases: { label: '无限画布', path: '/api/v1/canvases', details: '状态' },
  credits: { label: '积分明细', path: '/api/v1/billing/credit-ledgers', details: '积分变动' },
}

type ActivityView = keyof typeof activityViews

function displayDate(value?: string): string {
  const ms = Date.parse(value || '')
  return Number.isFinite(ms) ? dateTime.format(ms) : '—'
}

function formatActivity(item: ActivityItem, view: Exclude<ActivityView, 'credits'>): ActivityRow {
  const id = String(item.id)
  if (view === 'tasks') {
    const status = taskStatuses[item.status || ''] || item.status || '—'
    return {
      id,
      name: item.operation_code ? `${item.operation_code} · #${id}` : `任务 #${id}`,
      status: `${status} · ${formatCredits(item.actual_cost, 3)}`,
      at: item.created_at,
    }
  }
  return {
    id,
    name: item.title || `未命名 · #${id}`,
    status: item.status === 'archived' ? '已归档' : '正常',
    at: item.updated_at || item.created_at,
  }
}

function useViewedData<T>(path: string, read: typeof readAsUser) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ path: string; attempt: number; data?: T; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void read<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ path, attempt, data })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const message =
          error instanceof ViewAsUserError && error.status === 403
            ? '此用户在该空间暂无查看权限。'
            : '暂时无法加载数据。'
        setResult({ path, attempt, error: message })
      },
    )
    return () => controller.abort()
  }, [path, read, attempt])
  return {
    result: result?.path === path && result.attempt === attempt ? result : null,
    retry: () => setAttempt((value) => value + 1),
  }
}

function LoadingState({ error, retry }: { error?: string; retry: () => void }) {
  if (!error) return <p role="status">正在加载…</p>
  return (
    <div className={styles.loadError} role="alert">
      {error}
      <button type="button" onClick={retry}>
        重试
      </button>
    </div>
  )
}

function Usage({ read, workspaceId }: { read: typeof readAsUser; workspaceId?: number }) {
  const path = workspaceId ? `/api/v1/workspaces/${workspaceId}/usage-summary` : '/api/v1/me/usage-summary'
  const { result, retry } = useViewedData<UsageSummary>(path, read)
  const data = result?.data
  const duration = data?.video_duration_seconds ?? data?.known_video_duration_seconds
  return (
    <section className={styles.panel} aria-label={workspaceId ? '团队使用情况' : '个人使用情况'}>
      <header className={styles.panelHeading}>
        <h2>{workspaceId ? '团队使用情况' : '个人使用情况'}</h2>
        <span>{workspaceId ? '当前团队累计' : '跨工作空间累计'}</span>
      </header>
      {data ? (
        <>
          <dl className={styles.metrics}>
            <div>
              <dt>已结算积分</dt>
              <dd>{formatCredits(data.used_credits, 3)}</dd>
            </div>
            <div>
              <dt>{workspaceId ? '团队可用积分' : '个人可用积分'}</dt>
              <dd>{data.remaining_credits == null ? '—' : formatCredits(data.remaining_credits, 3)}</dd>
            </div>
            <div>
              <dt>生成图片</dt>
              <dd>{data.image_count}</dd>
            </div>
            <div>
              <dt>生成视频</dt>
              <dd>{data.video_count}</dd>
            </div>
            <div>
              <dt>{data.missing_video_duration_count > 0 ? '已统计视频时长' : '生成视频时长'}</dt>
              <dd>{duration == null ? '—' : `${formatCredits(duration)} 秒`}</dd>
            </div>
          </dl>
          {(data.estimated_video_count > 0 || data.missing_video_duration_count > 0) && (
            <p className={styles.note}>
              {[
                data.estimated_video_count > 0 && `${data.estimated_video_count} 条视频使用估算时长`,
                data.missing_video_duration_count > 0 && `${data.missing_video_duration_count} 条视频缺少时长`,
              ]
                .filter(Boolean)
                .join('，')}
              。
            </p>
          )}
        </>
      ) : (
        <LoadingState error={result?.error} retry={retry} />
      )}
    </section>
  )
}

function Activity({ workspaceId, view, read }: { workspaceId: number; view: ActivityView; read: typeof readAsUser }) {
  const [page, setPage] = useState(1)
  const offset = (page - 1) * PAGE_SIZE
  const query = new URLSearchParams({
    workspace_id: String(workspaceId),
    limit: String(PAGE_SIZE),
    offset: String(offset),
  })
  if (view === 'projects' || view === 'tasks') query.set('mine', 'true')
  const { label, path, details } = activityViews[view]
  const { result, retry } = useViewedData<ActivityPage | ActivityItem[]>(`${path}?${query}`, read)
  let rows: ActivityRow[] = []
  let total: number | null = null
  if (result?.data) {
    if (view === 'credits') {
      const ledger = extractCreditLedgerPage(result.data, offset)
      total = ledger.total
      rows = ledger.records.map((row) => ({
        id: row.id,
        name: creditLedgerKindLabel(row.kind, row.direction),
        status: formatCreditDelta(row),
        at: row.createdAt,
      }))
    } else if (!Array.isArray(result.data)) {
      total = result.data.total
      rows = (result.data.items || []).map((item) => formatActivity(item, view))
    }
  }
  const hasNext = total == null ? rows.length >= PAGE_SIZE : offset + PAGE_SIZE < total

  return (
    <>
      {!result?.data ? (
        <LoadingState error={result?.error} retry={retry} />
      ) : rows.length === 0 ? (
        <p>暂无{label}记录</p>
      ) : (
        <div className={styles.tableWrap}>
          <table aria-label={label} className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{view === 'credits' ? '类型' : '名称'}</th>
                <th scope="col">{details}</th>
                <th scope="col">时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.status}</td>
                  <td>{displayDate(row.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(page > 1 || hasNext) && (
        <div className={styles.pagination}>
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            上一页
          </button>
          <span>第 {page} 页</span>
          <button type="button" disabled={!hasNext} onClick={() => setPage((value) => value + 1)}>
            下一页
          </button>
        </div>
      )}
    </>
  )
}

function closeView() {
  endViewAsUser()
  window.close()
}

function EndedView({ message }: { message: string }) {
  return (
    <main className={styles.ended}>
      <section className={styles.panel}>
        <h1>用户身份查看</h1>
        <p role="status">{message}</p>
        <button type="button" onClick={closeView}>
          关闭此页
        </button>
      </section>
    </main>
  )
}

export default function ViewAsUserView() {
  const launch = useLoaderData<Awaited<ReturnType<typeof loadViewAsUser>>>()
  const session = 'session' in launch ? launch.session : null
  const [endMessage, setEndMessage] = useState('')
  const workspaces = session?.workspaces || []
  const [selectedId, setSelectedId] = useState(0)
  const workspace = workspaces.find(({ id }) => id === selectedId) || workspaces[0]
  const [view, selectView] = useState<ActivityView>('projects')
  const [showCanvasUsage, setShowCanvasUsage] = useState(false)
  const readWhileActive: typeof readAsUser = useCallback(async (path, options) => {
    try {
      return await readAsUser(path, options)
    } catch (error) {
      if (error instanceof ViewAsUserError && error.status === 401 && !options?.signal?.aborted) {
        setEndMessage('本次查看已失效。请返回后台重新发起查看。')
      }
      throw error
    }
  }, [])

  const expiresAt = session?.expiresAt
  useEffect(() => {
    if (!expiresAt || endMessage) return
    const expires = () => {
      if (Date.now() < expiresAt) return
      endViewAsUser()
      setEndMessage('本次查看已到期。请返回后台重新发起查看。')
    }
    const timer = window.setTimeout(expires, Math.max(0, expiresAt - Date.now()))
    document.addEventListener('visibilitychange', expires)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', expires)
    }
  }, [expiresAt, endMessage])

  if ('error' in launch) return <EndedView message={launch.error} />
  if (endMessage) return <EndedView message={endMessage} />
  const { user } = launch.session
  const displayName = user.nickname || user.mobile || user.email || `用户 #${user.id}`
  const isTeam = workspace?.type === 'team' || workspace?.type === 'enterprise'

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <div className={styles.identity}>
            <Eye size={20} aria-hidden="true" />
            <div>
              <strong>正以 {displayName} 的身份查看</strong>
              <span>只读会话 · {displayDate(new Date(launch.session.expiresAt).toISOString())} 到期</span>
            </div>
          </div>
          <button
            className={styles.exit}
            type="button"
            onClick={() => {
              closeView()
              setEndMessage('本次查看已结束。你可以关闭此页，回到后台。')
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            结束查看
          </button>
        </div>
      </header>
      <main className={styles.content}>
        <h1>使用概览</h1>
        <Usage read={readWhileActive} />
        <section className={styles.panel} aria-label="工作空间详情">
          <header className={styles.panelHeading}>
            <h2>工作空间</h2>
            {workspace && (
              <label className={styles.workspace}>
                切换空间
                <select
                  value={workspace.id}
                  onChange={(event) => {
                    setSelectedId(Number(event.target.value))
                    setShowCanvasUsage(false)
                  }}
                >
                  {workspaces.map(({ id, name, type }) => (
                    <option key={id} value={id}>
                      {name || (type === 'personal' ? '个人空间' : `团队 #${id}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </header>
          {workspace ? (
            <>
              <div className={styles.viewSelect} role="group" aria-label="工作空间记录">
                {(Object.keys(activityViews) as ActivityView[]).map((option) => (
                  <button type="button" key={option} aria-pressed={view === option} onClick={() => selectView(option)}>
                    {activityViews[option].label}
                  </button>
                ))}
              </div>
              <Activity key={`${workspace.id}:${view}`} workspaceId={workspace.id} view={view} read={readWhileActive} />
            </>
          ) : (
            <p>该用户暂无可用的工作空间。</p>
          )}
        </section>
        {isTeam && (
          <>
            <Usage read={readWhileActive} workspaceId={workspace.id} />
            <button
              type="button"
              aria-expanded={showCanvasUsage}
              onClick={() => setShowCanvasUsage((visible) => !visible)}
            >
              {showCanvasUsage ? '收起画布用量' : '查看画布用量'}
            </button>
            {showCanvasUsage && <CanvasUsagePanel workspaceId={workspace.id} readUsage={readWhileActive} />}
          </>
        )}
      </main>
    </div>
  )
}
