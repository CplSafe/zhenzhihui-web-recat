/**
 * 发布需求弹窗（右侧抽屉，设计稿「发布需求」）。
 *
 * 入口：需求市场「发布需求」按钮、IP 卡片「发送需求」、IP 详情「发起合作」（后两者带 targetIp）。
 * 提交动作 = 创建需求草稿 + 立即发布，成功后需求出现在需求市场。
 * 视频比例/时长/数量/报名截止时间/产品素材等扩展字段编码进 description 元数据块（见 api/market.ts）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAssetDownloadUrl, uploadAssetFile } from '@/api/business'
import {
  createMarketDemand,
  publishMarketDemand,
  type DemandExtras,
  type DemandMaterial,
  type MarketDemand,
} from '@/api/market'
import { useToast } from '@/composables/useToast'
import { useWorkspaceId } from '@/stores/workspaceSession'
import styles from './DemandFormModal.module.css'

const RATIO_OPTIONS = ['9:16', '16:9', '1:1', '3:4', '4:3'] as const
const DURATION_OPTIONS = ['15S', '30S', '60S', '90S'] as const
const MAX_MATERIALS = 6

interface UploadedMaterial extends DemandMaterial {
  /** 本地预览地址（objectURL，仅本次会话有效） */
  previewUrl: string
  uploading: boolean
}

export interface DemandFormTarget {
  id: number
  name: string
}

interface DemandFormModalProps {
  open: boolean
  /** 从 IP 入口发起时的目标创作者；置空表示面向全市场发布 */
  targetIp?: DemandFormTarget | null
  onClose: () => void
  onPublished?: (demand: MarketDemand) => void
}

/** 今天的 YYYY-MM-DD，作为日期输入的最小值。 */
function todayInputValue(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** YYYY-MM-DD → YYYY/MM/DD（元数据展示格式）。 */
function toSlashDate(value: string): string {
  return value ? value.replace(/-/g, '/') : ''
}

/** 发布需求表单抽屉；只在用户已登录后打开（调用方负责 requireAuth）。 */
export default function DemandFormModal({ open, targetIp = null, onClose, onPublished }: DemandFormModalProps) {
  const { showToast } = useToast()
  const workspaceId = Number(useWorkspaceId() || 0)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [ratio, setRatio] = useState<string>(RATIO_OPTIONS[0])
  const [duration, setDuration] = useState<string>(DURATION_OPTIONS[1])
  const [materials, setMaterials] = useState<UploadedMaterial[]>([])
  const [applyDeadline, setApplyDeadline] = useState('')
  const [deliveryDeadline, setDeliveryDeadline] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const materialsRef = useRef(materials)
  materialsRef.current = materials

  // 打开时重置表单；关闭时释放本地预览 objectURL。
  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setRatio(RATIO_OPTIONS[0])
    setDuration(DURATION_OPTIONS[1])
    setMaterials([])
    setApplyDeadline('')
    setDeliveryDeadline('')
    setPrice('')
    setQuantity('')
    setSubmitting(false)
    return () => {
      materialsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const handleUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []).slice(0, Math.max(0, MAX_MATERIALS - materials.length))
      event.target.value = ''
      if (!files.length) return
      files.forEach((file) => {
        const previewUrl = URL.createObjectURL(file)
        const entry: UploadedMaterial = { name: file.name || '未命名素材', previewUrl, uploading: true }
        setMaterials((current) => [...current, entry])
        // 上传拿 assetId + 签名地址；失败保留文件名占位（元数据里只有 name）。
        uploadAssetFile({ workspaceId, file })
          .then(async (out: any) => {
            const assetId = Number(out?.asset?.id || 0)
            let url = ''
            if (assetId) {
              url = await getAssetDownloadUrl({ workspaceId, assetId }).catch(() => '')
            }
            setMaterials((current) =>
              current.map((item) =>
                item.previewUrl === previewUrl
                  ? { ...item, assetId: assetId || undefined, url: url || undefined, uploading: false }
                  : item,
              ),
            )
          })
          .catch(() => {
            setMaterials((current) =>
              current.map((item) => (item.previewUrl === previewUrl ? { ...item, uploading: false } : item)),
            )
            showToast(`素材「${file.name}」上传失败，将只保留文件名`, 'error')
          })
      })
    },
    [materials.length, showToast, workspaceId],
  )

  const removeMaterial = useCallback((previewUrl: string) => {
    setMaterials((current) => {
      const target = current.find((item) => item.previewUrl === previewUrl)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((item) => item.previewUrl !== previewUrl)
    })
  }, [])

  const canSubmit = title.trim().length > 0 && !submitting && !materials.some((item) => item.uploading)

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    const extras: DemandExtras = {
      ratio,
      duration,
    }
    const quantityValue = Number(quantity)
    if (Number.isFinite(quantityValue) && quantityValue > 0) extras.quantity = Math.floor(quantityValue)
    if (applyDeadline) extras.applyDeadline = toSlashDate(applyDeadline)
    if (deliveryDeadline) extras.deliveryDeadline = toSlashDate(deliveryDeadline)
    const uploaded = materials.map(({ name, url, assetId }) => {
      const material: DemandMaterial = { name }
      if (url) material.url = url
      if (assetId) material.assetId = assetId
      return material
    })
    if (uploaded.length) extras.materials = uploaded
    if (targetIp) {
      extras.targetIpId = targetIp.id
      extras.targetIpName = targetIp.name
    }
    try {
      const created = await createMarketDemand({
        title,
        description,
        pricePerItemYuan: Math.max(0, Number(price) || 0),
        extras,
      })
      try {
        const published = await publishMarketDemand(created.id)
        showToast('需求已发布', 'success')
        onPublished?.(published)
      } catch {
        showToast('需求已保存为草稿，发布失败，请稍后在「我的合作」重试', 'error')
        onPublished?.(created)
      }
      onClose()
    } catch (error: any) {
      showToast(error?.message || '需求创建失败，请稍后重试', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [
    applyDeadline,
    canSubmit,
    deliveryDeadline,
    description,
    duration,
    materials,
    onClose,
    onPublished,
    price,
    quantity,
    ratio,
    showToast,
    targetIp,
    title,
  ])

  if (!open) return null

  return createPortal(
    <div className={styles.mask} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={targetIp ? `向 ${targetIp.name} 发送需求` : '发布需求'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
          ×
        </button>

        {targetIp && (
          <div className={styles.target}>
            向 <strong>{targetIp.name}</strong> 发送制作需求
          </div>
        )}

        <label className={styles.label} htmlFor="demand-form-title">
          需求标题
        </label>
        <input
          id="demand-form-title"
          className={styles.input}
          type="text"
          value={title}
          maxLength={60}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="王老吉国庆宣传视频"
        />

        <label className={styles.label} htmlFor="demand-form-desc">
          详细描述
        </label>
        <div className={styles.descBox}>
          <textarea
            id="demand-form-desc"
            value={description}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="请详细描述你的制作需求..."
          />
          <div className={styles.descChips}>
            <label className={styles.chip}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
                <path d="M10.5 19h3" strokeLinecap="round" />
              </svg>
              <select value={ratio} onChange={(event) => setRatio(event.target.value)} aria-label="视频比例">
                {RATIO_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.chip}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3.2 1.8" strokeLinecap="round" />
              </svg>
              <select value={duration} onChange={(event) => setDuration(event.target.value)} aria-label="视频时长">
                {DURATION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className={styles.label}>产品素材</div>
        <div className={styles.materials}>
          {materials.map((item) => (
            <div className={styles.material} key={item.previewUrl}>
              {isImagePreview(item) ? (
                <img src={item.previewUrl} alt={item.name} />
              ) : (
                <span className={styles.materialDoc}>{extOf(item.name)}</span>
              )}
              {item.uploading && <span className={styles.materialUploading}>上传中…</span>}
              <button type="button" onClick={() => removeMaterial(item.previewUrl)} aria-label={`移除 ${item.name}`}>
                ×
              </button>
            </div>
          ))}
          {materials.length < MAX_MATERIALS && (
            <label className={styles.materialAdd}>
              <span aria-hidden="true">＋</span>
              <input
                type="file"
                accept="image/*,video/*,.doc,.docx,.pdf"
                multiple
                onChange={handleUpload}
                aria-label="添加产品素材"
              />
            </label>
          )}
        </div>

        <div className={styles.row}>
          <label className={styles.inlineField}>
            <span>报名截止时间</span>
            <input
              type="date"
              value={applyDeadline}
              min={todayInputValue()}
              onChange={(event) => setApplyDeadline(event.target.value)}
            />
          </label>
          <label className={styles.inlineField}>
            <span>交付时间</span>
            <input
              type="date"
              value={deliveryDeadline}
              min={applyDeadline || todayInputValue()}
              onChange={(event) => setDeliveryDeadline(event.target.value)}
            />
          </label>
        </div>

        <div className={styles.row}>
          <label className={styles.inlineField}>
            <span>价格</span>
            <span className={styles.suffixInput}>
              <input
                type="number"
                min={0}
                step={1}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="200"
              />
              <em>元/条</em>
            </span>
          </label>
          <label className={styles.inlineField}>
            <span>数量</span>
            <span className={styles.suffixInput}>
              <input
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder="10"
              />
              <em>条</em>
            </span>
          </label>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.submit} disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? '发布中…' : '确定'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0
    ? name
        .slice(dot + 1)
        .toUpperCase()
        .slice(0, 5)
    : '文件'
}

function isImagePreview(item: UploadedMaterial): boolean {
  const ext = extOf(item.name).toLowerCase()
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'].includes(ext)
}
