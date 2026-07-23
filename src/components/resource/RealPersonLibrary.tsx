/**
 * RealPersonLibrary — “我的素材”中的真人素材库与真人形象创建流程。
 * 数据全部来自当前工作空间资产接口，支持分页检索、创建认证引导、照片上传、重命名和删除。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircleFilled,
  CheckOutlined,
  DeleteOutlined,
  FileImageOutlined,
  InboxOutlined,
  LoadingOutlined,
  MoreOutlined,
  PlusCircleFilled,
  ScanOutlined,
  SafetyOutlined,
} from '@ant-design/icons'
import { Dropdown, Pagination } from 'antd'
import type { MenuProps } from 'antd'
import {
  deleteAsset,
  extractAssetPage,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  listAssets,
  uploadAssetFile,
} from '@/api/business'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import './RealPersonLibrary.css'

/** 后端资产来源标记，用于只查询和创建真人素材而不混入普通图片。 */
export const REAL_PERSON_ASSET_SOURCE = 'real_person'

/** 页面展示一张真人形象所需的归一化字段。 */
interface RealPersonRecord {
  id: number
  name: string
  imageUrl: string
  createdAt: number
}

/** 当前工作空间与父页面搜索词。 */
interface RealPersonLibraryProps {
  workspaceId: number
  query?: string
}

/** 兼容后端多版本字段的通用资产记录。 */
type AssetRecord = Record<string, unknown>

/** 真人照片单文件大小上限。 */
const FIVE_MB = 5 * 1024 * 1024

/** 每次向后端请求并展示的真人素材数量。 */
const REAL_PERSON_DISPLAY_PAGE_SIZE = 20

/** 将未知响应安全收窄为普通对象。 */
function asRecord(value: unknown): AssetRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AssetRecord) : {}
}

/** 按优先级返回首个非空兼容字段。 */
function firstValue(record: AssetRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/** 去除文件扩展名并限制长度，生成适合卡片显示的名称。 */
function friendlyName(value: unknown, fallback = '真人形象'): string {
  const name = String(value || '')
    .replace(/\.[^.]+$/, '')
    .trim()
  return (name || fallback).slice(0, 32)
}

/** 兼容秒/毫秒时间戳与 ISO 字符串，解析资产排序时间。 */
function assetTimestamp(asset: AssetRecord): number {
  const value = firstValue(asset, ['created_at', 'createdAt', 'updated_at', 'updatedAt'])
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value
  }
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/** 获取资产签名地址并转换为真人素材视图记录；无效或不可预览资产会被丢弃。 */
async function normalizeAsset(
  assetValue: unknown,
  workspaceId: number,
  fallbackName = '真人形象',
): Promise<RealPersonRecord | null> {
  const asset = asRecord(assetValue)
  const id = Math.floor(Number(firstValue(asset, ['id', 'asset_id', 'assetId'])) || 0)
  if (!id) return null
  const imageUrl = String(await getAssetDownloadUrl({ workspaceId, assetId: id })).trim()
  if (!imageUrl) return null
  return {
    id,
    name: friendlyName(firstValue(asset, ['name', 'title', 'file_name', 'fileName']), fallbackName),
    imageUrl,
    createdAt: assetTimestamp(asset) || Date.now(),
  }
}

/** 真人素材分页查询结果。 */
type RealPersonPage = {
  items: RealPersonRecord[]
  total: number
}

/** 从当前工作空间实时分页查询真人来源资产，不使用前端演示死数据。 */
async function fetchRealPeoplePage(workspaceId: number, pageNumber: number): Promise<RealPersonPage> {
  const offset = Math.max(0, pageNumber - 1) * REAL_PERSON_DISPLAY_PAGE_SIZE
  const payload = await listAssets({
    workspaceId,
    type: 'image',
    status: 'active',
    source: REAL_PERSON_ASSET_SOURCE,
    limit: REAL_PERSON_DISPLAY_PAGE_SIZE,
    offset,
  })
  const page = extractAssetPage(payload)
  // 即使旧后端忽略 limit 返回过多记录，也只解析当前显示页的签名 URL。
  const pageItems = (Array.isArray(page.items) ? page.items : []).slice(0, REAL_PERSON_DISPLAY_PAGE_SIZE)
  const normalized = await Promise.allSettled(
    pageItems
      .filter((item: unknown) => {
        const source = String(asRecord(item).source || '').trim()
        return !source || source === REAL_PERSON_ASSET_SOURCE
      })
      .map((item: unknown) => normalizeAsset(item, workspaceId)),
  )
  const items = normalized
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    .filter((item: RealPersonRecord | null): item is RealPersonRecord => Boolean(item))
    .sort((left: RealPersonRecord, right: RealPersonRecord) => right.createdAt - left.createdAt)
  const totalKnown =
    payload != null &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Number.isFinite(Number((payload as Record<string, unknown>).total))
  const explicitTotal = Math.max(0, Number(page.total) || 0)
  const total = totalKnown
    ? explicitTotal
    : offset +
      pageItems.length +
      (pageItems.length >= REAL_PERSON_DISPLAY_PAGE_SIZE ? REAL_PERSON_DISPLAY_PAGE_SIZE : 0)
  return { items, total }
}

/** 显示上传照片到创建完成的两步进度。 */
function CreationSteps({ step }: { step: 1 | 2 }) {
  const steps = ['上传照片', '创建完成']
  return (
    <ol className="real-person-steps is-two" aria-label="创建真人形象进度">
      {steps.map((label, index) => {
        const number = (index + 1) as 1 | 2
        const state = number < step ? 'is-done' : number === step ? 'is-active' : ''
        return (
          <li key={label} className={`real-person-step ${state}`} aria-current={number === step ? 'step' : undefined}>
            <span className="real-person-step-indicator">{number < step ? <CheckOutlined /> : number}</span>
            <span className="real-person-step-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** 创建流程左侧的一条照片质量或授权要求。 */
function GuideFeature({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="real-person-guide-feature">
      <span className="real-person-guide-feature-icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </div>
  )
}

/** 提供点击和拖放两种照片选择方式，并在上传期间锁定重复操作。 */
function UploadStep({ onUpload, uploading }: { onUpload: (file: File) => void; uploading: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div className="real-person-flow-content">
      <section className="real-person-guide-copy" aria-labelledby="real-person-upload-title">
        <h2 id="real-person-upload-title">上传本人或已获授权的照片</h2>
        <p>照片上传完成后会保存到当前团队的真人素材库，可在其他设备重新打开</p>
        <div className="real-person-guide-features is-compact">
          <GuideFeature icon={<ScanOutlined />} title="面部清晰" description="确保脸部清晰可见，避免模糊或遮挡" />
          <GuideFeature
            icon={<SafetyOutlined />}
            title="合法授权"
            description="请仅上传本人照片或已取得明确授权的素材"
          />
        </div>
        <div className="real-person-service-note">
          <span />
          素材将安全保存到当前团队空间
          <span />
        </div>
      </section>

      <section
        className={`real-person-upload-panel${dragging ? ' is-dragging' : ''}${uploading ? ' is-uploading' : ''}`}
        aria-busy={uploading}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!uploading) setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault()
          if (event.currentTarget === event.target) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (uploading) return
          const file = event.dataTransfer.files?.[0]
          if (file) onUpload(file)
        }}
      >
        <button
          type="button"
          className="real-person-upload-trigger"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <span className="real-person-upload-icon" aria-hidden="true">
            {uploading ? <LoadingOutlined spin /> : <FileImageOutlined />}
            {!uploading ? <PlusCircleFilled /> : null}
          </span>
          <strong>{uploading ? '正在上传并保存…' : '点击上传照片'}</strong>
          <small>支持 JPG、PNG，大小不超过 5MB</small>
        </button>
        <input
          ref={inputRef}
          className="real-person-file-input"
          type="file"
          accept="image/jpeg,image/png"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onUpload(file)
            event.currentTarget.value = ''
          }}
        />
      </section>
    </div>
  )
}

/** 上传持久化完成后的成功反馈与返回素材库入口。 */
function SuccessStep({ onFinish }: { onFinish: () => void }) {
  return (
    <section className="real-person-success" aria-labelledby="real-person-success-title">
      <span className="real-person-success-illustration" aria-hidden="true">
        <CheckCircleFilled />
        <InboxOutlined />
      </span>
      <h2 id="real-person-success-title">创建完成</h2>
      <p>真人形象已保存到当前团队素材库</p>
      <button type="button" onClick={onFinish}>
        完成
      </button>
    </section>
  )
}

/** 协调真人素材查询、筛选、分页、上传和删除，并隔离切空间时的过期异步响应。 */
export default function RealPersonLibrary({ workspaceId, query = '' }: RealPersonLibraryProps) {
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const [people, setPeople] = useState<RealPersonRecord[]>([])
  const [totalPeople, setTotalPeople] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [creating, setCreating] = useState(false)
  const [page, setPage] = useState(1)
  const [step, setStep] = useState<1 | 2>(1)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(0)
  const loadSequenceRef = useRef(0)

  // 请求序号保证较慢的旧页/旧空间响应不会覆盖用户刚切换后的新列表。
  const loadPeople = useCallback(
    async (targetPage = page) => {
      const wsId = Math.floor(Number(workspaceId) || 0)
      const sequence = ++loadSequenceRef.current
      setLoadError('')
      setPeople([])
      if (!wsId) {
        setLoading(false)
        setLoadError('当前团队空间不可用')
        return
      }

      setLoading(true)
      try {
        const result = await fetchRealPeoplePage(wsId, targetPage)
        if (sequence === loadSequenceRef.current) {
          setPeople(result.items)
          setTotalPeople(result.total)
        }
      } catch (error: unknown) {
        if (sequence === loadSequenceRef.current) {
          setLoadError(getBusinessErrorMessage(error, '真人素材加载失败，请稍后重试'))
        }
      } finally {
        if (sequence === loadSequenceRef.current) setLoading(false)
      }
    },
    [page, workspaceId],
  )

  useEffect(() => {
    void loadPeople(page)
    return () => {
      loadSequenceRef.current += 1
    }
  }, [loadPeople, page])

  const visiblePeople = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return people
    return people.filter((person) => person.name.toLowerCase().includes(keyword))
  }, [people, query])
  const totalPages = Math.max(1, Math.ceil(totalPeople / REAL_PERSON_DISPLAY_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginatedPeople = visiblePeople

  useEffect(() => {
    setPage(1)
  }, [query, workspaceId])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const startCreating = () => {
    if (loading || uploading || !workspaceId) return
    setStep(1)
    setCreating(true)
  }

  const leaveCreating = () => {
    if (uploading) return
    setCreating(false)
    setStep(1)
  }

  // 先在前端校验授权照片格式和大小，再携带 real_person 来源持久化到当前空间。
  const handleUpload = async (file: File) => {
    if (uploading) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      showToast('仅支持 JPG、PNG 格式的照片', 'error')
      return
    }
    if (file.size > FIVE_MB) {
      showToast('照片大小不能超过 5MB', 'error')
      return
    }

    const wsId = Math.floor(Number(workspaceId) || 0)
    if (!wsId) {
      showToast('当前团队空间不可用', 'error')
      return
    }

    setUploading(true)
    try {
      const result = asRecord(
        await uploadAssetFile({
          workspaceId: wsId,
          file,
          source: REAL_PERSON_ASSET_SOURCE,
          prompt: '真人形象',
          signal: undefined,
        }),
      )
      const asset = result.asset || result
      const person = await normalizeAsset(asset, wsId, friendlyName(file.name))
      if (!person) throw new Error('服务端未返回有效的真人素材')
      setPeople((current) => [person, ...current.filter((item) => item.id !== person.id)])
      setTotalPeople((current) => current + (people.some((item) => item.id === person.id) ? 0 : 1))
      setPage(1)
      setStep(2)
      showToast('照片已上传并保存', 'success')
    } catch (error: unknown) {
      showToast(getBusinessErrorMessage(error, '照片上传失败，请重新上传'), 'error')
    } finally {
      setUploading(false)
    }
  }

  // 删除不可恢复，因此必须二次确认；成功后同步分页总数而不是只移除视觉卡片。
  const removePerson = async (person: RealPersonRecord) => {
    if (deletingId) return
    const confirmed = await requestConfirm(`确定删除“${person.name}”吗？删除后无法恢复。`, {
      title: '删除形象',
      confirmLabel: '删除',
      danger: true,
    })
    if (!confirmed) return

    setDeletingId(person.id)
    try {
      await deleteAsset({ workspaceId, assetId: person.id })
      setPeople((current) => current.filter((item) => item.id !== person.id))
      setTotalPeople((current) => Math.max(0, current - 1))
      showToast('形象已删除', 'success')
    } catch (error: unknown) {
      showToast(getBusinessErrorMessage(error, '形象删除失败，请稍后重试'), 'error')
    } finally {
      setDeletingId(0)
    }
  }

  if (creating) {
    return (
      <div className="real-person-flow" role="dialog" aria-modal="true" aria-label="创建真人形象">
        <button type="button" className="real-person-flow-exit" disabled={uploading} onClick={leaveCreating}>
          返回真人素材库
        </button>
        <CreationSteps step={step} />
        {step === 1 ? (
          <UploadStep onUpload={handleUpload} uploading={uploading} />
        ) : (
          <SuccessStep onFinish={leaveCreating} />
        )}
      </div>
    )
  }

  return (
    <section className="real-person-library" aria-label="真人素材库" aria-busy={loading}>
      <div className="real-person-grid">
        {paginatedPeople.map((person) => {
          const deleting = deletingId === person.id
          const menuItems: MenuProps['items'] = [
            {
              key: 'delete',
              label: deleting ? '删除中…' : '删除形象',
              icon: deleting ? <LoadingOutlined /> : <DeleteOutlined />,
              disabled: deleting,
            },
          ]
          return (
            <article key={person.id} className="real-person-card" aria-busy={deleting}>
              <img src={person.imageUrl} alt={person.name} />
              <div className="real-person-card-footer">
                <strong title={person.name}>{person.name}</strong>
                <Dropdown
                  disabled={deleting}
                  trigger={['click']}
                  placement="bottomRight"
                  menu={{
                    items: menuItems,
                    onClick: ({ key }) => {
                      if (key === 'delete') void removePerson(person)
                    },
                  }}
                >
                  <button type="button" disabled={deleting} aria-label={`${person.name}的更多操作`}>
                    {deleting ? <LoadingOutlined spin /> : <MoreOutlined />}
                  </button>
                </Dropdown>
              </div>
            </article>
          )
        })}

        <button
          type="button"
          className="real-person-create-card"
          disabled={loading || !workspaceId}
          onClick={startCreating}
        >
          <PlusCircleFilled />
          <strong>创建新形象</strong>
          <span>上传后同步到当前团队素材库</span>
        </button>

        {loading ? (
          <p className="real-person-state" role="status">
            <LoadingOutlined spin /> 正在加载真人素材…
          </p>
        ) : loadError ? (
          <div className="real-person-state is-error" role="alert">
            <span>{loadError}</span>
            <button type="button" onClick={() => void loadPeople(page)}>
              重新加载
            </button>
          </div>
        ) : !visiblePeople.length ? (
          <p className="real-person-no-result">
            {query.trim() ? '当前页未找到匹配的真人形象，可切换分页继续查找' : '暂无真人形象，上传后会同步显示在这里'}
          </p>
        ) : null}
      </div>
      {totalPeople > REAL_PERSON_DISPLAY_PAGE_SIZE ? (
        <div className="real-person-pagination" aria-label="真人素材分页">
          <Pagination
            current={safePage}
            pageSize={REAL_PERSON_DISPLAY_PAGE_SIZE}
            total={totalPeople}
            showSizeChanger={false}
            showLessItems
            onChange={setPage}
          />
        </div>
      ) : null}
    </section>
  )
}
