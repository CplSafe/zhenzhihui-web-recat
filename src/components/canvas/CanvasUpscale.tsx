import { useEffect, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import { Alert, Button, Modal, Select, Space, Spin } from 'antd'
import { createAiTask, estimateAiTaskCost, getAiTaskId, getAiTask, listAiModels, waitForAiTask } from '@/api/business'
import type { ToolField } from '@/api/canvasTools'
import type { HdTask } from '@/api/canvasHd'
import type { HdRequest } from './CanvasHdWorkspace'
import { hdSources } from '@/utils/canvasHd'
import { creditsYuanLabel } from '@/utils/creditsYuan'
import { activeToolParams, schemaDefaults, validateToolFields } from '@/utils/canvasTools'
import CanvasToolFields from './CanvasToolFields'
import { showToast } from '@/stores/ui'
import { extractOutputAssetId, findAssetIdByTaskId } from '@/utils/taskMedia'

interface Model {
  id: number
  display_name?: string
  name?: string
  operation_codes?: string[]
  params_schema?: { fields?: ToolField[] } | string
}
export function upscaleFields(model?: Model, operation = ''): ToolField[] {
  let schema = model?.params_schema
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema)
    } catch {
      return []
    }
  }
  return typeof schema === 'object' && Array.isArray(schema?.fields)
    ? schema.fields.filter(
        (field) =>
          !['input_assets', 'image_urls', 'video_url', 'prompt', 'stream'].includes(field.name) &&
          (!field.operation_codes?.length || field.operation_codes.includes(operation)),
      )
    : []
}

export default function CanvasUpscale(props: {
  workspaceId: number
  canvasId: number
  nodes: Node[]
  request: HdRequest | null
  onCloseRequest: () => void
  onTasks: (tasks: HdTask[]) => void
  onModalChange: (open: boolean) => void
}) {
  const source = hdSources(props.nodes.filter((node) => props.request?.ids.includes(node.id)))[0]
  const operation = source ? `${source.kind}.upscale` : ''
  const [models, setModels] = useState<Model[]>([])
  const [modelId, setModelId] = useState(0)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [quote, setQuote] = useState<any>(null)
  const lock = useRef(false)
  const tasks = useRef<HdTask[]>([])
  const key = useRef('')
  const controller = useRef(new AbortController())
  useEffect(() => {
    const active = new AbortController()
    controller.current = active
    return () => active.abort()
  }, [])
  const open = Boolean(props.request)
  const { onModalChange } = props
  useEffect(() => {
    onModalChange(open)
  }, [open, onModalChange])
  useEffect(() => {
    setQuote(null)
    setError('')
    setModels([])
    setModelId(0)
    setValues({})
    key.current = crypto.randomUUID()
    if (!open || !operation) return
    const abort = new AbortController()
    setLoading(true)
    listAiModels({ workspaceId: props.workspaceId, operationCode: operation, plan: '', signal: abort.signal })
      .then((list) => {
        if (abort.signal.aborted) return
        const available = (Array.isArray(list) ? list : []).filter((m: Model) => m.operation_codes?.includes(operation))
        setModels(available)
        setModelId(Number(available[0]?.id || 0))
        setValues(schemaDefaults(upscaleFields(available[0], operation)))
      })
      .catch((err) => {
        if (!abort.signal.aborted) setError(err.message)
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [open, operation, props.workspaceId, props.request?.key])
  const model = models.find((m) => Number(m.id) === modelId)
  const fields = upscaleFields(model, operation)
  const body =
    source && model
      ? {
          workspaceId: props.workspaceId,
          modelVersionId: modelId,
          operationCode: model.operation_codes!.find((op) => op === operation),
          params: activeToolParams(fields, values),
          inputAssets: [{ asset_id: source.asset_id, role: source.kind }],
        }
      : null
  const fingerprint = JSON.stringify(body)
  useEffect(() => {
    setQuote(null)
  }, [fingerprint])
  async function run() {
    if (lock.current || !source || !body) return
    const validation = validateToolFields(fields, values)
    if (validation) {
      setError(validation)
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (!quote || quote.key !== fingerprint) {
        const result = await estimateAiTaskCost(body)
        if (
          !Number.isFinite(result?.estimated_cost) ||
          result.estimated_cost < 0 ||
          !Number.isFinite(result?.balance) ||
          result.balance < 0 ||
          typeof result?.can_afford !== 'boolean'
        )
          throw new Error('估价信息不完整，请重试')
        setQuote({ ...result, key: fingerprint })
        return
      }
      const task = await createAiTask({ ...body, capability: source.kind, idempotencyKey: key.current })
      const base: HdTask = {
        id: String(getAiTaskId(task)),
        workspace_id: props.workspaceId,
        canvas_id: props.canvasId,
        canvas_name: '',
        source,
        source_spec: '',
        target: { resolution: '', fps: 0 },
        status: 'queued',
        submitted_at: new Date().toISOString(),
        credits: quote.estimated_cost,
        refund_status: 'none',
        refunded_credits: 0,
      }
      const publish = (current: any) => {
        if (controller.current.signal.aborted) return
        const output = current.outputs?.find((item: any) => Number(item.asset_id || item.asset?.id) > 0)
        const status = ['succeeded', 'completed', 'success'].includes(current.status)
          ? 'completed'
          : ['failed', 'error', 'payment_failed', 'cancelled', 'expired'].includes(current.status)
            ? 'failed'
            : 'processing'
        const row: HdTask = {
          ...base,
          status,
          result: output
            ? {
                asset_id: Number(output.asset_id || output.asset?.id),
                name: `${source.name}超分`,
                spec: '',
                width: Number(output.width || 0),
                height: Number(output.height || 0),
                review_policy: '',
              }
            : undefined,
        }
        tasks.current = [...tasks.current.filter((item) => item.id !== row.id), row]
        props.onTasks(tasks.current)
      }
      publish(task)
      props.onCloseRequest()
      void getAiTask({ workspaceId: props.workspaceId, taskId: getAiTaskId(task) })
        .then((detail) =>
          waitForAiTask({
            workspaceId: props.workspaceId,
            task: detail,
            intervalMs: 3000,
            timeoutMs: 3600000,
            signal: controller.current.signal,
            onPoll: publish,
          }),
        )
        .then(async (completed) => {
          const assetId =
            extractOutputAssetId(completed) ||
            (await findAssetIdByTaskId(props.workspaceId, getAiTaskId(task), source.kind))
          if (controller.current.signal.aborted) return
          if (!assetId) throw new Error('超分已完成，但结果素材尚未入库，请在素材库中查看')
          publish({ ...completed, outputs: [{ asset_id: assetId }], status: 'completed' })
          showToast('超分完成，已添加到画布', 'success')
        })
        .catch((err) => {
          if (!controller.current.signal.aborted) {
            publish({ status: 'failed' })
            showToast(err.message || '超分任务查询失败', 'error')
          }
        })
    } catch (err) {
      setError(err instanceof Error ? err.message : '超分请求失败')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      title="超分"
      footer={null}
      onCancel={() => {
        if (!busy) props.onCloseRequest()
      }}
      maskClosable={false}
    >
      {loading ? (
        <Spin />
      ) : !source || source.asset_id <= 0 ? (
        <Alert type="warning" message="请选择已上传或生成的图片、视频" />
      ) : !models.length ? (
        <Alert type="info" message="当前空间暂无可用超分模型，请联系管理员启用模型并授权套餐。" />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <span>{source.name}</span>
          <Select
            aria-label="超分模型"
            value={modelId}
            disabled={busy}
            style={{ width: '100%' }}
            options={models.map((m) => ({ value: Number(m.id), label: m.display_name || m.name }))}
            onChange={(id) => {
              setModelId(id)
              setValues(
                schemaDefaults(
                  upscaleFields(
                    models.find((m) => Number(m.id) === id),
                    operation,
                  ),
                ),
              )
              key.current = crypto.randomUUID()
            }}
          />
          <CanvasToolFields
            fields={fields}
            values={values}
            disabled={busy}
            onChange={(next) => {
              setValues(next)
              key.current = crypto.randomUUID()
            }}
          />
          {quote && (
            <Alert
              type={quote.can_afford ? 'info' : 'warning'}
              message={`${quote.estimate_kind === 'reservation' ? '预冻结金额' : '预估费用'}：${creditsYuanLabel(quote.estimated_cost)} · 余额 ${quote.balance} 积分`}
              description={quote.estimate_note}
            />
          )}
          <Button
            type="primary"
            loading={busy}
            disabled={Boolean(quote && (!quote.can_afford || quote.balance < quote.estimated_cost))}
            onClick={() => void run()}
          >
            {quote ? '确认超分' : '预估费用'}
          </Button>
        </Space>
      )}
      {error && <Alert type="error" message={error} style={{ marginTop: 12 }} />}
    </Modal>
  )
}
