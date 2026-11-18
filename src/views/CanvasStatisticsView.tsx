import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCanvasStatistics, type CanvasStatistics, type CanvasStatisticsFilters } from '@/api/canvasApi'
import { getBusinessErrorMessage } from '@/api/business'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { formatCredits } from '@/utils/creditsFormat'
import styles from './CanvasStatisticsView.module.css'

const formatUsageCredits = (value: number) => formatCredits(value, 3)

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
    <main className={styles.page} aria-label="画布数据统计" tabIndex={0}>
      <div className={styles.content}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate(`/canvas/${canvasId}`)}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回画布
          </button>
          <h1>画布数据统计</h1>
          <button onClick={() => setAttempt((v) => v + 1)}>
            <RefreshCw size={15} aria-hidden="true" />
            刷新
          </button>
        </header>
        <p className={styles.intro}>查看这张画布的积分去向，查看成员与节点明细，以及缺少明细的历史分摊。</p>
        <section className={styles.filterPanel} aria-label="统计筛选">
          <h2>
            <SlidersHorizontal size={16} aria-hidden="true" />
            筛选记录
          </h2>
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
              使用成员
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
            <div className={styles.filterActions}>
              <button type="submit" className={styles.primary}>
                <Search size={15} aria-hidden="true" />
                查询
              </button>
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
            </div>
          </form>
          <p className={styles.filterHint}>日期按北京时间结算日统计，图表涵盖全部匹配记录。</p>
        </section>
        {error ? (
          <div className={styles.notice} role="alert">
            <p>{error}</p>
            <button onClick={() => setAttempt((v) => v + 1)}>重新加载</button>
          </div>
        ) : !data ? (
          <div className={styles.loading} role="status">
            <p>正在加载统计…</p>
            <div />
            <div />
          </div>
        ) : (
          <>
            <section className={styles.total} aria-label="画布累计消耗">
              <span>
                {Object.values(filters).some((value) => value && value !== 'all') ? '筛选结果消耗' : '累计消耗'}
              </span>
              <strong>{formatUsageCredits(data.total_used_credits)} 积分</strong>
              <span className={styles.totalNote}>实际扣费 · 包含重试 · 不含冻结积分</span>
            </section>
            {!!data.historical_allocated_credits && (
              <p className={styles.detailHint}>
                其中 {formatUsageCredits(data.historical_allocated_credits)} 积分为历史分摊：总额来自实际扣费，
                缺少节点明细的部分按可核实的历史使用成员均分（含已离开成员），不代表个人实际操作金额，不会再次扣费。
              </p>
            )}

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
                  label: displayNodeName(node) + (node.deleted ? '（已删除）' : ''),
                  value: node.used_credits,
                }))}
              />
            </div>
            <div className={styles.detailHeader}>
              <h2>节点消耗明细</h2>
              <span>共 {data.total} 项 · 含已删除节点</span>
            </div>
            <p className={styles.detailHint}>
              总额包含从历史制作记录恢复的实际扣费；复制或引用素材不重复计费。历史分摊归入“未关联节点”，
              与有真实明细的消费分别标注。仍无法核实画布归属的团队消费不会重复计入各画布。
            </p>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>节点</th>
                    <th>成员 / 消耗（含历史分摊）</th>
                    <th className={styles.numeric}>节点合计</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((node) => (
                    <tr key={node.node_id || '__unassigned__'}>
                      <td>
                        <strong>{displayNodeName(node)}</strong>
                        {node.deleted && <span className={styles.badge}>已删除</span>}
                        {node.node_id && (
                          <details className={styles.nodeIdentity}>
                            <summary>节点 ID</summary>
                            <small>{node.node_id}</small>
                          </details>
                        )}
                      </td>
                      <td>
                        {node.members.length ? (
                          node.members.map((member) => (
                            <div className={styles.member} key={member.user_id}>
                              <span>
                                {member.display_name} <small>#{member.user_id}</small>
                              </span>
                              <span>
                                {formatUsageCredits(member.used_credits)} 积分
                                {!!member.historical_allocated_credits && (
                                  <small>
                                    （含历史分摊 {formatUsageCredits(member.historical_allocated_credits)}）
                                  </small>
                                )}
                              </span>
                            </div>
                          ))
                        ) : (
                          <span className={styles.muted}>暂无计费任务</span>
                        )}
                      </td>
                      <td>{formatUsageCredits(node.used_credits)} 积分</td>
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
      </div>
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
                <strong>{formatUsageCredits(item.value)}</strong>
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
    step = width / points.length,
    barWidth = Math.min(32, step * 0.7)
  return (
    <div className={styles.trendPlot}>
      <svg viewBox="0 0 660 190" role="img" aria-label="按结算日期统计的积分消耗趋势">
        {[20, 90, 160].map((y) => (
          <line key={y} x1="10" y1={y} x2="650" y2={y} stroke="currentColor" opacity="0.12" />
        ))}
        {points.map((point, i) => (
          <rect
            key={point.date}
            x={10 + i * step + (step - barWidth) / 2}
            y={160 - (point.used_credits / maximum) * plotHeight}
            width={Math.max(0.25, barWidth)}
            rx="2"
            height={(point.used_credits / maximum) * plotHeight}
            fill="#a296ed"
          >
            <title>
              {point.date}：{formatUsageCredits(point.used_credits)} 积分
            </title>
          </rect>
        ))}
        <text x="10" y="14" fill="#aeb6c6" fontSize="12">
          {formatUsageCredits(maximum)}
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

function displayNodeName(node: { title: string; node_id: string }) {
  return node.node_id && node.title === `节点 ${node.node_id}` ? '未保留名称的节点' : node.title
}
