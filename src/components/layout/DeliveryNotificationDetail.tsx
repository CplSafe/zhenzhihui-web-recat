import { useEffect, useState } from 'react'
import { getManualVideoTask } from '@/api/manualVideo'
import { getPromoOrder } from '@/api/promo'

const fieldNames: Record<string, string> = {
  id: '编号',
  task_id: '任务编号',
  status: '任务状态',
  billing_status: '积分状态',
  company: '单位',
  contact: '联系人',
  phone: '联系电话',
  scenario: '场景',
  narration: '旁白与字幕',
  brief: '制作需求',
  prompt: '制作需求',
  reference_url: '参考链接',
  model_version_id: '模型编号',
  count: '生成数量',
  generate_audio: '生成背景音',
  duration_seconds: '时长（秒）',
  duration: '时长（秒）',
  ratio: '画面比例',
  resolution: '分辨率',
  estimated_cost: '预计积分',
  actual_cost: '实际积分',
  promised_date: '承诺交付日期',
  created_at: '创建时间',
  updated_at: '更新时间',
  delivered_at: '交付时间',
  first_delivered_at: '首次交付时间',
  error_message: '失败原因',
  rework_status: '修改状态',
  rework_text: '修改需求',
  rework_reply: '修改回复',
  is_overdue: '是否逾期',
  can_rework: '可申请修改',
  parent_task_id: '原任务编号',
}
const values: Record<string, string> = {
  pending: '等待制作',
  awaiting_manual: '等待制作',
  producing: '制作中',
  manual_processing: '制作中',
  reworking: '修改中',
  overdue: '已逾期',
  succeeded: '已交付',
  delivered: '已交付',
  completed: '已完成',
  cancelled: '已取消',
  failed: '制作失败',
  frozen: '已冻结',
  settled: '已结算',
  refunded: '已退回',
  unused: '未使用',
  requested: '待受理',
  accepted: '已受理',
  rejected: '已婉拒',
  fulfilled: '已交付',
  government_corporate: '政企宣传',
  product_launch: '产品发布',
  investment_financing: '招商融资',
  both: '旁白及字幕',
  subtitles: '仅字幕',
  narration: '仅旁白',
  none: '均不需要',
}

export default function DeliveryNotificationDetail({
  kind,
  id,
  workspaceId,
  onBack,
  onOpen,
}: {
  kind: 't1' | 't5'
  id: number
  workspaceId: number
  onBack: () => void
  onOpen: () => void
}) {
  const [record, setRecord] = useState<Record<string, any> | null>(null)
  const [materials, setMaterials] = useState<Array<{ id: number; name?: string; role?: string; status?: string }>>([])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setRecord(null)
    setError('')
    const request =
      kind === 't1'
        ? getManualVideoTask(workspaceId, id, controller.signal).then((task) => ({ record: task, materials: [] }))
        : getPromoOrder(id, controller.signal).then((result) => ({
            record: result.order,
            materials: result.materials || [],
          }))
    void request
      .then((result) => {
        if (!controller.signal.aborted) {
          setRecord(result.record)
          setMaterials(result.materials)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '详情加载失败')
      })
    return () => controller.abort()
  }, [kind, id, workspaceId, attempt])
  const data = record
    ? { ...record, ...(record.params && typeof record.params === 'object' ? record.params : {}) }
    : null
  return (
    <div className="notify__detail">
      <button type="button" className="notify__detail-back" onClick={onBack}>
        ← 返回通知
      </button>
      <h3>
        {kind === 't1' ? 'T+1 精制任务' : 'T+5 宣传片订单'} #{id}
      </h3>
      {error ? (
        <div role="alert">
          详情加载失败：{error}{' '}
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            重试
          </button>
        </div>
      ) : !data ? (
        <p role="status">正在加载任务详情…</p>
      ) : (
        <>
          <div className="notify__detail-content">
            <dl className="notify__detail-fields">
              {Object.entries(fieldNames).map(([key, label]) => {
                const value = data[key]
                if (value === undefined || value === null || value === '') return null
                const text = typeof value === 'boolean' ? (value ? '是' : '否') : values[String(value)] || String(value)
                return (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{text}</dd>
                  </div>
                )
              })}
            </dl>
            {materials.length > 0 && (
              <section>
                <h4>素材</h4>
                <ul>
                  {materials.map((item) => (
                    <li key={item.id}>
                      {item.name || `素材 #${item.id}`}{' '}
                      {item.status ? `· ${item.status === 'active' ? '已就绪' : item.status}` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {Array.isArray(data.input_assets) && data.input_assets.length > 0 && (
              <section>
                <h4>参考素材</h4>
                <ul>
                  {data.input_assets.map((item: { asset_id?: number; role?: string }, index: number) => (
                    <li key={`${item.asset_id || index}`}>
                      {item.asset_id ? `素材 #${item.asset_id}` : `素材 ${index + 1}`}
                      {item.role ? ` · ${item.role}` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {Array.isArray(data.outputs) && data.outputs.length > 0 && (
              <section>
                <h4>交付内容</h4>
                <ul>
                  {data.outputs.map((item: { asset_id?: number; type?: string }, index: number) => (
                    <li key={`${item.asset_id || index}`}>
                      {item.type === 'video' ? '视频' : item.type === 'image' ? '图片' : '文件'}
                      {item.asset_id ? ` · 素材 #${item.asset_id}` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <button type="button" className="notify__detail-open" onClick={onOpen}>
            查看任务与交付 →
          </button>
        </>
      )}
    </div>
  )
}
