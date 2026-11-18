import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCanvasStatistics, type CanvasStatistics, type CanvasStatisticsFilters } from '@/api/canvasApi'
import { getBusinessErrorMessage } from '@/api/business'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { formatCredits } from '@/utils/creditsFormat'
import styles from './CanvasStatisticsView.module.css'

export default function CanvasStatisticsView() {
  const { id } = useParams()
  const workspaceId = useWorkspaceId()
  const userId = resolveUserId(useCurrentUser())
  return <Statistics key={`${workspaceId}:${userId}:${id}`} workspaceId={workspaceId} canvasId={Number(id)} />
}
function Statistics({ workspaceId, canvasId }: { workspaceId: number; canvasId: number }) {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<CanvasStatisticsFilters>({})
  const [filters, setFilters] = useState<CanvasStatisticsFilters>({})
  const [choices, setChoices] = useState<CanvasNodeUsageMembers>([])
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState<CanvasStatistics | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setData(null)
    setError('')
    void getCanvasStatistics(workspaceId, canvasId, page, filters)
      .then((result) => {
        if (active) {
          setData(result)
          setChoices(result.member_choices || [])
        }
      })
      .catch((err) => {
        if (active) {
          setChoices([])
          setError(getBusinessErrorMessage(err, '画布统计加载失败'))
        }
      })
    return () => {
      active = false
    }
  }, [workspaceId, canvasId, page, filters, attempt])
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button onClick={() => navigate(`/canvas/${canvasId}`)}>← 返回画布</button>
        <h1>画布数据统计</h1>
        <button onClick={() => setAttempt((v) => v + 1)}>刷新</button>
      </header>
      <p>统计所有成员的实际扣费，包含重试；未扣除的冻结积分不计入。删除节点不会扣减历史消耗。</p>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault()
          setPage(1)
          setFilters({ ...draft })
        }}
      >
        <label>
          节点名称 / ID
          <input
            value={draft.query || ''}
            maxLength={100}
            placeholder="搜索节点"
            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
          />
        </label>
        <label>
          任务发起人
          <select value={draft.user_id || ''} onChange={(e) => setDraft({ ...draft, user_id: e.target.value })}>
            <option value="">全部成员</option>
            {choices.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name} #{member.user_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          节点状态
          <select value={draft.state || 'all'} onChange={(e) => setDraft({ ...draft, state: e.target.value })}>
            <option value="all">全部状态</option>
            <option value="active">现存节点</option>
            <option value="deleted">已删除节点</option>
            <option value="unassigned">未关联节点</option>
          </select>
        </label>
        <label>
          开始日期
          <input
            type="date"
            value={draft.date_from || ''}
            max={draft.date_to || undefined}
            onChange={(e) => setDraft({ ...draft, date_from: e.target.value })}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={draft.date_to || ''}
            min={draft.date_from || undefined}
            onChange={(e) => setDraft({ ...draft, date_to: e.target.value })}
          />
        </label>
        <button type="submit">查询</button>
        <button
          type="button"
          onClick={() => {
            setDraft({})
            setFilters({})
            setPage(1)
          }}
        >
          重置
        </button>
      </form>
      <p>按北京时间的实际结算日期筛选。图表和明细统计全部匹配记录，不受当前页影响。</p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">正在加载统计…</p>
      ) : (
        <>
          <section className={styles.total} aria-label="画布累计消耗">
            <span>
              {Object.values(filters).some((value) => value && value !== 'all') ? '筛选结果消耗' : '累计消耗'}
            </span>
            <strong>{formatCredits(data.total_used_credits)} 积分</strong>
          </section>
          <p>
            按任务发起人拆分。无法可靠对应节点的历史费用及 Agent 推理列入“未关联节点”；未产生计费任务的编辑不计作消耗。
          </p>
          <div className={styles.charts}>
            <section className={styles.trend}>
              <h2>消耗趋势</h2>
              <small>有结算的日期 · 积分</small>
              <UsageTrend points={data.trend || []} />
            </section>
            <UsageBars
              title="成员消耗对比"
              items={(data.member_totals || []).map((member) => ({
                id: String(member.user_id),
                label: `${member.display_name} #${member.user_id}`,
                value: member.used_credits,
              }))}
            />
            <UsageBars
              title="节点消耗排行 · 前 10 项"
              items={(data.top_nodes || []).map((node) => ({
                id: node.node_id || 'unassigned',
                label: node.title + (node.deleted ? '（已删除）' : ''),
                value: node.used_credits,
              }))}
            />
          </div>
          <h2>节点消耗明细</h2>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>节点</th>
                  <th>任务发起人 / 实际消耗</th>
                  <th>节点合计</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((node) => (
                  <tr key={node.node_id || '__unassigned__'}>
                    <td>
                      <strong>{node.title}</strong>
                      {node.deleted && <span className={styles.badge}>已删除</span>}
                      {node.node_id && <small>{node.node_id}</small>}
                    </td>
                    <td>
                      {node.members.length ? (
                        node.members.map((member) => (
                          <div className={styles.member} key={member.user_id}>
                            <span>
                              {member.display_name} <small>#{member.user_id}</small>
                            </span>
                            <span>{formatCredits(member.used_credits)} 积分</span>
                          </div>
                        ))
                      ) : (
                        <span>暂无计费任务</span>
                      )}
                    </td>
                    <td>{formatCredits(node.used_credits)} 积分</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total === 0 && <p>暂无节点或消费记录。</p>}
          <nav className={styles.pager} aria-label="统计分页">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              上一页
            </button>
            <span>
              第 {page} 页 · 共 {data.total} 项
            </span>
            <button disabled={page * 50 >= data.total} onClick={() => setPage((p) => p + 1)}>
              下一页
            </button>
          </nav>
        </>
      )}
    </main>
  )
}

type CanvasNodeUsageMembers = CanvasStatistics['member_choices']
function UsageBars({ title, items }: { title: string; items: { id: string; label: string; value: number }[] }) {
  const maximum = Math.max(1, ...items.map((item) => item.value))
  return (
    <section className={styles.chart}>
      <h2>{title}</h2>
      {!items.length ? (
        <p>暂无匹配消耗</p>
      ) : (
        <ol aria-label={title}>
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <span title={item.label}>{item.label}</span>
                <strong>{formatCredits(item.value)}</strong>
              </div>
              <div className={styles.barTrack}>
                <div className={styles.bar} style={{ width: `${(item.value / maximum) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
function UsageTrend({ points }: { points: CanvasStatistics['trend'] }) {
  if (!points.length) return <p>暂无匹配消耗</p>
  const maximum = Math.max(1, ...points.map((point) => point.used_credits))
  const width = 640,
    plotHeight = 140,
    step = width / points.length
  return (
    <div className={styles.trendPlot}>
      <svg viewBox="0 0 660 190" role="img" aria-label="按结算日期统计的积分消耗趋势">
        <line x1="10" y1="160" x2="650" y2="160" stroke="#505a6e" />
        {points.map((point, i) => (
          <rect
            key={point.date}
            x={10 + i * step}
            y={160 - (point.used_credits / maximum) * plotHeight}
            width={Math.max(0.25, step * 0.7)}
            height={(point.used_credits / maximum) * plotHeight}
            fill="#77a9ed"
          >
            <title>
              {point.date}：{formatCredits(point.used_credits)} 积分
            </title>
          </rect>
        ))}
        <text x="10" y="14" fill="#aeb6c6" fontSize="12">
          {formatCredits(maximum)}
        </text>
        <text x="10" y="180" fill="#aeb6c6" fontSize="12">
          {points[0].date}
        </text>
        <text x="650" y="180" textAnchor="end" fill="#aeb6c6" fontSize="12">
          {points.length > 1 ? points[points.length - 1].date : ''}
        </text>
      </svg>
    </div>
  )
}
