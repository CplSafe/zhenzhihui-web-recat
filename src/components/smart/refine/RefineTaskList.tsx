import { Modal } from 'antd'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRefineDemoStore, type RefineDemoTask } from '@/stores/refineDemo'
import { useTaskCenterStore } from '@/stores/taskCenter'
import { formatRefineDuration } from '@/utils/refineDelivery'
import styles from './RefineTaskList.module.less'
import RefineMaterials from './RefineMaterials'

interface Props {
  ownerId: number
  workspaceId: number
}

export default function RefineTaskList({ ownerId, workspaceId }: Props) {
  const tasks = useRefineDemoStore((state) => state.tasks)
  const closeDrawer = useTaskCenterStore((state) => state.setDrawerExpanded)
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [script, setScript] = useState('')
  const [tier, setTier] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const scoped = useMemo(
    () => tasks.filter((task) => task.ownerId === ownerId && task.workspaceId === workspaceId),
    [tasks, ownerId, workspaceId],
  )
  const selected = scoped.find((task) => task.id === selectedId)
  const hasFilters = Boolean(status || script || tier || query.trim())
  const visible = scoped.filter(
    (task) =>
      (!status || task.status === status) &&
      (!script || task.script === script) &&
      (!tier ||
        (tier === '≤1分钟'
          ? task.duration <= 60
          : tier === '1~3分钟'
            ? task.duration > 60 && task.duration <= 180
            : task.duration > 180)) &&
      task.description.includes(query.trim()),
  )
  const open = (task: RefineDemoTask) => {
    setSelectedId('')
    closeDrawer(false)
    navigate(`/smart?refineDemo=${encodeURIComponent(task.id)}`)
  }
  return (
    <div className={styles.list}>
      <div className={styles.intro}>
        <div>
          <strong>精制任务</strong>
          <span>{scoped.length} 条</span>
        </div>
        <p className={styles.note}>演示任务保存在当前浏览器，不会扣除积分</p>
      </div>
      <div className={styles.filters}>
        <label className={styles.search}>
          搜索
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索需求" />
        </label>
        <label>
          状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option>待精修</option>
            <option>精修中</option>
            <option>待验收</option>
            <option>已交付</option>
            <option>超时改期</option>
            <option>积分已退回</option>
          </select>
        </label>
        <label>
          类型
          <select value={script} onChange={(e) => setScript(e.target.value)}>
            <option value="">全部类型</option>
            <option>不使用脚本</option>
            <option>电商广告</option>
            <option>本地生活广告</option>
            <option>测评视频</option>
          </select>
        </label>
        <label>
          时长
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">全部时长</option>
            <option>≤1分钟</option>
            <option>1~3分钟</option>
            <option>3~5分钟</option>
          </select>
        </label>
      </div>
      <div className={styles.listHeader}>
        <span aria-live="polite">{hasFilters ? `筛选结果 · ${visible.length} 条` : '任务列表'}</span>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setStatus('')
              setScript('')
              setTier('')
              setQuery('')
            }}
          >
            清除筛选
          </button>
        )}
      </div>
      {visible.length ? (
        visible.map((task) => (
          <button type="button" key={task.id} className={styles.item} onClick={() => setSelectedId(task.id)}>
            <span className={styles.itemTop}>
              <span className={styles.mode}>T+1 精制</span>
              <span
                className={`${styles.status} ${['超时改期', '积分已退回'].includes(task.status) ? styles.statusWarning : ''}`}
              >
                {task.status}
              </span>
            </span>
            <strong className={styles.itemTitle}>{task.description || '精制成片'}</strong>
            <span className={styles.itemMeta}>
              {task.script} · {formatRefineDuration(task.duration)} · {task.ratio}
            </span>
            <span className={styles.itemBottom}>
              <span>
                {['超时改期', '积分已退回', '已交付', '待验收'].includes(task.status) ? '承诺交付' : '预计交付'}{' '}
                {task.dueAt
                  ? new Date(task.dueAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : '—'}
              </span>
              <span>{task.credits.toLocaleString('zh-CN')} 积分</span>
            </span>
          </button>
        ))
      ) : (
        <div className={styles.empty}>
          <strong>{scoped.length ? '暂无符合条件的精制演示任务' : '暂无精制任务'}</strong>
          <span>
            {scoped.length ? '调整筛选条件，或清除筛选后查看全部任务。' : '提交精制任务后，可在这里查看进度与交付。'}
          </span>
        </div>
      )}
      <Modal
        open={Boolean(selected)}
        title="精制任务详情（演示）"
        className={styles.detailModal}
        width={680}
        zIndex={1101}
        onCancel={() => setSelectedId('')}
        footer={
          selected ? (
            <button type="button" className={styles.open} onClick={() => open(selected)}>
              进入任务页
            </button>
          ) : null
        }
      >
        {selected && (
          <div className={styles.detailBody}>
            <div className={styles.detailSummary}>
              <span className={styles.mode}>T+1 精制</span>
              <span
                className={`${styles.status} ${['超时改期', '积分已退回'].includes(selected.status) ? styles.statusWarning : ''}`}
              >
                {selected.status}
              </span>
            </div>
            <section className={`${styles.detailSection} ${styles.detailDescriptionSection}`}>
              <h3>我的描述</h3>
              <p className={styles.detailDescription}>{selected.description || '未填写'}</p>
            </section>
            <section className={`${styles.detailSection} ${styles.detailMaterialsSection}`}>
              <h3>
                素材 <span>{selected.materialCount} 个</span>
              </h3>
              <RefineMaterials
                media={selected.materials}
                count={selected.materialCount}
                ownerId={ownerId}
                workspaceId={workspaceId}
              />
            </section>
            <section className={`${styles.detailSection} ${styles.detailInfoSection}`}>
              <h3>任务信息</h3>
              <dl className={styles.details}>
                <div>
                  <dt>类型</dt>
                  <dd>{selected.script}</dd>
                </div>
                <div>
                  <dt>成片时长</dt>
                  <dd>{formatRefineDuration(selected.duration)}</dd>
                </div>
                <div>
                  <dt>画面比例</dt>
                  <dd>{selected.ratio}</dd>
                </div>
                <div>
                  <dt>积分</dt>
                  <dd>{selected.credits.toLocaleString('zh-CN')} 积分（模拟）</dd>
                </div>
                <div>
                  <dt>当前阶段</dt>
                  <dd>{selected.status}</dd>
                </div>
              </dl>
            </section>
            <section className={styles.detailSection}>
              <h3>交付时间</h3>
              <dl className={styles.details}>
                <div>
                  <dt>提交时间</dt>
                  <dd>{new Date(selected.createdAt).toLocaleString('zh-CN')}</dd>
                </div>
                <div>
                  <dt>承诺交付</dt>
                  <dd>{selected.dueAt ? new Date(selected.dueAt).toLocaleString('zh-CN') : '演示时间未记录'}</dd>
                </div>
              </dl>
            </section>
            {selected.revisionNote && (
              <section className={styles.detailSection}>
                <h3>修改要求</h3>
                <p className={styles.detailDescription}>{selected.revisionNote}</p>
              </section>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
