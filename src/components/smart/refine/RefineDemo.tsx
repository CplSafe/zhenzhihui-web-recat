import { useEffect, useRef, useState } from 'react'
import StepProgress from '@/components/smart/StepProgress'
import { estimateRefineCredits, getDemoDueAt, type RefineDuration } from '@/utils/refineDelivery'
import { useRefineDemoStore, type RefineDemoTask } from '@/stores/refineDemo'
import { useTaskCenterStore } from '@/stores/taskCenter'
import { saveRefineDemoMedia } from '@/utils/refineDemoMedia'
import RefineOrder from './RefineOrder'
import styles from './RefineDemo.module.less'
import { registerUpdateDraftSaver } from '@/utils/updateDraftRegistry'
import { loadRefineCommentDraft, saveRefineCommentDraft } from '@/utils/refineCommentDraft'

interface Props {
  description: string
  script: string
  duration: RefineDuration
  ratio: string
  resolution: string
  materialCount: number
  images: string[]
  imageAssetIds: number[]
  ownerId: number
  workspaceId: number
  task?: RefineDemoTask
  initialDraftScreen?: 'preparing' | 'order'
  onDraftScreenChange?: (screen: 'preparing' | 'order') => void
  onCreated: (id: string) => void
  onEdit: () => void
}

const steps = [
  { key: 'script', label: '分镜脚本' },
  { key: 'submit', label: '提交精制任务' },
  { key: 'refine', label: '成片精修' },
  { key: 'accept', label: '你验收成片' },
]

/** 不连接后端的交互演示；不得作为真实订单或支付结果。 */
export default function RefineDemo({
  description,
  script,
  duration,
  ratio,
  resolution,
  materialCount,
  images,
  imageAssetIds,
  ownerId,
  workspaceId,
  task,
  initialDraftScreen = 'preparing',
  onDraftScreenChange,
  onCreated,
  onEdit,
}: Props) {
  const [draftScreen, setDraftScreen] = useState<'preparing' | 'order'>(initialDraftScreen)
  const screen = task ? (task.status === '待验收' || task.status === '已交付' ? 'delivered' : 'waiting') : draftScreen
  const [comment, setComment] = useState(() => (task ? loadRefineCommentDraft(ownerId, workspaceId, task.id) : ''))
  const commentRef = useRef(comment)
  commentRef.current = comment
  useEffect(
    () =>
      registerUpdateDraftSaver(() => {
        if (!task) return true
        return saveRefineCommentDraft(ownerId, workspaceId, task.id, commentRef.current)
      }),
    [ownerId, workspaceId, task],
  )
  const [shareMessage, setShareMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const submittingRef = useRef(false)
  const add = useRefineDemoStore((state) => state.add)
  const update = useRefineDemoStore((state) => state.update)
  const openList = useRefineDemoStore((state) => state.openList)
  const setDrawerExpanded = useTaskCenterStore((state) => state.setDrawerExpanded)
  const showTasks = () => {
    openList()
    setDrawerExpanded(true)
  }
  const dueText = task
    ? new Date(task.dueAt || getDemoDueAt(task.createdAt)).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Shanghai',
      })
    : '明天 18:00 前'
  const order = {
    duration,
    script: script || '不使用脚本',
    ratio,
    resolution,
    referenceModel: 'Seedance 2.5',
    count: 1,
    deliveryTime: '明天 18:00 前',
    credits: estimateRefineCredits(duration),
  }
  return (
    <main className={styles.page} data-refine-demo>
      <div className={styles.notice} role="status">
        演示模式：订单、积分和交付状态均为模拟，不会创建真实任务或扣除积分。
      </div>
      <div className={`smart__progress ${styles.stepFrame}`}>
        <StepProgress
          steps={steps}
          current={screen === 'preparing' ? 0 : screen === 'order' ? 1 : screen === 'waiting' ? 2 : 3}
        />
      </div>
      <div className="smart__projbar">
        <div className="smart__projbar-inner">
          <span className="smart__name-text">精制成片（演示）</span>
        </div>
      </div>
      <div className={styles.content}>
        {screen === 'preparing' && (
          <section className={`${styles.panel} ${styles.preparing}`}>
            <h1>制作中</h1>
            <div className={styles.requirement}>
              <span>我的描述</span>
              <p>{description}</p>
            </div>
            <div className={styles.message}>
              <h2>这条片子明天 18:00 前交付</h2>
              <p>我们正在按你的需求做这条片子。做好会出现在任务里并通知你，积分先冻结，超时没交全额退回。</p>
            </div>
            <div className={styles.buttonRow}>
              <button className={styles.secondary} type="button" onClick={onEdit}>
                返回修改需求
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftScreen('order')
                  onDraftScreenChange?.('order')
                }}
              >
                查看订单
              </button>
            </div>
          </section>
        )}
        {screen === 'order' && (
          <>
            <div className={styles.orderHeading}>
              <h1>精制成片</h1>
              <p>{description}</p>
            </div>
            <RefineOrder
              order={order}
              submitting={submitting}
              error={submitError}
              onEdit={onEdit}
              onConfirm={async () => {
                if (submittingRef.current) return
                submittingRef.current = true
                setSubmitting(true)
                setSubmitError('')
                const id = globalThis.crypto.randomUUID()
                try {
                  const materials = await saveRefineDemoMedia(id, ownerId, workspaceId, images, imageAssetIds)
                  const createdAt = Date.now()
                  add({
                    id,
                    ownerId,
                    workspaceId,
                    description,
                    script: script || '不使用脚本',
                    duration,
                    ratio,
                    resolution,
                    credits: order.credits,
                    materialCount,
                    materials,
                    createdAt,
                    dueAt: getDemoDueAt(createdAt),
                    status: '精修中',
                    revision: 0,
                  })
                  onCreated(id)
                  showTasks()
                } catch {
                  setSubmitError('素材保存失败，请检查浏览器存储空间后重试。')
                } finally {
                  submittingRef.current = false
                  setSubmitting(false)
                }
              }}
            />
          </>
        )}
        {screen === 'waiting' && (
          <section className={`${styles.panel} ${styles.waiting}`}>
            <div className={styles.waitHeader}>
              <div>
                <h1>
                  {task?.status === '积分已退回'
                    ? '演示积分已退回'
                    : task?.status === '超时改期'
                      ? '制作中，顾问会联系你'
                      : '任务已提交，明天来验收成片'}
                </h1>
                <p>
                  {task?.status === '积分已退回'
                    ? '本次演示任务已模拟退回全部积分。'
                    : '积分先冻结，成片交付时才扣；超时没交全额退回。'}
                </p>
              </div>
              {task?.status !== '积分已退回' && (
                <div className={styles.deadline}>
                  <span>预计交付</span>
                  <strong>{dueText}</strong>
                  <small>前交付</small>
                </div>
              )}
            </div>
            <ol className={styles.phases}>
              <li>
                <span>制作画面</span>
              </li>
              <li>
                <span>成片精修</span>
              </li>
              <li>
                <span>等待你验收</span>
              </li>
            </ol>
            <div className={styles.buttonRow}>
              <button className={styles.secondary} type="button" onClick={showTasks}>
                查看我的精制任务
              </button>
              {task?.status !== '积分已退回' && (
                <button
                  type="button"
                  onClick={() => {
                    if (task) {
                      update(task.id, ownerId, workspaceId, { status: '待验收', deliveredAt: Date.now() })
                      showTasks()
                    }
                  }}
                >
                  演示：查看交付页
                </button>
              )}
              {task?.status === '精修中' && (
                <button
                  className={styles.secondary}
                  type="button"
                  onClick={() => task && update(task.id, ownerId, workspaceId, { status: '超时改期' })}
                >
                  演示：模拟超时
                </button>
              )}
              {task?.status === '超时改期' && (
                <button
                  className={styles.secondary}
                  type="button"
                  onClick={() => update(task.id, ownerId, workspaceId, { status: '积分已退回' })}
                >
                  演示：模拟退款
                </button>
              )}
            </div>
            <div className={styles.help}>
              <h2>有问题？</h2>
              <p>临时改需求、不想做了、内容很急，可以联系客服。</p>
              <a href="tel:13681065734">136 8106 5734</a>
              <p>工作日 9:00–18:00</p>
            </div>
          </section>
        )}
        {screen === 'delivered' && (
          <div className={styles.delivery}>
            <section className={`${styles.panel} ${styles.videoPanel}`}>
              <h1>精修成片</h1>
              <video
                className={styles.video}
                controls
                preload="metadata"
                src="/tutorials/smart-create.mp4"
                aria-label="演示视频"
              />
              <p className={styles.videoNote}>示例视频为操作教程，仅用于演示播放器，并非生成成片。</p>
              <dl className={styles.deliveryInfo}>
                <div>
                  <dt>提交时间</dt>
                  <dd>{task ? new Date(task.createdAt).toLocaleString('zh-CN') : '演示数据'}</dd>
                </div>
                <div>
                  <dt>交付时间</dt>
                  <dd>{task?.deliveredAt ? new Date(task.deliveredAt).toLocaleString('zh-CN') : '演示数据'}</dd>
                </div>
                <div>
                  <dt>消耗积分</dt>
                  <dd>{order.credits.toLocaleString('zh-CN')}</dd>
                </div>
              </dl>
              <div className={styles.buttonRow}>
                <a className={styles.download} href="/tutorials/smart-create.mp4" download="精制演示视频.mp4">
                  下载示例视频
                </a>
                <button
                  className={styles.secondary}
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(window.location.href)
                      setShareMessage('已复制演示链接，仅当前浏览器可查看。')
                    } catch {
                      setShareMessage('复制失败，请从地址栏复制演示链接。')
                    }
                  }}
                >
                  分享链接
                </button>
              </div>
              <p role="status">{shareMessage}</p>
            </section>
            <section className={`${styles.panel} ${styles.editPanel}`}>
              <h2>这条片子想改？</h2>
              <p>历史生成：精修成片{task?.revision ? `（第 ${task.revision + 1} 版）` : ''}</p>
              <label htmlFor="refine-comment">修改意见</label>
              <textarea
                id="refine-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="写下要改的地方"
              />
              <p>再冻结 {order.credits.toLocaleString('zh-CN')} 积分 · 交付才扣</p>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  disabled={!comment.trim()}
                  onClick={() => {
                    if (task)
                      update(task.id, ownerId, workspaceId, {
                        status: '精修中',
                        revision: task.revision + 1,
                        revisionNote: comment,
                        deliveredAt: undefined,
                        dueAt: getDemoDueAt(Date.now()),
                      })
                    setComment('')
                    if (task) saveRefineCommentDraft(ownerId, workspaceId, task.id, '')
                    showTasks()
                  }}
                >
                  提交修改，重新排期
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
