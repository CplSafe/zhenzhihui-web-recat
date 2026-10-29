import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type HTMLAttributes } from 'react'
import type { Node } from '@xyflow/react'
import { Alert, Button, Drawer, Dropdown, Input, Modal, Radio, Select, Space, Spin, Tag } from 'antd'
import { cancelHdTask, hdServiceError, listHdTasks, preflightHd, quoteHd, submitHd } from '@/api/canvasHd'
import type { HdItem, HdKind, HdQuote, HdSource, HdTarget, HdTask, HdTaskPage } from '@/api/canvasHd'
import {
  HD_STATUS_LABELS,
  hdSources,
  hdTargets,
  isHdActive,
  validateHdPreflight,
  validateHdQuote,
} from '@/utils/canvasHd'
import { assetStreamUrl } from '@/utils/assetUrl'
import { creditsLabel } from '@/utils/creditsFormat'
import { downloadToDisk } from '@/utils/downloadToDisk'
import { openMemberCenterTab, requestConfirm, showToast } from '@/stores/ui'
import styles from './CanvasHdWorkspace.module.css'

export interface HdRequest {
  ids: string[]
  key: number
  compareTaskId?: string
  openTasks?: boolean
}
interface Props {
  workspaceId: number
  canvasId: number
  nodes: Node[]
  request: HdRequest | null
  onCloseRequest: () => void
  onTasks: (tasks: HdTask[]) => void
  onModalChange: (open: boolean) => void
}
const kindLabel = (kind: HdKind) => (kind === 'video' ? '视频超分' : '图片超清')
const statusColor = { queued: 'gold', processing: 'blue', completed: 'green', failed: 'red', cancelled: 'default' }

/** 服务端负责筛选与分页；原生语义表格避免为两个只读列表引入完整表格引擎。 */
function Table<T extends object>(props: {
  rowKey: keyof T
  dataSource: T[]
  columns: Array<{ title: string; dataIndex?: keyof T; fixed?: string; render?: (value: unknown, row: T) => ReactNode }>
  pagination:
    | false
    | { current: number; pageSize: number; total: number; showSizeChanger: boolean; onChange: (page: number) => void }
  size?: string
  scroll?: { x: number }
  loading?: boolean
  locale?: { emptyText: string }
  onRow?: (row: T) => HTMLAttributes<HTMLTableRowElement>
}) {
  const paging = props.pagination
  return (
    <Spin spinning={Boolean(props.loading)}>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="高清任务明细">
        <table className={styles.table} style={props.scroll ? { minWidth: props.scroll.x } : undefined}>
          <thead>
            <tr>
              {props.columns.map((column) => (
                <th scope="col" key={column.title}>
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.dataSource.map((row) => (
              <tr key={String(row[props.rowKey])} {...props.onRow?.(row)}>
                {props.columns.map((column) => (
                  <td key={column.title} className={column.fixed === 'right' ? styles.fixedCell : undefined}>
                    {column.render
                      ? column.render(column.dataIndex ? row[column.dataIndex] : undefined, row)
                      : column.dataIndex
                        ? (row[column.dataIndex] as ReactNode)
                        : '—'}
                  </td>
                ))}
              </tr>
            ))}
            {!props.dataSource.length && (
              <tr>
                <td colSpan={props.columns.length}>{props.locale?.emptyText || '暂无条目'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {paging && (
        <div className={styles.pagination}>
          <span>
            共 {paging.total} 条 · 每页 {paging.pageSize} 条 · 第 {paging.current} 页
          </span>
          <Button disabled={paging.current <= 1 || props.loading} onClick={() => paging.onChange(paging.current - 1)}>
            上一页
          </Button>
          <Button
            disabled={paging.current * paging.pageSize >= paging.total || props.loading}
            onClick={() => paging.onChange(paging.current + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </Spin>
  )
}

export default function CanvasHdWorkspace({
  workspaceId,
  canvasId,
  nodes,
  request,
  onCloseRequest,
  onTasks,
  onModalChange,
}: Props) {
  const [drawer, setDrawer] = useState(false)
  const [orderKind, setOrderKind] = useState<HdKind | null>(null)
  const [sources, setSources] = useState<HdSource[]>([])
  const [items, setItems] = useState<HdItem[]>([])
  const [checking, setChecking] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [target, setTarget] = useState<HdTarget>({ resolution: '', fps: 0 })
  const [quote, setQuote] = useState<HdQuote | null>(null)
  const [quotedFor, setQuotedFor] = useState('')
  const [quoting, setQuoting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const [canvasActive, setCanvasActive] = useState(0)
  const [quoteTick, setQuoteTick] = useState(0)
  const submitKey = useRef('')
  const submitLock = useRef(false)
  const scope = `${workspaceId}:${canvasId}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const callbacks = useRef({ onTasks, onCloseRequest })
  callbacks.current = { onTasks, onCloseRequest }
  const [taskPage, setTaskPage] = useState<HdTaskPage | null>(null)
  const allTasksRef = useRef<HdTask[]>([])
  const [taskError, setTaskError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [filters, setFilters] = useState({ status: '', kind: '', canvas_id: 0, keyword: '', page: 1 })
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [actionId, setActionId] = useState('')
  const [compare, setCompare] = useState<HdTask | null>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const eligible = useMemo(() => items.filter((item) => item.eligible), [items])
  const choices = useMemo(() => hdTargets(eligible), [eligible])
  const quoteFingerprint = JSON.stringify({ sources: eligible.map((item) => [item.node_id, item.asset_id]), target })
  const validQuote = quote && quotedFor === quoteFingerprint && validateHdQuote(quote, eligible, target)
  const canSubmit = Boolean(
    validQuote &&
    quote.can_afford &&
    quote.balance >= quote.total_credits &&
    !checking &&
    !quoting &&
    !submitting &&
    (!orderError || submissionUncertain),
  )

  const closeOrder = useCallback(() => {
    if (submitLock.current) return
    setOrderKind(null)
    setSources([])
    setItems([])
    setQuote(null)
    setOrderError('')
    setSubmissionUncertain(false)
    callbacks.current.onCloseRequest()
  }, [])

  useEffect(() => {
    scopeRef.current = scope
    setDrawer(false)
    setCompare(null)
    setOrderKind(null)
    setSources([])
    setTaskPage(null)
    setTaskError('')
    setSubmitting(false)
    submitLock.current = false
    return () => {
      scopeRef.current = ''
    }
  }, [scope])

  // 工作区隔离、页面关闭只取消读取，不取消已创建的服务端任务。
  useEffect(() => {
    if (!workspaceId || !canvasId) return
    const controller = new AbortController()
    let timer: number
    let unavailable = false
    const sync = async () => {
      try {
        const tasks: HdTask[] = []
        let page = 1
        let result: HdTaskPage
        do {
          result = await listHdTasks(workspaceId, { canvas_id: canvasId, page }, controller.signal)
          if (!Array.isArray(result.items) || !Number.isFinite(result.total))
            throw new Error('高清任务列表返回数据不完整')
          tasks.push(...result.items)
          page += 1
        } while (tasks.length < result.total && result.items.length > 0)
        if (!controller.signal.aborted) {
          allTasksRef.current = tasks
          setCanvasActive(tasks.filter(isHdActive).length)
          callbacks.current.onTasks(tasks)
        }
      } catch (error) {
        unavailable = [404, 501].includes(Number((error as { status?: number })?.status))
        // 服务未部署时保持画布可用；打开面板后显示具体错误，不把缺失接口当作空列表。
      } finally {
        if (!controller.signal.aborted && !unavailable) timer = window.setTimeout(sync, 8000)
      }
    }
    void sync()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [workspaceId, canvasId, refresh])

  useEffect(() => {
    if (!drawer || !workspaceId) return
    const controller = new AbortController()
    let timer: number
    const load = async () => {
      setLoadingTasks(true)
      try {
        const result = await listHdTasks(workspaceId, filters, controller.signal)
        if (!Array.isArray(result.items) || !result.stats || !Array.isArray(result.canvases))
          throw new Error('高清任务列表返回数据不完整')
        if (!controller.signal.aborted) {
          setTaskPage(result)
          setTaskError('')
        }
      } catch (error) {
        if (!controller.signal.aborted) setTaskError(hdServiceError(error))
      } finally {
        if (!controller.signal.aborted) {
          setLoadingTasks(false)
          timer = window.setTimeout(load, 8000)
        }
      }
    }
    void load()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [drawer, workspaceId, filters, refresh])

  useEffect(() => {
    if (!request) return
    if (request.openTasks) {
      setDrawer(true)
      callbacks.current.onCloseRequest()
      return
    }
    if (request.compareTaskId) {
      const task = allTasksRef.current.find((item) => item.id === request.compareTaskId)
      if (task?.result) setCompare(task)
      else {
        setDrawer(true)
        showToast('正在加载高清任务，请在任务列表中查看对比', 'info')
      }
      callbacks.current.onCloseRequest()
      return
    }
    const selected = hdSources(nodesRef.current.filter((node) => request.ids.includes(node.id)))
    setSources(selected)
    setOrderKind(selected.length && selected.every((item) => item.kind === selected[0].kind) ? selected[0].kind : null)
    setQuote(null)
    setItems([])
    setOrderError('')
    setSubmissionUncertain(false)
    submitKey.current = crypto.randomUUID()
  }, [request])

  useEffect(() => {
    if (!orderKind || !sources.length) return
    if (!workspaceId || !canvasId) {
      setOrderError('请先等待画布保存完成，再发起高清处理')
      return
    }
    const controller = new AbortController()
    setChecking(true)
    setItems([])
    setQuote(null)
    setOrderError('')
    const selected = sources.filter((item) => item.kind === orderKind)
    preflightHd(workspaceId, canvasId, selected, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        const checked = validateHdPreflight(selected, result.items)
        const options = hdTargets(checked)
        setItems(checked)
        setTarget({ resolution: options.resolutions[0] || '', fps: 0 })
      })
      .catch((error) => {
        if (!controller.signal.aborted) setOrderError(hdServiceError(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    return () => controller.abort()
  }, [workspaceId, canvasId, orderKind, sources])

  useEffect(() => {
    setQuote(null)
    if (!eligible.length || !target.resolution) return
    const controller = new AbortController()
    setQuoting(true)
    setOrderError('')
    const timer = window.setTimeout(() => {
      quoteHd(workspaceId, canvasId, eligible, target, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          if (!validateHdQuote(result, eligible, target)) throw new Error('报价已过期或明细不完整，请重新获取报价')
          setQuote(result)
          setQuotedFor(quoteFingerprint)
          submitKey.current = crypto.randomUUID()
        })
        .catch((error) => {
          if (!controller.signal.aborted) setOrderError(hdServiceError(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoting(false)
        })
    }, 300)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [workspaceId, canvasId, eligible, target, quoteTick, quoteFingerprint])

  useEffect(() => {
    onModalChange(Boolean(drawer || sources.length || compare || request))
  }, [drawer, sources.length, compare, request, onModalChange])
  useEffect(() => () => onModalChange(false), [onModalChange])

  const submit = async () => {
    if (!quote || !canSubmit || submitLock.current) return
    if (!validateHdQuote(quote, eligible, target)) {
      setQuote(null)
      setOrderError('报价已过期，请重新获取报价')
      return
    }
    const currentScope = scope
    submitLock.current = true
    setSubmitting(true)
    try {
      // 同一报价的不确定结果重试必须复用幂等键；不在浏览器循环创建付费任务。
      const result = await submitHd(workspaceId, canvasId, quote.quote_id, submitKey.current)
      if (scopeRef.current !== currentScope) return
      if (!Array.isArray(result.tasks) || !result.tasks.length)
        throw new Error('提交结果未确认，请使用原报价重试，系统按同一请求去重')
      setSources([])
      setOrderKind(null)
      setQuote(null)
      callbacks.current.onCloseRequest()
      setDrawer(true)
      setRefresh((value) => value + 1)
      showToast(`已创建 ${result.tasks.length} 个高清任务，选区已保留`, 'success')
    } catch (error) {
      if (scopeRef.current === currentScope) {
        const rejected = [400, 402, 403, 409, 422].includes(Number((error as { status?: number })?.status))
        setSubmissionUncertain(!rejected)
        if (rejected) setQuote(null)
        setOrderError(
          rejected
            ? hdServiceError(error)
            : '提交结果尚未确认，请使用“确认并开始”重试同一请求，系统会去重；也可到任务台查看。',
        )
      }
    } finally {
      if (scopeRef.current === currentScope) {
        submitLock.current = false
        setSubmitting(false)
      }
    }
  }

  const retry = (task: HdTask) => {
    if (task.canvas_id !== canvasId) {
      showToast('请先打开任务所属画布后重试', 'info')
      return
    }
    const source = nodesRef.current.find((node) => node.id === task.source.node_id)
    if (!source || Number(source.data.assetId) !== task.source.asset_id) {
      showToast('源节点已删除或素材已更换，请从当前素材重新发起', 'info')
      return
    }
    setDrawer(false)
    setItems([])
    setQuote(null)
    setSubmissionUncertain(false)
    setSources([task.source])
    setOrderKind(task.source.kind)
    // 参数回填由校验完成后处理，仍需重新报价确认。
    retryTargetRef.current = task.target
    submitKey.current = crypto.randomUUID()
  }
  const retryTargetRef = useRef<HdTarget | null>(null)
  useEffect(() => {
    const saved = retryTargetRef.current
    if (!checking && eligible.length && saved) {
      retryTargetRef.current = null
      if (choices.resolutions.includes(saved.resolution) && (!saved.fps || choices.frameRates.includes(saved.fps)))
        setTarget(saved)
      else setOrderError('原任务参数当前已不支持，请重新选择目标规格')
    }
  }, [checking, eligible, choices])

  const cancel = async (task: HdTask) => {
    if (!(await requestConfirm('仅排队中的任务可以取消。确认取消并申请原路退回积分吗？', { title: '取消高清任务' })))
      return
    const currentScope = scope
    setActionId(task.id)
    try {
      await cancelHdTask(workspaceId, task.id)
      if (scopeRef.current === currentScope) setRefresh((value) => value + 1)
    } catch (error) {
      if (scopeRef.current === currentScope) showToast(hdServiceError(error), 'error')
    } finally {
      if (scopeRef.current === currentScope) setActionId('')
    }
  }
  const setFilter = (patch: Partial<typeof filters>) => setFilters((old) => ({ ...old, ...patch, page: 1 }))
  const activeCount = taskPage?.stats.active ?? canvasActive
  return (
    <>
      <div className={styles.desk}>
        <Dropdown
          menu={{
            items: [
              { key: 'hd', label: '高清任务' },
              { key: 'review', label: 'AI 审查记录（待开放）', disabled: true },
            ],
            onClick: () => setDrawer(true),
          }}
          trigger={['click']}
        >
          <Button>▣ 任务台</Button>
        </Dropdown>
        <Button onClick={() => setDrawer(true)}>高清任务{activeCount ? ` · ${activeCount}` : ''}</Button>
      </div>
      <Modal
        zIndex={1800}
        open={Boolean(sources.length && !orderKind)}
        title="选择高清处理类型"
        onCancel={closeOrder}
        footer={null}
      >
        <p>视频和图片独立处理，提交后选区会保留，可继续发起另一类任务。</p>
        <Space>
          {(['video', 'image'] as const).map((kind) => (
            <Button key={kind} onClick={() => setOrderKind(kind)}>
              {kindLabel(kind)}（{sources.filter((item) => item.kind === kind).length}）
            </Button>
          ))}
        </Space>
      </Modal>
      <Modal
        zIndex={1800}
        open={Boolean(orderKind)}
        title={`高清处理确认 · ${kindLabel(orderKind || 'video')} · ${sources.filter((item) => item.kind === orderKind).length === 1 ? sources.find((item) => item.kind === orderKind)?.name : `${sources.filter((item) => item.kind === orderKind).length} 条`}`}
        width={760}
        onCancel={closeOrder}
        maskClosable={!submitting}
        closable={!submitting}
        keyboard={!submitting}
        footer={[
          <Button key="cancel" disabled={submitting} onClick={closeOrder}>
            取消
          </Button>,
          <Button key="submit" type="primary" disabled={!canSubmit} loading={submitting} onClick={() => void submit()}>
            确认并开始（扣积分）
          </Button>,
        ]}
      >
        <Spin spinning={checking}>
          {orderError && <Alert type="error" showIcon message={orderError} />}
          {items.some((item) => !item.eligible) && (
            <Alert
              type="warning"
              showIcon
              message={`已自动跳过 ${items.filter((item) => !item.eligible).length} 条不支持或处理中的内容${eligible.length ? '' : '（所选内容全部）'}`}
            />
          )}
          <p>任务范围：共 {eligible.length} 条</p>
          <details open={items.length > 1}>
            <summary>逐条明细与跳过原因</summary>
            <Table
              size="small"
              pagination={false}
              rowKey="node_id"
              dataSource={items}
              columns={[
                { title: '源文件', dataIndex: 'name' },
                { title: '源规格', dataIndex: 'source_spec' },
                {
                  title: '单条预估 / 原因',
                  render: (_, item: HdItem) => {
                    if (!item.eligible) return item.reason || '暂不支持高清处理'
                    const credits = quote?.items.find((row) => row.node_id === item.node_id)?.credits
                    return credits === undefined ? '待报价' : creditsLabel(credits)
                  },
                },
              ]}
            />
          </details>
          <div className={styles.field}>
            <strong>目标分辨率</strong>
            <Radio.Group
              value={target.resolution}
              onChange={(event) => setTarget((old) => ({ ...old, resolution: event.target.value }))}
              options={choices.resolutions}
              optionType="button"
              buttonStyle="solid"
              disabled={submitting || submissionUncertain}
            />
            {!checking && eligible.length > 0 && !choices.resolutions.length && (
              <Alert type="warning" message="所选素材没有共同支持的提升档位，请分批处理" />
            )}
          </div>
          <div className={styles.field}>
            <strong>帧率提升{orderKind === 'image' ? '（图片超清不适用）' : ''}</strong>
            <Radio.Group
              value={target.fps}
              onChange={(event) => setTarget((old) => ({ ...old, fps: event.target.value }))}
              disabled={orderKind === 'image' || submitting || submissionUncertain}
              options={[
                { value: 0, label: '不调整' },
                ...choices.frameRates.map((fps) => ({ value: fps, label: `${fps}fps` })),
              ]}
            />
          </div>
          {quote && (
            <>
              {!quote.can_afford || quote.balance < quote.total_credits ? (
                <Alert
                  type="error"
                  message={`积分余额不足，预估费用${creditsLabel(quote.total_credits)}，当前余额 ${quote.balance} 积分。已拦截下单——不会产生任务、不会扣分。`}
                  action={<Button onClick={() => openMemberCenterTab('recharge')}>去充值</Button>}
                />
              ) : null}
              <div className={styles.total}>
                <span>
                  {eligible.length} 条逐条预估合计{quote.fps_multiplier ? ` · 补帧系数 ×${quote.fps_multiplier}` : ''}
                  <small>
                    {quote.estimated_time ? `预计耗时约 ${quote.estimated_time}` : '耗时以服务端实际队列为准'}
                  </small>
                </span>
                <strong>{creditsLabel(quote.total_credits)}</strong>
              </div>
            </>
          )}
          <Button
            type="link"
            loading={quoting}
            disabled={!eligible.length || !target.resolution || submitting || submissionUncertain}
            onClick={() => setQuoteTick((value) => value + 1)}
          >
            重新获取报价
          </Button>
          <p className={styles.note}>
            批量逐条独立结算，失败/取消原路退回；高清产物为新文件，源文件保留不动。剪辑和导出请显式选用高清版。
          </p>
        </Spin>
      </Modal>
      <Drawer zIndex={1700} title="高清任务" open={drawer} onClose={() => setDrawer(false)} width="min(1400px, 96vw)">
        {taskError && (
          <Alert
            type="error"
            showIcon
            message={taskError}
            action={<Button onClick={() => setRefresh((value) => value + 1)}>重试</Button>}
          />
        )}
        {taskPage && (
          <div className={styles.stats}>
            {[
              ['高清任务总数', taskPage.stats.total],
              ['排队中 / 处理中', taskPage.stats.active],
              ['已完成', taskPage.stats.completed],
              ['失败', taskPage.stats.failed],
              ['累计退回积分', taskPage.stats.refunded_credits],
            ].map(([label, value]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}
        <Space wrap className={styles.filters}>
          <Select
            aria-label="任务状态"
            value={filters.status}
            onChange={(status) => setFilter({ status })}
            options={[
              { value: '', label: '全部状态' },
              ...Object.entries(HD_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Select
            aria-label="任务类型"
            value={filters.kind}
            onChange={(kind) => setFilter({ kind })}
            options={[
              { value: '', label: '全部类型' },
              { value: 'video', label: '视频超分' },
              { value: 'image', label: '图片超清' },
            ]}
          />
          <Select
            aria-label="所属画布"
            value={filters.canvas_id}
            onChange={(canvas_id) => setFilter({ canvas_id })}
            options={[
              { value: 0, label: '全部画布' },
              ...(taskPage?.canvases || []).map((canvas) => ({ value: canvas.id, label: canvas.name })),
            ]}
          />
          <Input
            aria-label="任务 ID 或文件名"
            placeholder="任务 ID / 文件名"
            value={filters.keyword}
            onChange={(event) => setFilter({ keyword: event.target.value })}
          />
          <Button onClick={() => setFilters({ status: '', kind: '', canvas_id: 0, keyword: '', page: 1 })}>重置</Button>
        </Space>
        <Table<HdTask>
          rowKey="id"
          size="small"
          loading={loadingTasks}
          dataSource={taskPage?.items || []}
          scroll={{ x: 1550 }}
          locale={{ emptyText: taskError ? '任务列表暂不可用' : '当前筛选无任务' }}
          pagination={{
            current: filters.page,
            pageSize: 50,
            total: taskPage?.total || 0,
            showSizeChanger: false,
            onChange: (page) => setFilters((old) => ({ ...old, page })),
          }}
          onRow={(task) => ({
            onClick: (event) => {
              if (!(event.target as HTMLElement).closest('button') && task.status === 'completed') setCompare(task)
            },
          })}
          columns={[
            { title: '高清任务 ID', dataIndex: 'id' },
            { title: '类型', render: (_, task) => kindLabel(task.source.kind) },
            {
              title: '节点名称',
              render: (_, task) =>
                String(nodes.find((node) => node.id === task.source.node_id)?.data.title || task.source.name),
            },
            { title: '源文件', render: (_, task) => task.source.name },
            { title: '所属画布', dataIndex: 'canvas_name' },
            {
              title: '源 → 目标规格',
              render: (_, task) =>
                `${task.source_spec} → ${task.target.resolution} · ${task.target.fps ? `${task.target.fps}fps` : '帧率不调整'}`,
            },
            {
              title: '状态',
              render: (_, task) => (
                <>
                  <Tag color={statusColor[task.status]}>{HD_STATUS_LABELS[task.status]}</Tag>
                  {isHdActive(task) && (
                    <small>
                      {task.stage || '任务已受理'} ·{' '}
                      {Math.max(0, Math.floor((Date.now() - Date.parse(task.started_at || task.submitted_at)) / 1000))}s
                    </small>
                  )}
                </>
              ),
            },
            {
              title: '消耗积分',
              render: (_, task) => (
                <>
                  {task.credits}
                  {task.refund_status === 'refunded' ? (
                    <small>已退回原路</small>
                  ) : task.refund_status === 'pending' ? (
                    <small>退分处理中</small>
                  ) : null}
                </>
              ),
            },
            { title: '提交时间', dataIndex: 'submitted_at' },
            { title: '完成时间', dataIndex: 'completed_at' },
            { title: '失败原因', dataIndex: 'error' },
            {
              title: '操作',
              fixed: 'right',
              render: (_, task) =>
                task.status === 'queued' ? (
                  <Button loading={actionId === task.id} onClick={() => void cancel(task)}>
                    取消
                  </Button>
                ) : task.status === 'failed' ? (
                  <Button onClick={() => retry(task)}>重试</Button>
                ) : task.status === 'completed' ? (
                  <Button disabled={!task.result} onClick={() => setCompare(task)}>
                    查看对比
                  </Button>
                ) : task.status === 'processing' ? (
                  '处理中不可取消'
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Drawer>
      {compare?.result && <HdCompare task={compare} workspaceId={workspaceId} onClose={() => setCompare(null)} />}
    </>
  )
}

function HdCompare({ task, workspaceId, onClose }: { task: HdTask; workspaceId: number; onClose: () => void }) {
  const left = useRef<HTMLVideoElement>(null)
  const right = useRef<HTMLVideoElement>(null)
  const [split, setSplit] = useState(50)
  const [mediaError, setMediaError] = useState('')
  const result = task.result!
  const sync = () => {
    if (left.current && right.current && Math.abs(left.current.currentTime - right.current.currentTime) > 0.15)
      right.current.currentTime = left.current.currentTime
  }
  const play = () => {
    sync()
    void right.current?.play().catch(() => setMediaError('高清版暂时无法播放，请稍后重试或下载查看'))
  }
  return (
    <Modal
      zIndex={1800}
      open
      title={`源片 / 高清版对比 · ${task.source.name}`}
      width={1100}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="download"
          type="primary"
          onClick={() =>
            void downloadToDisk({
              fileName: result.name,
              mimeType: task.source.kind === 'image' ? 'image/png' : 'video/mp4',
              preserveResponseMediaType: task.source.kind === 'image',
              resolveUrl: () => assetStreamUrl(result.asset_id, workspaceId),
            }).catch((error) => showToast(hdServiceError(error), 'error'))
          }
        >
          下载高清版
        </Button>,
      ]}
    >
      {mediaError && <Alert type="error" message={mediaError} />}
      <div className={styles.compare} style={{ gridTemplateColumns: `${split}fr ${100 - split}fr` }}>
        <section>
          <p>源片 · {task.source_spec}</p>
          {task.source.kind === 'video' ? (
            <video
              ref={left}
              src={assetStreamUrl(task.source.asset_id, workspaceId)}
              controls
              preload="metadata"
              onPlay={play}
              onPause={() => right.current?.pause()}
              onSeeking={sync}
              onTimeUpdate={sync}
              onError={() => setMediaError('源片暂时无法加载')}
            />
          ) : (
            <img alt="源图" src={assetStreamUrl(task.source.asset_id, workspaceId)} />
          )}
        </section>
        <section>
          <p>高清版 · {result.spec}</p>
          {task.source.kind === 'video' ? (
            <video
              ref={right}
              src={assetStreamUrl(result.asset_id, workspaceId)}
              muted
              playsInline
              preload="metadata"
              onError={() => setMediaError('高清版暂时无法加载')}
            />
          ) : (
            <img alt="高清图" src={assetStreamUrl(result.asset_id, workspaceId)} />
          )}
        </section>
      </div>
      <input
        className={styles.split}
        type="range"
        min={20}
        max={80}
        value={split}
        onChange={(event) => setSplit(Number(event.target.value))}
        aria-label="调整源片与高清版分屏比例"
      />
      <p className={styles.note}>
        高清版为新文件，源文件保留不覆盖；剪辑/导出请显式选用高清版。
        {result.review_policy === 'reuse_source' ? '审核复用源件。' : '审核结果以素材状态为准。'}
      </p>
    </Modal>
  )
}
