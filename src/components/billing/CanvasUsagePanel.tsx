import { useEffect, useState } from 'react'
import { getBusinessErrorMessage, requestBusinessJson } from '@/api/business'
import './CanvasUsagePanel.css'
import WorkspaceUsageSummary from './WorkspaceUsageSummary'
import type { WorkspaceCanvasUsageSummary } from '@/api/canvasApi'

const PAGE_SIZE = 20
const points = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 })

type CanvasUsagePage = WorkspaceCanvasUsageSummary & {
  items: {
    canvas_id: number
    title: string
    deleted: boolean
    used_credits: number
    members: { user_id: number; display_name: string; used_credits: number; historical_allocated_credits?: number }[]
  }[]
  total: number
  total_used_credits: number
}

export default function CanvasUsagePanel({ workspaceId, month }: { workspaceId: number; month?: string }) {
  return <CanvasUsageContent key={`${workspaceId}:${month || ''}`} workspaceId={workspaceId} month={month} />
}

function CanvasUsageContent({ workspaceId, month }: { workspaceId: number; month?: string }) {
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState<CanvasUsagePage | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      workspace_id: String(workspaceId),
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    })
    if (month) query.set('month', month)
    requestBusinessJson<CanvasUsagePage>(`/api/v1/billing/canvas-usage?${query}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(getBusinessErrorMessage(err, '画布用量加载失败'))
      })
    return () => controller.abort()
  }, [workspaceId, month, page, attempt])

  const changePage = (next: number) => {
    setData(null)
    setError('')
    setPage(next)
  }

  return (
    <section className="canvas-usage" aria-label="无限画布用量">
      <header className="canvas-usage__head">
        <h2>无限画布用量</h2>
        {data && (
          <span>
            共 {data.total} 张画布 · {month ? '当月' : '累计'}已归属画布{' '}
            <strong>{points.format(data.total_used_credits)}</strong> 积分
          </span>
        )}
      </header>
      {data && !error && <WorkspaceUsageSummary summary={data} period={month || '累计'} />}
      {error ? (
        <div className="canvas-usage__status" role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              setError('')
              setAttempt((value) => value + 1)
            }}
          >
            重试
          </button>
        </div>
      ) : !data ? (
        <p className="canvas-usage__status" role="status">
          正在加载画布用量…
        </p>
      ) : data.items.length === 0 ? (
        <p className="canvas-usage__status">暂无画布记录</p>
      ) : (
        <div className="canvas-usage__rows">
          {data.items.map((canvas) => (
            <details key={canvas.canvas_id} className="canvas-usage__row">
              <summary>
                <span>
                  {canvas.title || `画布 #${canvas.canvas_id}`}
                  {canvas.deleted && <small>已删除</small>}
                </span>
                <b>{points.format(canvas.used_credits)} 积分</b>
              </summary>
              {canvas.members?.length ? (
                <dl aria-label="成员已结算积分" className="canvas-usage__members">
                  {canvas.members.map((member) => (
                    <div key={member.user_id}>
                      <dt>
                        {member.display_name || '成员'}{' '}
                        {member.display_name !== `成员 #${member.user_id}` && <small>#{member.user_id}</small>}
                      </dt>
                      <dd>
                        {points.format(member.used_credits)} 积分
                        {!!member.historical_allocated_credits && (
                          <small>（含历史分摊 {points.format(member.historical_allocated_credits)}）</small>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="canvas-usage__status">暂无成员消费记录</p>
              )}
            </details>
          ))}
        </div>
      )}
      {(page > 1 || (data && data.total > PAGE_SIZE)) && (
        <footer className="canvas-usage__pages">
          <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)}>
            上一页
          </button>
          <span>第 {page} 页</span>
          <button type="button" disabled={!data || page * PAGE_SIZE >= data.total} onClick={() => changePage(page + 1)}>
            下一页
          </button>
        </footer>
      )}
    </section>
  )
}
