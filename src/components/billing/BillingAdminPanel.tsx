/*
  BillingAdminPanel — 运营/管理后台面板（从 BillingModal 抽出）
  仅在 BillingModal 的 view === 'admin' 分支渲染挂载。承载运营概览、审计日志、
  AI 任务、模型管理、Provider 配置等全部后台功能。行为与原 BillingModal 内联实现严格一致。
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Collapse, Divider, Form, Input, Modal, Select, Tooltip } from 'antd'
import type { FormInstance } from 'antd'
import {
  cancelAiTask,
  createAdminModel,
  disableAdminModel,
  enableAdminModel,
  getAdminModelDetail,
  getAdminOverview,
  getAdminSession,
  listAdminAuditLogs,
  listAiTasks,
  listAdminProviders,
  listAdminModels,
  listBillingPlans,
  testAdminProviderConnection,
  testEstimateAdminModel,
  updateAdminProvider,
  updateAdminModel,
} from '@/api/business'
import './BillingModal.css'

export interface BillingAdminPanelProps {
  workspaceId: number
  onToast?: (message: string, type?: any) => void
}

export default function BillingAdminPanel(props: BillingAdminPanelProps) {
  const { workspaceId = 0 } = props
  const emitToast = (message: string, type?: string) => props.onToast?.(message, type)

  // 用 ref 保存最新的 workspaceId，供回调读取。
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  const [adminSession, setAdminSession] = useState<any>(null)
  const [adminOverview, setAdminOverview] = useState<any>(null)
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminFrom, setAdminFrom] = useState('')
  const [adminTo, setAdminTo] = useState('')
  const [adminSubView, setAdminSubView] = useState('overview')
  const [adminAuditActorId, setAdminAuditActorId] = useState('')
  const [adminAuditAction, setAdminAuditAction] = useState('')
  const [adminAuditResourceType, setAdminAuditResourceType] = useState('')
  const [adminAuditResourceId, setAdminAuditResourceId] = useState('')
  const [adminAuditFrom, setAdminAuditFrom] = useState('')
  const [adminAuditTo, setAdminAuditTo] = useState('')
  const [adminAuditLimit, setAdminAuditLimit] = useState(20)
  const [adminAuditOffset, setAdminAuditOffset] = useState(0)
  const [adminAuditTotal, setAdminAuditTotal] = useState(0)
  const [adminAuditLogs, setAdminAuditLogs] = useState<any[]>([])
  const [adminAuditLoading, setAdminAuditLoading] = useState(false)
  const [adminAuditError, setAdminAuditError] = useState('')
  const [adminProviders, setAdminProviders] = useState<any[]>([])
  const [adminProvidersLoading, setAdminProvidersLoading] = useState(false)
  const [adminProvidersError, setAdminProvidersError] = useState('')
  const [adminProviderDrafts, setAdminProviderDrafts] = useState<Record<string, any>>({})
  const [adminProviderSavingMap, setAdminProviderSavingMap] = useState<Record<string, boolean>>({})
  const [adminProviderTestingMap, setAdminProviderTestingMap] = useState<Record<string, boolean>>({})
  const [adminProviderTestMap, setAdminProviderTestMap] = useState<Record<string, any>>({})
  const [adminAiTaskStatus, setAdminAiTaskStatus] = useState('')
  const [adminAiTaskMine, setAdminAiTaskMine] = useState('')
  const [adminAiTaskLimit, setAdminAiTaskLimit] = useState(20)
  const [adminAiTaskOffset, setAdminAiTaskOffset] = useState(0)
  const [adminAiTaskTotal, setAdminAiTaskTotal] = useState(0)
  const [adminAiTasks, setAdminAiTasks] = useState<any[]>([])
  const [adminAiTasksLoading, setAdminAiTasksLoading] = useState(false)
  const [adminAiTasksError, setAdminAiTasksError] = useState('')
  const [adminAiTaskCancelingId, setAdminAiTaskCancelingId] = useState(0)

  const [adminModelProvider, setAdminModelProvider] = useState('')
  const [adminModelEnabled, setAdminModelEnabled] = useState('')
  const [adminModelLimit, setAdminModelLimit] = useState(20)
  const [adminModelOffset, setAdminModelOffset] = useState(0)
  const [adminModelTotal, setAdminModelTotal] = useState(0)
  const [adminModels, setAdminModels] = useState<any[]>([])
  const [adminModelsLoading, setAdminModelsLoading] = useState(false)
  const [adminModelsError, setAdminModelsError] = useState('')

  const [adminModelEditingId, setAdminModelEditingId] = useState(0)
  const [adminModelDetail, setAdminModelDetail] = useState<any>(null)
  const [adminModelDialogOpen, setAdminModelDialogOpen] = useState(false)
  const [adminModelDialogCollapse, setAdminModelDialogCollapse] = useState<string[]>([])
  const [adminModelFormRef] = Form.useForm()
  const [adminModelDraft, setAdminModelDraft] = useState<any>({
    provider: '',
    model: '',
    version: '',
    capability: '',
    display_name: '',
    enabled: true,
    task_mode: 'async',
    allowed_plans: [],
    operation_codes: [],
    system_prompts: '{}',
  })
  const [adminModelSaving, setAdminModelSaving] = useState(false)
  const [adminModelSaveError, setAdminModelSaveError] = useState('')

  const [adminModelTestOp, setAdminModelTestOp] = useState('')
  const [adminModelTestPrompt, setAdminModelTestPrompt] = useState('')
  const [adminModelTestParams, setAdminModelTestParams] = useState('{}')
  const [adminModelTestLoading, setAdminModelTestLoading] = useState(false)
  const [adminModelTestResult, setAdminModelTestResult] = useState<any>(null)
  const [adminModelTestError, setAdminModelTestError] = useState('')

  // 套餐列表：仅用于「可用套餐」下拉的候选项。原 BillingModal 从 useBilling 的 plans
  // 派生；这里独立组件直接拉一次套餐列表，候选内容（套餐 code）等价。
  const [plans, setPlans] = useState<any[]>([])

  const adminModelCapabilityOptions = [
    { value: 'video', label: '视频' },
    { value: 'image', label: '图片' },
    { value: 'responses', label: '对话/文本' },
  ]

  const adminModelTaskModeOptions = [
    { value: 'async', label: '异步' },
    { value: 'sync', label: '同步' },
  ]

  const adminModelAllowedPlanOptions = useMemo(
    () =>
      (Array.isArray(plans) ? plans : [])
        .map((p) => p?.code)
        .filter((c) => typeof c === 'string' && c.trim())
        .map((c) => c.trim()),
    [plans],
  )

  // antd Form 校验规则
  const adminModelFormRules = {
    provider: [{ required: true, message: '请输入服务商' }],
    model: [{ required: true, message: '请输入模型标识' }],
    capability: [{ required: true, message: '请选择能力类型' }],
    display_name: [{ required: true, message: '请输入展示名称' }],
    system_prompts: [
      {
        validator: (_rule: any, value: any) => {
          const text = String(value || '').trim()
          if (!text) return Promise.reject(new Error('请输入合法的 JSON 对象，例如 {}'))
          try {
            const parsed = JSON.parse(text)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              return Promise.reject(new Error('请输入合法的 JSON 对象，例如 {}'))
            }
            return Promise.resolve()
          } catch {
            return Promise.reject(new Error('请输入合法的 JSON 对象，例如 {}'))
          }
        },
      },
    ],
  }

  const num = (n: any) => Number(n || 0).toLocaleString('zh-CN')
  const timeText = (value: any) => {
    if (!value) return ''
    const dt = new Date(value)
    if (Number.isNaN(dt.getTime())) return String(value)
    return dt.toLocaleString('zh-CN', { hour12: false })
  }

  const aiTaskStatusOptions = [
    { value: '', label: '全部状态' },
    { value: 'queued', label: '排队中' },
    { value: 'processing', label: '处理中' },
    { value: 'succeeded', label: '已成功' },
    { value: 'failed', label: '失败' },
    { value: 'canceled', label: '已取消' },
  ]

  const aiTaskMineOptions = [
    { value: '', label: '全部任务' },
    { value: 'true', label: '仅我的任务' },
  ]

  const aiTaskStatusLabel = (status: any) =>
    aiTaskStatusOptions.find((item) => item.value === status)?.label || String(status || '-')

  const refreshAdmin = useCallback(async () => {
    setAdminLoading(true)
    setAdminError('')
    try {
      const session = await getAdminSession()
      setAdminSession(session)
      const overview = await getAdminOverview({ from: adminFrom, to: adminTo })
      setAdminOverview(overview)
    } catch (err: any) {
      setAdminSession(null)
      setAdminOverview(null)
      setAdminError(err?.message || '加载运营概览失败')
    } finally {
      setAdminLoading(false)
    }
  }, [adminFrom, adminTo])

  function normalizeAiTaskItem(item: any) {
    const outputs = Array.isArray(item?.outputs) ? item.outputs : []
    return {
      id: Number(item?.id || 0),
      status: String(item?.status || ''),
      created_at: item?.created_at || '',
      updated_at: item?.updated_at || '',
      estimated_cost: Number(item?.estimated_cost || 0),
      actual_cost: Number(item?.actual_cost || 0),
      poll_after_ms: Number(item?.poll_after_ms || 0),
      error_message: String(item?.error_message || ''),
      outputs,
    }
  }

  const hasAdminAiTaskPrev = adminAiTaskOffset > 0
  const hasAdminAiTaskNext = (() => {
    const limit = Number(adminAiTaskLimit) || 20
    if (adminAiTaskTotal > 0) {
      return adminAiTaskOffset + adminAiTasks.length < adminAiTaskTotal
    }
    return adminAiTasks.length >= limit
  })()

  function canCancelAiTask(row: any) {
    const status = String(row?.status || '').toLowerCase()
    return !['succeeded', 'failed', 'canceled', 'cancelled'].includes(status)
  }

  function aiTaskSummary(row: any) {
    const outputs = Array.isArray(row?.outputs) ? row.outputs : []
    if (outputs.length) {
      const types = [...new Set(outputs.map((item: any) => String(item?.type || '').trim()).filter(Boolean))]
      return `${outputs.length} 个结果${types.length ? ` · ${types.join(' / ')}` : ''}`
    }
    if (row?.error_message) return row.error_message
    if (row?.poll_after_ms > 0) return `建议 ${Math.ceil(row.poll_after_ms / 1000)} 秒后刷新`
    return '暂无结果'
  }

  function formatAuditDetails(value: any) {
    if (!value) return ''
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  function normalizeAdminAuditLog(item: any) {
    return {
      id: Number(item?.id || 0),
      actor_admin_user_id: Number(item?.actor_admin_user_id || item?.actor_id || 0),
      action: String(item?.action || ''),
      resource_type: String(item?.resource_type || ''),
      resource_id: String(item?.resource_id ?? ''),
      created_at: item?.created_at || item?.createdAt || '',
      details: formatAuditDetails(item?.details || item?.metadata || item?.payload || item?.changes || item?.extra),
    }
  }

  const hasAdminAuditPrev = adminAuditOffset > 0
  const hasAdminAuditNext = (() => {
    const limit = Number(adminAuditLimit) || 20
    if (adminAuditTotal > 0) {
      return adminAuditOffset + adminAuditLogs.length < adminAuditTotal
    }
    return adminAuditLogs.length >= limit
  })()

  // 用 ref 镜像审计过滤项/游标，供分页回调读取最新值。
  const adminAuditRef = useRef({
    actorId: '',
    action: '',
    resourceType: '',
    resourceId: '',
    from: '',
    to: '',
    limit: 20,
    offset: 0,
  })

  const refreshAdminAuditLogs = useCallback(
    async ({
      actorAdminUserId,
      action,
      resourceType,
      resourceId,
      from,
      to,
      limit,
      offset,
    }: any = {}) => {
      setAdminAuditLoading(true)
      setAdminAuditError('')
      try {
        const r = adminAuditRef.current
        if (actorAdminUserId !== undefined) {
          r.actorId = String(actorAdminUserId ?? '')
          setAdminAuditActorId(r.actorId)
        }
        if (action !== undefined) {
          r.action = String(action || '')
          setAdminAuditAction(r.action)
        }
        if (resourceType !== undefined) {
          r.resourceType = String(resourceType || '')
          setAdminAuditResourceType(r.resourceType)
        }
        if (resourceId !== undefined) {
          r.resourceId = String(resourceId || '')
          setAdminAuditResourceId(r.resourceId)
        }
        if (from !== undefined) {
          r.from = String(from || '')
          setAdminAuditFrom(r.from)
        }
        if (to !== undefined) {
          r.to = String(to || '')
          setAdminAuditTo(r.to)
        }
        if (limit !== undefined) {
          r.limit = Number(limit) || 20
          setAdminAuditLimit(r.limit)
        }
        if (offset !== undefined) {
          r.offset = Math.max(0, Number(offset) || 0)
          setAdminAuditOffset(r.offset)
        }
        const page: any = await listAdminAuditLogs({
          actorAdminUserId: r.actorId,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          from: r.from,
          to: r.to,
          limit: r.limit,
          offset: r.offset,
        })
        const items = Array.isArray(page?.items) ? page.items : Array.isArray(page) ? page : []
        setAdminAuditLogs(items.map(normalizeAdminAuditLog))
        setAdminAuditTotal(Number(page?.total ?? items.length) || 0)
      } catch (err: any) {
        setAdminAuditLogs([])
        setAdminAuditTotal(0)
        setAdminAuditError(err?.message || '加载审计日志失败')
      } finally {
        setAdminAuditLoading(false)
      }
    },
    // normalizeAdminAuditLog 为稳定的纯函数，刻意省略以避免回调频繁重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const goAdminAuditPrev = () =>
    refreshAdminAuditLogs({
      offset: Math.max(0, adminAuditRef.current.offset - (Number(adminAuditRef.current.limit) || 20)),
    })
  const goAdminAuditNext = () =>
    refreshAdminAuditLogs({ offset: adminAuditRef.current.offset + (Number(adminAuditRef.current.limit) || 20) })

  // 用 ref 镜像 AI 任务过滤项/游标。
  const adminAiTaskRef = useRef({ status: '', mine: '', limit: 20, offset: 0 })

  const refreshAdminAiTasks = useCallback(
    async ({ status, mine, limit, offset }: any = {}) => {
      setAdminAiTasksLoading(true)
      setAdminAiTasksError('')
      try {
        if (!workspaceIdRef.current) {
          throw new Error('当前工作空间无效，无法查询 AI 任务')
        }
        const r = adminAiTaskRef.current
        if (status !== undefined) {
          r.status = String(status || '')
          setAdminAiTaskStatus(r.status)
        }
        if (mine !== undefined) {
          r.mine = String(mine ?? '')
          setAdminAiTaskMine(r.mine)
        }
        if (limit !== undefined) {
          r.limit = Number(limit) || 20
          setAdminAiTaskLimit(r.limit)
        }
        if (offset !== undefined) {
          r.offset = Math.max(0, Number(offset) || 0)
          setAdminAiTaskOffset(r.offset)
        }
        const page: any = await listAiTasks({
          workspaceId: workspaceIdRef.current,
          status: r.status,
          mine: r.mine,
          limit: r.limit,
          offset: r.offset,
        } as any)
        const items = Array.isArray(page?.items) ? page.items : Array.isArray(page) ? page : []
        setAdminAiTasks(items.map(normalizeAiTaskItem))
        setAdminAiTaskTotal(Number(page?.total ?? items.length) || 0)
      } catch (err: any) {
        setAdminAiTasks([])
        setAdminAiTaskTotal(0)
        setAdminAiTasksError(err?.message || '加载 AI 任务失败')
      } finally {
        setAdminAiTasksLoading(false)
      }
    },
    [],
  )

  const goAdminAiTaskPrev = () =>
    refreshAdminAiTasks({
      offset: Math.max(0, adminAiTaskRef.current.offset - (Number(adminAiTaskRef.current.limit) || 20)),
    })
  const goAdminAiTaskNext = () =>
    refreshAdminAiTasks({ offset: adminAiTaskRef.current.offset + (Number(adminAiTaskRef.current.limit) || 20) })

  async function cancelAdminAiTask(row: any) {
    const taskId = Number(row?.id || 0)
    if (!taskId || adminAiTaskCancelingId === taskId) return
    if (!canCancelAiTask(row)) return
    const confirmed = window.confirm(`确认取消 AI 任务 #${taskId} 吗？`)
    if (!confirmed) return
    setAdminAiTaskCancelingId(taskId)
    try {
      const updated = normalizeAiTaskItem(await cancelAiTask({ workspaceId, taskId }))
      setAdminAiTasks((prev) => prev.map((item) => (item.id === taskId ? updated : item)))
      emitToast(`任务 #${taskId} 已取消`, 'success')
    } catch (err: any) {
      emitToast(err?.message || '取消任务失败', 'error')
    } finally {
      setAdminAiTaskCancelingId(0)
    }
  }

  function normalizeAdminProvider(item: any) {
    const timeout = Number(item?.timeout_seconds)
    return {
      provider: String(item?.provider || '').trim(),
      base_url: String(item?.base_url || ''),
      timeout_seconds: Number.isFinite(timeout) && timeout > 0 ? timeout : '',
      api_key_masked: String(item?.api_key_masked || ''),
      api_key_configured: item?.api_key_configured === true,
    }
  }

  const syncAdminProviderDrafts = useCallback((items: any[] = []) => {
    setAdminProviderDrafts((prevDrafts) => {
      const nextDrafts: Record<string, any> = {}
      items.forEach((item) => {
        const key = item.provider
        nextDrafts[key] = {
          base_url: item.base_url || '',
          timeout_seconds: item.timeout_seconds || '',
          api_key: prevDrafts[key]?.api_key || '',
        }
      })
      return nextDrafts
    })
  }, [])

  const refreshAdminProviders = useCallback(async () => {
    setAdminProvidersLoading(true)
    setAdminProvidersError('')
    try {
      const rows: any = await listAdminProviders()
      const items = (Array.isArray(rows) ? rows : []).map(normalizeAdminProvider).filter((item) => item.provider)
      setAdminProviders(items)
      syncAdminProviderDrafts(items)
    } catch (err: any) {
      setAdminProviders([])
      setAdminProvidersError(err?.message || '加载 Provider 配置失败')
    } finally {
      setAdminProvidersLoading(false)
    }
  }, [syncAdminProviderDrafts])

  function updateAdminProviderDraft(provider: string, field: string, value: any) {
    const key = String(provider || '').trim()
    if (!key) return
    setAdminProviderDrafts((prev) => {
      const current = prev[key] || { base_url: '', timeout_seconds: '', api_key: '' }
      return {
        ...prev,
        [key]: {
          ...current,
          [field]: field === 'timeout_seconds' ? String(value || '').replace(/[^\d]/g, '') : String(value || ''),
        },
      }
    })
  }

  async function saveAdminProvider(provider: string) {
    const key = String(provider || '').trim()
    if (!key || adminProviderSavingMap[key]) return
    setAdminProviderSavingMap((prev) => ({ ...prev, [key]: true }))
    try {
      const draft = adminProviderDrafts[key] || {}
      const timeout = Number(draft.timeout_seconds)
      const payload = {
        base_url: String(draft.base_url || '').trim() || undefined,
        timeout_seconds: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
        api_key: String(draft.api_key || '').trim() || undefined,
      }
      const updated = normalizeAdminProvider(await updateAdminProvider(key, payload))
      setAdminProviders((prev) => prev.map((item) => (item.provider === key ? updated : item)))
      setAdminProviderDrafts((prev) => ({
        ...prev,
        [key]: {
          base_url: updated.base_url || '',
          timeout_seconds: updated.timeout_seconds || '',
          api_key: '',
        },
      }))
      emitToast(`${key} 配置已保存`, 'success')
    } catch (err: any) {
      emitToast(err?.message || '保存 Provider 配置失败', 'error')
    } finally {
      setAdminProviderSavingMap((prev) => ({ ...prev, [key]: false }))
    }
  }

  async function testAdminProvider(provider: string) {
    const key = String(provider || '').trim()
    if (!key || adminProviderTestingMap[key]) return
    setAdminProviderTestingMap((prev) => ({ ...prev, [key]: true }))
    try {
      const draft = adminProviderDrafts[key] || {}
      const timeout = Number(draft.timeout_seconds)
      const payload = {
        base_url: String(draft.base_url || '').trim() || undefined,
        timeout_seconds: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
        api_key: String(draft.api_key || '').trim() || undefined,
      }
      const result: any = await testAdminProviderConnection(key, payload)
      setAdminProviderTestMap((prev) => ({ ...prev, [key]: result || null }))
      emitToast(result?.ok ? `${key} 连接正常` : `${key} 测试未通过`, result?.ok ? 'success' : 'error')
    } catch (err: any) {
      setAdminProviderTestMap((prev) => ({
        ...prev,
        [key]: { ok: false, message: err?.message || '连接测试失败', http_status: 0 },
      }))
      emitToast(err?.message || '连接测试失败', 'error')
    } finally {
      setAdminProviderTestingMap((prev) => ({ ...prev, [key]: false }))
    }
  }

  const centsYuan = (cents: any) =>
    (Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const bytesText = (bytes: any) => {
    const n = Number(bytes || 0)
    if (!Number.isFinite(n) || n <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let idx = 0
    let val = n
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024
      idx += 1
    }
    return `${val.toLocaleString('zh-CN', { maximumFractionDigits: idx === 0 ? 0 : 2 })} ${units[idx]}`
  }

  const kpis = useMemo(() => {
    const o = adminOverview || {}
    return [
      { label: '用户总数', value: num(o.users_total) },
      { label: '新增用户', value: num(o.users_new) },
      { label: '空间总数', value: num(o.workspaces_total) },
      { label: '新增空间', value: num(o.workspaces_new) },
      { label: 'AI 任务总数', value: num(o.ai_tasks_total) },
      { label: '进行中任务', value: num(o.ai_tasks_processing) },
      { label: '成功任务', value: num(o.ai_tasks_succeeded) },
      { label: '失败任务', value: num(o.ai_tasks_failed) },
      { label: '积分消耗', value: num(o.credits_consumed) },
      { label: '充值金额', value: `¥${centsYuan(o.recharge_amount_cents)}` },
      { label: '订阅数(活跃)', value: num(o.active_subscriptions) },
      { label: '素材数量', value: num(o.assets_total) },
      { label: '素材占用', value: bytesText(o.assets_size_bytes) },
    ]
  }, [adminOverview])

  const parseCsv = (value: any) =>
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

  const parseJsonObject = (value: any) => {
    const text = String(value || '').trim()
    if (!text) return null
    try {
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      return parsed
    } catch {
      return null
    }
  }

  const hasAdminModelPrev = adminModelOffset > 0
  const hasAdminModelNext = (() => {
    const limit = Number(adminModelLimit) || 20
    if (adminModelTotal > 0) {
      return adminModelOffset + adminModels.length < adminModelTotal
    }
    return adminModels.length >= limit
  })()

  // 用 ref 镜像模型过滤项/游标。
  const adminModelRef = useRef({ provider: '', enabled: '', limit: 20, offset: 0 })

  const refreshAdminModels = useCallback(
    async ({ provider, enabled, limit, offset }: any = {}) => {
      setAdminModelsLoading(true)
      setAdminModelsError('')
      try {
        const r = adminModelRef.current
        if (provider !== undefined) {
          r.provider = String(provider || '')
          setAdminModelProvider(r.provider)
        }
        if (enabled !== undefined) {
          r.enabled = String(enabled ?? '')
          setAdminModelEnabled(r.enabled)
        }
        if (limit !== undefined) {
          r.limit = Number(limit) || 20
          setAdminModelLimit(r.limit)
        }
        if (offset !== undefined) {
          r.offset = Math.max(0, Number(offset) || 0)
          setAdminModelOffset(r.offset)
        }
        const page: any = await listAdminModels({
          provider: r.provider,
          enabled: r.enabled,
          limit: r.limit,
          offset: r.offset,
        })
        const items = Array.isArray(page?.items) ? page.items : Array.isArray(page) ? page : []
        setAdminModels(items)
        setAdminModelTotal(Number(page?.total ?? items.length) || 0)
      } catch (err: any) {
        setAdminModels([])
        setAdminModelTotal(0)
        setAdminModelsError(err?.message || '加载模型列表失败')
      } finally {
        setAdminModelsLoading(false)
      }
    },
    [],
  )

  const goAdminModelPrev = () =>
    refreshAdminModels({
      offset: Math.max(0, adminModelRef.current.offset - (Number(adminModelRef.current.limit) || 20)),
    })
  const goAdminModelNext = () =>
    refreshAdminModels({ offset: adminModelRef.current.offset + (Number(adminModelRef.current.limit) || 20) })

  function resetAdminModelDraft() {
    setAdminModelEditingId(0)
    setAdminModelDetail(null)
    setAdminModelSaveError('')
    setAdminModelDialogCollapse([])
    setAdminModelDraft({
      provider: '',
      model: '',
      version: '',
      capability: '',
      display_name: '',
      enabled: true,
      task_mode: 'async',
      allowed_plans: [],
      operation_codes: [],
      system_prompts: '{}',
    })
    setAdminModelTestOp('')
    setAdminModelTestPrompt('')
    setAdminModelTestParams('{}')
    setAdminModelTestResult(null)
    setAdminModelTestError('')
  }

  async function openAdminModel(id: any) {
    const modelId = Number(id || 0)
    if (!Number.isFinite(modelId) || modelId <= 0) return
    setAdminModelSaveError('')
    setAdminModelTestResult(null)
    setAdminModelTestError('')
    try {
      const detail: any = await getAdminModelDetail(modelId)
      setAdminModelEditingId(modelId)
      setAdminModelDetail(detail)
      setAdminModelDialogCollapse([])
      const draft = {
        provider: String(detail?.provider || ''),
        model: String(detail?.model || ''),
        version: String(detail?.version || ''),
        capability: String(detail?.capability || ''),
        display_name: String(detail?.display_name || ''),
        enabled: detail?.enabled === true,
        task_mode: String(detail?.task_mode || ''),
        allowed_plans: Array.isArray(detail?.allowed_plans) ? detail.allowed_plans : [],
        operation_codes: Array.isArray(detail?.operation_codes) ? detail.operation_codes : [],
        system_prompts: JSON.stringify(detail?.system_prompts || {}, null, 2),
      }
      setAdminModelDraft(draft)
      adminModelFormRef.setFieldsValue(draft)
      setAdminModelTestOp(Array.isArray(detail?.operation_codes) ? detail.operation_codes[0] || '' : '')
      setAdminModelDialogOpen(true)
      adminModelFormRef.resetFields?.()
      adminModelFormRef.setFieldsValue(draft)
    } catch (err: any) {
      setAdminModelSaveError(err?.message || '加载模型详情失败')
    }
  }

  function startCreateAdminModel() {
    resetAdminModelDraft()
    setAdminModelDialogOpen(true)
  }

  async function saveAdminModel() {
    if (adminModelSaving) return
    setAdminModelSaving(true)
    setAdminModelSaveError('')
    try {
      const draft = adminModelDraft || {}
      const allowedPlans = Array.isArray(draft.allowed_plans) ? draft.allowed_plans : parseCsv(draft.allowed_plans)
      const operationCodes = Array.isArray(draft.operation_codes)
        ? draft.operation_codes
        : parseCsv(draft.operation_codes)
      const payload: any = {
        display_name: String(draft.display_name || '').trim() || undefined,
        task_mode: String(draft.task_mode || '').trim() || undefined,
        allowed_plans: allowedPlans.length ? allowedPlans : undefined,
        operation_codes: operationCodes.length ? operationCodes : undefined,
        system_prompts: parseJsonObject(draft.system_prompts) || undefined,
      }
      if (adminModelEditingId > 0) {
        const updated: any = await updateAdminModel(adminModelEditingId, payload)
        setAdminModelDetail(updated)
        setAdminModelDraft((prev: any) => ({ ...prev, enabled: updated?.enabled === true }))
        await refreshAdminModels()
        emitToast('模型已保存', 'success')
        setAdminModelDialogOpen(false)
        return
      }
      const createPayload = {
        provider: String(draft.provider || '').trim() || undefined,
        model: String(draft.model || '').trim() || undefined,
        version: String(draft.version || '').trim() || undefined,
        capability: String(draft.capability || '').trim() || undefined,
        enabled: draft.enabled === true,
        ...payload,
      }
      const created: any = await createAdminModel(createPayload)
      const createdId = Number(created?.id || 0)
      emitToast('模型已创建', 'success')
      await refreshAdminModels({ offset: 0 })
      if (createdId) await openAdminModel(createdId)
    } catch (err: any) {
      const msg = err?.message || '保存失败'
      setAdminModelSaveError(msg)
      emitToast(msg, 'error')
    } finally {
      setAdminModelSaving(false)
    }
  }

  async function submitAdminModel() {
    if (adminModelSaving) return
    try {
      await adminModelFormRef.validateFields()
    } catch (e: any) {
      // 校验失败：若 system_prompts 出错，展开高级配置面板
      const errFields = e?.errorFields || []
      if (errFields.some((f: any) => Array.isArray(f?.name) && f.name.includes('system_prompts'))) {
        setAdminModelDialogCollapse((prev) => Array.from(new Set([...prev, 'advanced'])))
      }
      return
    }
    await saveAdminModel()
  }

  function closeAdminModelDialog() {
    setAdminModelDialogOpen(false)
    setAdminModelSaveError('')
  }

  async function toggleAdminModelEnabled() {
    const id = adminModelEditingId
    if (!id) return
    if (adminModelSaving) return
    setAdminModelSaving(true)
    setAdminModelSaveError('')
    try {
      const next = !(adminModelDetail?.enabled === true)
      if (next) await enableAdminModel(id)
      else await disableAdminModel(id)
      await openAdminModel(id)
      await refreshAdminModels()
      emitToast(next ? '已启用模型' : '已停用模型', 'success')
    } catch (err: any) {
      const msg = err?.message || '操作失败'
      setAdminModelSaveError(msg)
      emitToast(msg, 'error')
    } finally {
      setAdminModelSaving(false)
    }
  }

  async function runAdminModelTestEstimate() {
    const id = adminModelEditingId
    if (!id) return
    if (adminModelTestLoading) return
    setAdminModelTestLoading(true)
    setAdminModelTestError('')
    setAdminModelTestResult(null)
    try {
      const params = parseJsonObject(adminModelTestParams) || {}
      const req = {
        operation_code: String(adminModelTestOp || '').trim() || undefined,
        prompt: String(adminModelTestPrompt || '').trim() || undefined,
        params,
      }
      setAdminModelTestResult(await testEstimateAdminModel(id, req))
    } catch (err: any) {
      setAdminModelTestError(err?.message || '估价失败')
    } finally {
      setAdminModelTestLoading(false)
    }
  }

  // ── effects ──

  // 子组件仅在进入 admin 视图时才挂载，因此挂载即执行一次概览拉取（等价于原
  // BillingModal 里 initialTab/view === 'admin' 时 refreshAdmin() 的初始化语义）。
  // 同时拉取套餐列表，供「可用套餐」下拉候选。adminSubView 初值 'overview'。
  useEffect(() => {
    refreshAdmin()
    ;(async () => {
      try {
        const list: any = await listBillingPlans()
        setPlans(Array.isArray(list) ? list : [])
      } catch {
        setPlans([])
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // watch(adminSubView) — 切换运营子视图时拉数据。
  const prevAdminSubViewRef = useRef(adminSubView)
  useEffect(() => {
    if (prevAdminSubViewRef.current === adminSubView) {
      prevAdminSubViewRef.current = adminSubView
      return
    }
    prevAdminSubViewRef.current = adminSubView
    if (adminSubView === 'overview') {
      refreshAdmin()
      return
    }
    if (adminSubView === 'audit') {
      refreshAdminAuditLogs({ offset: 0 })
      return
    }
    if (adminSubView === 'tasks') {
      refreshAdminAiTasks({ offset: 0 })
      return
    }
    if (adminSubView === 'models') {
      refreshAdminModels({ offset: 0 })
      return
    }
    if (adminSubView === 'providers') {
      refreshAdminProviders()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSubView])

  return (
    <section className="bm-list" aria-label="运营概览">
      <div className="bm-admin-top">
        <nav className="bm-admin-tabs" aria-label="运营功能">
          <button type="button" className={`bm-admin-tab${adminSubView === 'overview' ? ' active' : ''}`} onClick={() => setAdminSubView('overview')}>
            概览
          </button>
          <button type="button" className={`bm-admin-tab${adminSubView === 'audit' ? ' active' : ''}`} onClick={() => setAdminSubView('audit')}>
            审计
          </button>
          <button type="button" className={`bm-admin-tab${adminSubView === 'tasks' ? ' active' : ''}`} onClick={() => setAdminSubView('tasks')}>
            AI任务
          </button>
          <button type="button" className={`bm-admin-tab${adminSubView === 'models' ? ' active' : ''}`} onClick={() => setAdminSubView('models')}>
            模型
          </button>
          <button type="button" className={`bm-admin-tab${adminSubView === 'providers' ? ' active' : ''}`} onClick={() => setAdminSubView('providers')}>
            Provider
          </button>
        </nav>

        <div className="bm-admin-actions">
          {adminSubView === 'models' && (
            <button
              type="button"
              className="bm-refresh"
              disabled={adminModelsLoading}
              onClick={startCreateAdminModel}
            >
              新建模型
            </button>
          )}
          <button
            type="button"
            className="bm-refresh"
            disabled={adminLoading || adminAuditLoading || adminAiTasksLoading || adminModelsLoading || adminProvidersLoading}
            onClick={() =>
              adminSubView === 'audit'
                ? refreshAdminAuditLogs({ offset: 0 })
                : adminSubView === 'tasks'
                ? refreshAdminAiTasks({ offset: 0 })
                : adminSubView === 'models'
                ? refreshAdminModels({ offset: 0 })
                : adminSubView === 'providers'
                ? refreshAdminProviders()
                : refreshAdmin()
            }
          >
            {adminLoading || adminAuditLoading || adminAiTasksLoading || adminModelsLoading || adminProvidersLoading ? '加载中…' : '刷新'}
          </button>
        </div>
      </div>

      {adminSubView === 'overview' && (
        <div className="bm-admin">
          <div className="bm-list-toolbar">
            <div className="bm-filters">
              <input
                className="bm-input"
                type="text"
                value={adminFrom}
                placeholder="from：YYYY-MM-DD（可选）"
                onChange={(e) => setAdminFrom(e.target.value)}
              />
              <input
                className="bm-input"
                type="text"
                value={adminTo}
                placeholder="to：YYYY-MM-DD（可选）"
                onChange={(e) => setAdminTo(e.target.value)}
              />
            </div>
            <button type="button" className="bm-refresh" disabled={adminLoading} onClick={refreshAdmin}>
              {adminLoading ? '加载中…' : '刷新概览'}
            </button>
          </div>

          {adminError ? (
            <p className="bm-error">{adminError}</p>
          ) : adminLoading ? (
            <p className="bm-loading">加载中…</p>
          ) : (
            <div className="bm-admin">
              <div className="bm-admin-session">
                <span className="bm-admin-label">后台会话</span>
                <span className="bm-admin-value">
                  {adminSession?.admin_user?.id ? `管理员 #${adminSession.admin_user.id}` : '无权限或未登录'}
                </span>
                {adminSession?.admin_user?.status && (
                  <span className="bm-admin-chip">{adminSession.admin_user.status}</span>
                )}
              </div>

              <div className="bm-kpi-grid">
                {kpis.map((item) => (
                  <div key={item.label} className="bm-kpi">
                    <div className="bm-kpi-label">{item.label}</div>
                    <div className="bm-kpi-val">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {adminSubView === 'audit' && (
        <div className="bm-admin-models">
          <div className="bm-admin-model-list">
            <div className="bm-list-toolbar">
              <div className="bm-filters">
                <input
                  className="bm-input"
                  type="text"
                  value={adminAuditActorId}
                  placeholder="操作者ID（可选）"
                  onChange={(e) => setAdminAuditActorId(e.target.value.replace(/[^\d]/g, ''))}
                />
                <input className="bm-input" type="text" value={adminAuditAction} placeholder="动作，如 admin.model.updated" onChange={(e) => setAdminAuditAction(e.target.value)} />
                <input className="bm-input" type="text" value={adminAuditResourceType} placeholder="资源类型，如 model_version" onChange={(e) => setAdminAuditResourceType(e.target.value)} />
                <input className="bm-input" type="text" value={adminAuditResourceId} placeholder="资源ID（可选）" onChange={(e) => setAdminAuditResourceId(e.target.value)} />
                <input className="bm-input" type="text" value={adminAuditFrom} placeholder="起始时间 YYYY-MM-DD" onChange={(e) => setAdminAuditFrom(e.target.value)} />
                <input className="bm-input" type="text" value={adminAuditTo} placeholder="结束时间 YYYY-MM-DD" onChange={(e) => setAdminAuditTo(e.target.value)} />
                <select className="bm-select" value={adminAuditLimit} onChange={(e) => setAdminAuditLimit(Number(e.target.value))}>
                  <option value={10}>10/页</option>
                  <option value={20}>20/页</option>
                  <option value={50}>50/页</option>
                </select>
                <button type="button" className="bm-refresh" disabled={adminAuditLoading} onClick={() => refreshAdminAuditLogs({ offset: 0 })}>
                  查询
                </button>
              </div>
            </div>

            {adminAuditError ? (
              <p className="bm-error">{adminAuditError}</p>
            ) : adminAuditLoading ? (
              <p className="bm-loading">加载中…</p>
            ) : !adminAuditLogs.length ? (
              <p className="bm-empty">暂无审计日志</p>
            ) : (
              <div className="bm-table bm-audit-table" role="table" aria-label="审计日志列表">
                <div className="bm-tr bm-th bm-audit-tr" role="row">
                  <div className="bm-td bm-audit-action" role="columnheader">动作</div>
                  <div className="bm-td bm-audit-resource" role="columnheader">资源</div>
                  <div className="bm-td bm-audit-actor" role="columnheader">操作者</div>
                  <div className="bm-td bm-audit-time" role="columnheader">时间</div>
                  <div className="bm-td bm-audit-detail" role="columnheader">详情</div>
                </div>
                {adminAuditLogs.map((row) => (
                  <div key={row.id || `${row.action}-${row.created_at}`} className="bm-tr bm-audit-tr" role="row">
                    <div className="bm-td bm-audit-action" role="cell">
                      <div className="bm-audit-main">{row.action || '-'}</div>
                    </div>
                    <div className="bm-td bm-audit-resource" role="cell">
                      <div>{row.resource_type || '-'}</div>
                      <div className="bm-audit-sub">{row.resource_id || '-'}</div>
                    </div>
                    <div className="bm-td bm-audit-actor" role="cell">
                      {row.actor_admin_user_id ? `管理员 #${row.actor_admin_user_id}` : '-'}
                    </div>
                    <div className="bm-td bm-audit-time" role="cell">{timeText(row.created_at) || '-'}</div>
                    <div className="bm-td bm-audit-detail" role="cell">
                      <pre className="bm-audit-pre">{row.details || '-'}</pre>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bm-pager">
              <button type="button" className="bm-page-btn" disabled={!hasAdminAuditPrev || adminAuditLoading} onClick={goAdminAuditPrev}>
                上一页
              </button>
              <span className="bm-page-meta">第 {Math.floor(adminAuditOffset / adminAuditLimit) + 1} 页</span>
              <button type="button" className="bm-page-btn" disabled={!hasAdminAuditNext || adminAuditLoading} onClick={goAdminAuditNext}>
                下一页
              </button>
            </div>
          </div>
        </div>
      )}

      {adminSubView === 'tasks' && (
        <div className="bm-admin-models">
          <div className="bm-admin-model-list">
            <div className="bm-list-toolbar">
              <div className="bm-filters">
                <select className="bm-select" value={adminAiTaskStatus} onChange={(e) => setAdminAiTaskStatus(e.target.value)}>
                  {aiTaskStatusOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <select className="bm-select" value={adminAiTaskMine} onChange={(e) => setAdminAiTaskMine(e.target.value)}>
                  {aiTaskMineOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <select className="bm-select" value={adminAiTaskLimit} onChange={(e) => setAdminAiTaskLimit(Number(e.target.value))}>
                  <option value={10}>10/页</option>
                  <option value={20}>20/页</option>
                  <option value={50}>50/页</option>
                </select>
                <button type="button" className="bm-refresh" disabled={adminAiTasksLoading} onClick={() => refreshAdminAiTasks({ offset: 0 })}>
                  查询
                </button>
              </div>
            </div>

            {adminAiTasksError ? (
              <p className="bm-error">{adminAiTasksError}</p>
            ) : adminAiTasksLoading ? (
              <p className="bm-loading">加载中…</p>
            ) : !adminAiTasks.length ? (
              <p className="bm-empty">暂无 AI 任务</p>
            ) : (
              <div className="bm-table bm-ai-task-table" role="table" aria-label="AI任务列表">
                <div className="bm-tr bm-th bm-ai-task-tr" role="row">
                  <div className="bm-td bm-ai-task-id" role="columnheader">任务ID</div>
                  <div className="bm-td bm-ai-task-status" role="columnheader">状态</div>
                  <div className="bm-td bm-ai-task-main" role="columnheader">结果 / 错误</div>
                  <div className="bm-td bm-ai-task-meta" role="columnheader">时间 / 费用</div>
                  <div className="bm-td bm-ai-task-action" role="columnheader">操作</div>
                </div>
                {adminAiTasks.map((row) => (
                  <div key={row.id} className="bm-tr bm-ai-task-tr" role="row">
                    <div className="bm-td bm-ai-task-id" role="cell">#{row.id}</div>
                    <div className="bm-td bm-ai-task-status" role="cell">
                      <span className={`bm-badge bm-badge--task-${row.status || 'unknown'}`}>{aiTaskStatusLabel(row.status)}</span>
                    </div>
                    <div className="bm-td bm-ai-task-main" role="cell">
                      <div className="bm-ai-task-summary">{aiTaskSummary(row)}</div>
                      {row.error_message && <div className="bm-ai-task-error">{row.error_message}</div>}
                    </div>
                    <div className="bm-td bm-ai-task-meta" role="cell">
                      <div>{timeText(row.updated_at || row.created_at) || '-'}</div>
                      <div className="bm-ai-task-cost">
                        预估 ¥{centsYuan(row.estimated_cost)} / 实际 ¥{centsYuan(row.actual_cost)}
                      </div>
                    </div>
                    <div className="bm-td bm-ai-task-action" role="cell">
                      <button
                        type="button"
                        className="bm-page-btn"
                        disabled={!canCancelAiTask(row) || adminAiTaskCancelingId === row.id}
                        onClick={() => cancelAdminAiTask(row)}
                      >
                        {adminAiTaskCancelingId === row.id ? '取消中…' : '取消任务'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bm-pager">
              <button type="button" className="bm-page-btn" disabled={!hasAdminAiTaskPrev || adminAiTasksLoading} onClick={goAdminAiTaskPrev}>
                上一页
              </button>
              <span className="bm-page-meta">第 {Math.floor(adminAiTaskOffset / adminAiTaskLimit) + 1} 页</span>
              <button type="button" className="bm-page-btn" disabled={!hasAdminAiTaskNext || adminAiTasksLoading} onClick={goAdminAiTaskNext}>
                下一页
              </button>
            </div>
          </div>
        </div>
      )}

      {adminSubView === 'models' && (
        <div className="bm-admin-models">
          <div className="bm-admin-model-list">
            <div className="bm-list-toolbar">
              <div className="bm-filters">
                <input
                  className="bm-input"
                  type="text"
                  value={adminModelProvider}
                  placeholder="服务商（可选）"
                  onChange={(e) => setAdminModelProvider(e.target.value)}
                />
                <select
                  className="bm-select"
                  value={adminModelEnabled}
                  onChange={(e) => setAdminModelEnabled(e.target.value)}
                >
                  <option value="">全部状态</option>
                  <option value="true">仅启用</option>
                  <option value="false">仅停用</option>
                </select>
                <select
                  className="bm-select"
                  value={adminModelLimit}
                  onChange={(e) => setAdminModelLimit(Number(e.target.value))}
                >
                  <option value={10}>10/页</option>
                  <option value={20}>20/页</option>
                  <option value={50}>50/页</option>
                </select>
                <button type="button" className="bm-refresh" disabled={adminModelsLoading} onClick={() => refreshAdminModels({ offset: 0 })}>
                  查询
                </button>
              </div>
            </div>

            {adminModelsError ? (
              <p className="bm-error">{adminModelsError}</p>
            ) : adminModelsLoading ? (
              <p className="bm-loading">加载中…</p>
            ) : !adminModels.length ? (
              <p className="bm-empty">暂无模型数据</p>
            ) : (
              <div className="bm-table bm-model-table" role="table" aria-label="模型列表">
                <div className="bm-tr bm-th bm-model-tr" role="row">
                  <div className="bm-td bm-model-id" role="columnheader">ID</div>
                  <div className="bm-td bm-model-main" role="columnheader">模型</div>
                  <div className="bm-td bm-model-cap" role="columnheader">能力</div>
                  <div className="bm-td bm-model-st" role="columnheader">状态</div>
                </div>
                {adminModels.map((row) => (
                  <div
                    key={row.id}
                    className={`bm-tr bm-model-tr${Number(row.id) === Number(adminModelEditingId) ? ' selected' : ''}`}
                    role="row"
                    onClick={() => openAdminModel(row.id)}
                  >
                    <div className="bm-td bm-model-id" role="cell">{row.id}</div>
                    <div className="bm-td bm-model-main" role="cell">
                      <div className="bm-model-title">{row.display_name || row.model || row.version}</div>
                    </div>
                    <div className="bm-td bm-model-cap" role="cell">{row.capability || '-'}</div>
                    <div className="bm-td bm-model-st" role="cell">
                      <span className={`bm-badge${row.enabled ? ' on' : ''}`}>{row.enabled ? '启用' : '停用'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bm-pager">
              <button type="button" className="bm-page-btn" disabled={!hasAdminModelPrev || adminModelsLoading} onClick={goAdminModelPrev}>
                上一页
              </button>
              <span className="bm-page-meta">第 {Math.floor(adminModelOffset / adminModelLimit) + 1} 页</span>
              <button type="button" className="bm-page-btn" disabled={!hasAdminModelNext || adminModelsLoading} onClick={goAdminModelNext}>
                下一页
              </button>
            </div>
          </div>
        </div>
      )}

      {adminSubView === 'providers' && (
        <div className="bm-admin-providers">
          {adminProvidersError ? (
            <p className="bm-error">{adminProvidersError}</p>
          ) : adminProvidersLoading ? (
            <p className="bm-loading">加载中…</p>
          ) : !adminProviders.length ? (
            <p className="bm-empty">暂无 Provider 配置</p>
          ) : (
            <div className="bm-provider-grid">
              {adminProviders.map((row) => (
                <article key={row.provider} className="bm-provider-card">
                  <div className="bm-provider-head">
                    <div className="bm-provider-title-wrap">
                      <h3 className="bm-provider-title">{row.provider}</h3>
                      <p className="bm-provider-sub">用于维护 {row.provider} 的网关地址、超时和 API Key。</p>
                    </div>
                    <span className={`bm-badge${row.api_key_configured ? ' on' : ''}`}>
                      {row.api_key_configured ? '已配置 Key' : '未配置 Key'}
                    </span>
                  </div>

                  <div className="bm-provider-body">
                    <label className="bm-provider-field">
                      <span>Base URL</span>
                      <input
                        className="bm-input bm-input--full"
                        type="text"
                        value={adminProviderDrafts[row.provider]?.base_url || ''}
                        placeholder="例如 https://api.openai.com"
                        onChange={(e) => updateAdminProviderDraft(row.provider, 'base_url', e.target.value)}
                      />
                    </label>

                    <label className="bm-provider-field">
                      <span>超时（秒）</span>
                      <input
                        className="bm-input bm-input--full"
                        type="text"
                        inputMode="numeric"
                        value={adminProviderDrafts[row.provider]?.timeout_seconds || ''}
                        placeholder="例如 60"
                        onChange={(e) => updateAdminProviderDraft(row.provider, 'timeout_seconds', e.target.value)}
                      />
                    </label>

                    <label className="bm-provider-field bm-provider-field--wide">
                      <span>API Key</span>
                      <input
                        className="bm-input bm-input--full"
                        type="password"
                        value={adminProviderDrafts[row.provider]?.api_key || ''}
                        placeholder={row.api_key_masked ? `已配置：${row.api_key_masked}` : '输入新 API Key（留空则保持不变）'}
                        onChange={(e) => updateAdminProviderDraft(row.provider, 'api_key', e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="bm-provider-meta">
                    <span>当前掩码：{row.api_key_masked || '未配置'}</span>
                    <span>超时：{row.timeout_seconds || '-'} 秒</span>
                  </div>

                  {adminProviderTestMap[row.provider] && (
                    <div className={`bm-provider-test${adminProviderTestMap[row.provider]?.ok ? ' ok' : ''}`}>
                      <span>{adminProviderTestMap[row.provider]?.ok ? '连接正常' : '连接异常'}</span>
                      <span>{adminProviderTestMap[row.provider]?.message || '-'}</span>
                      {adminProviderTestMap[row.provider]?.http_status ? <span>HTTP {adminProviderTestMap[row.provider]?.http_status}</span> : null}
                    </div>
                  )}

                  <div className="bm-provider-actions">
                    <button
                      type="button"
                      className="bm-refresh"
                      disabled={adminProviderTestingMap[row.provider] || adminProviderSavingMap[row.provider]}
                      onClick={() => testAdminProvider(row.provider)}
                    >
                      {adminProviderTestingMap[row.provider] ? '测试中…' : '测试连接'}
                    </button>
                    <button
                      type="button"
                      className="bm-refresh bm-refresh--primary"
                      disabled={adminProviderSavingMap[row.provider] || adminProviderTestingMap[row.provider]}
                      onClick={() => saveAdminProvider(row.provider)}
                    >
                      {adminProviderSavingMap[row.provider] ? '保存中…' : '保存配置'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={adminModelDialogOpen}
        width={860}
        centered
        closable={false}
        maskClosable={false}
        className="bm-model-dialog"
        onCancel={closeAdminModelDialog}
        title={
          <div className="bm-md-header">
            <div className="bm-md-title">{adminModelEditingId ? `编辑模型（ID：${adminModelEditingId}）` : '新建模型'}</div>
            <div className="bm-md-header-actions">
              {adminModelEditingId ? (
                <Button size="small" loading={adminModelSaving} onClick={toggleAdminModelEnabled}>
                  {adminModelDetail?.enabled ? '停用' : '启用'}
                </Button>
              ) : null}
            </div>
          </div>
        }
        footer={
          <div className="bm-md-footer">
            <Button onClick={closeAdminModelDialog}>取消</Button>
            <Button type="primary" loading={adminModelSaving} onClick={submitAdminModel}>保存</Button>
          </div>
        }
      >
        <div className="bm-md-shell">
          {adminModelSaveError && <p className="bm-error">{adminModelSaveError}</p>}

          <Form
            form={adminModelFormRef as FormInstance}
            labelAlign="right"
            labelCol={{ flex: '110px' }}
            className="bm-md-form"
            initialValues={adminModelDraft}
            onValuesChange={(_changed, all) => setAdminModelDraft((prev: any) => ({ ...prev, ...all }))}
          >
            <div className="bm-md-section">
              <div className="bm-md-section-title">基础信息</div>
              <div className="bm-md-grid">
                <Form.Item
                  name="provider"
                  className="bm-md-item"
                  rules={adminModelFormRules.provider}
                  label={
                    <span className="bm-md-label">
                      <span>服务商</span>
                      <Tooltip title="模型所属服务商，例如 openai / volcengine / bailian" placement="top">
                        <span className="bm-help">?</span>
                      </Tooltip>
                    </span>
                  }
                >
                  <Input disabled={!!adminModelEditingId} placeholder="例如 bailian" />
                </Form.Item>

                <Form.Item
                  name="model"
                  className="bm-md-item"
                  rules={adminModelFormRules.model}
                  label={
                    <span className="bm-md-label">
                      <span>模型标识</span>
                      <Tooltip title="服务商侧的模型名称/标识，例如 gpt-4.1 或 happyhorse-1.0" placement="top">
                        <span className="bm-help">?</span>
                      </Tooltip>
                    </span>
                  }
                >
                  <Input disabled={!!adminModelEditingId} placeholder="例如 happyhorse-1.0" />
                </Form.Item>

                <Form.Item
                  name="capability"
                  className="bm-md-item"
                  rules={adminModelFormRules.capability}
                  label={
                    <span className="bm-md-label">
                      <span>能力类型</span>
                      <Tooltip title="决定该模型用于视频/图片/文本等能力" placement="top">
                        <span className="bm-help">?</span>
                      </Tooltip>
                    </span>
                  }
                >
                  <Select
                    disabled={!!adminModelEditingId}
                    placeholder="请选择"
                    options={adminModelCapabilityOptions}
                  />
                </Form.Item>

                <Form.Item
                  name="display_name"
                  className="bm-md-item"
                  rules={adminModelFormRules.display_name}
                  label={
                    <span className="bm-md-label">
                      <span>展示名称</span>
                      <Tooltip title="用户侧看到的名称，建议写清楚模型和用途" placement="top">
                        <span className="bm-help">?</span>
                      </Tooltip>
                    </span>
                  }
                >
                  <Input placeholder="例如 HappyHorse 参考生视频" />
                </Form.Item>

                <Form.Item
                  name="version"
                  className="bm-md-item"
                  label={
                    <span className="bm-md-label">
                      <span>版本</span>
                      <Tooltip title="版本号或别名，用于区分同一模型的不同版本" placement="top">
                        <span className="bm-help">?</span>
                      </Tooltip>
                    </span>
                  }
                >
                  <Input disabled={!!adminModelEditingId} placeholder="例如 1.0-r2" />
                </Form.Item>

                <Form.Item
                  name="enabled"
                  valuePropName="checked"
                  className="bm-md-item"
                  label={
                    <span className="bm-md-label">
                      <span>启用状态</span>
                      <Tooltip title="仅在新建时生效；编辑时请用右上角“启用/停用”按钮" placement="top">
                        <span className="bm-help">?</span>
                      </Tooltip>
                    </span>
                  }
                >
                  <Checkbox disabled={!!adminModelEditingId}>创建后启用</Checkbox>
                </Form.Item>
              </div>
            </div>

            <Divider />

            <div className="bm-md-section">
              <div className="bm-md-section-title">能力配置</div>
              <div className="bm-md-grid bm-md-grid--single">
                <Form.Item
                  name="task_mode"
                  className="bm-md-item"
                  label={
                    <span className="bm-md-label">
                      <span>任务模式</span>
                      <Tooltip title="同步：请求结束即返回；异步：先创建任务，再轮询结果" placement="top">
                        <span className="bm-help">?</span>
                      </Tooltip>
                    </span>
                  }
                >
                  <Select placeholder="请选择" options={adminModelTaskModeOptions} />
                </Form.Item>

                <Form.Item
                  name="operation_codes"
                  className="bm-md-item"
                  label={
                    <span className="bm-md-label">
                      <span>操作编码</span>
                      <Tooltip title="该模型支持的能力点，例如 video.generate；输入后回车添加" placement="top">
                        <span className="bm-help">?</span>
                      </Tooltip>
                    </span>
                  }
                >
                  <Select
                    mode="tags"
                    maxTagCount="responsive"
                    placeholder="输入后回车添加"
                  />
                </Form.Item>

                <Form.Item
                  name="allowed_plans"
                  className="bm-md-item"
                  label={
                    <span className="bm-md-label">
                      <span>可用套餐</span>
                      <Tooltip title="哪些套餐可以使用该模型；输入后回车添加" placement="top">
                        <span className="bm-help">?</span>
                      </Tooltip>
                    </span>
                  }
                >
                  <Select
                    mode="tags"
                    maxTagCount="responsive"
                    placeholder="输入后回车添加"
                    options={adminModelAllowedPlanOptions.map((code) => ({ label: code, value: code }))}
                  />
                </Form.Item>
              </div>
            </div>

            <Divider />

            <Collapse
              className="bm-md-collapse"
              activeKey={adminModelDialogCollapse}
              onChange={(keys) => setAdminModelDialogCollapse(keys as string[])}
              items={[
                {
                  key: 'advanced',
                  label: '高级配置（系统提示词）',
                  children: (
                    <Form.Item
                      name="system_prompts"
                      className="bm-md-item bm-md-item--wide"
                      rules={adminModelFormRules.system_prompts}
                      label={
                        <span className="bm-md-label">
                          <span>系统提示词</span>
                          <Tooltip title="JSON 对象。用于为模型注入系统级提示词或默认约束" placement="top">
                            <span className="bm-help">?</span>
                          </Tooltip>
                        </span>
                      }
                    >
                      <Input.TextArea
                        autoSize={{ minRows: 8, maxRows: 14 }}
                        placeholder="请输入 JSON 对象，例如 {}"
                      />
                    </Form.Item>
                  ),
                },
                ...(adminModelEditingId
                  ? [
                      {
                        key: 'estimate',
                        label: '估价测试',
                        children: (
                          <div className="bm-md-grid bm-md-grid--single">
                            <div className="bm-md-item">
                              <div className="bm-md-label" style={{ marginBottom: 6 }}>
                                <span>操作编码</span>
                                <Tooltip title="选择一个该模型支持的操作编码进行估价" placement="top">
                                  <span className="bm-help">?</span>
                                </Tooltip>
                              </div>
                              <Input
                                value={adminModelTestOp}
                                onChange={(e) => setAdminModelTestOp(e.target.value)}
                                placeholder="例如 video.generate"
                              />
                            </div>

                            <div className="bm-md-item">
                              <div className="bm-md-label" style={{ marginBottom: 6 }}>
                                <span>提示词</span>
                                <Tooltip title="用于估价的提示词示例" placement="top">
                                  <span className="bm-help">?</span>
                                </Tooltip>
                              </div>
                              <Input
                                value={adminModelTestPrompt}
                                onChange={(e) => setAdminModelTestPrompt(e.target.value)}
                                placeholder="可选"
                              />
                            </div>

                            <div className="bm-md-item bm-md-item--wide">
                              <div className="bm-md-label" style={{ marginBottom: 6 }}>
                                <span>参数(JSON)</span>
                                <Tooltip title="估价所需参数，JSON 对象" placement="top">
                                  <span className="bm-help">?</span>
                                </Tooltip>
                              </div>
                              <Input.TextArea
                                value={adminModelTestParams}
                                onChange={(e) => setAdminModelTestParams(e.target.value)}
                                autoSize={{ minRows: 4, maxRows: 8 }}
                                placeholder="例如 {}"
                              />
                            </div>

                            <div className="bm-md-actions">
                              <Button loading={adminModelTestLoading} onClick={runAdminModelTestEstimate}>
                                {adminModelTestLoading ? '计算中…' : '开始估价'}
                              </Button>
                            </div>

                            {adminModelTestError ? (
                              <p className="bm-error">{adminModelTestError}</p>
                            ) : adminModelTestResult ? (
                              <div className="bm-test-result">
                                <div className="bm-test-row">
                                  <span>estimated_cost</span>
                                  <b>{num(adminModelTestResult.estimated_cost)}</b>
                                </div>
                                {Array.isArray(adminModelTestResult.pricing_breakdown) && (
                                  <div className="bm-test-breakdown">
                                    {adminModelTestResult.pricing_breakdown.map((r: any, idx: number) => (
                                      <div key={idx} className="bm-test-row">
                                        <span>{r.name}</span>
                                        <b>{num(r.credits)}</b>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Form>
        </div>
      </Modal>
    </section>
  )
}
