import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCanvasStatistics, type CanvasStatistics } from '@/api/canvasApi'
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
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState<CanvasStatistics | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setData(null)
    setError('')
    void getCanvasStatistics(workspaceId, canvasId, page)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((err) => {
        if (active) setError(getBusinessErrorMessage(err, '画布统计加载失败'))
      })
    return () => {
      active = false
    }
  }, [workspaceId, canvasId, page, attempt])
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button onClick={() => navigate(`/canvas/${canvasId}`)}>← 返回画布</button>
        <h1>画布数据统计</h1>
        <button onClick={() => setAttempt((v) => v + 1)}>刷新</button>
      </header>
      <p>统计所有成员的实际扣费，包含重试；未扣除的冻结积分不计入。删除节点不会扣减历史消耗。</p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">正在加载统计…</p>
      ) : (
        <>
          <section className={styles.total} aria-label="画布累计消耗">
            <span>累计消耗</span>
            <strong>{formatCredits(data.total_used_credits)} 积分</strong>
          </section>
          <p>
            按任务发起人拆分。无法可靠对应节点的历史费用及 Agent 推理列入“未关联节点”；未产生计费任务的编辑不计作消耗。
          </p>
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
