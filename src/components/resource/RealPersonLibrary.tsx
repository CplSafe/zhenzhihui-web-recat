/**
 * 真人素材库与真人形象创建流程。
 *
 * 领域关系严格遵循后端专用接口：
 * 真人档案（KYC）→ 本地素材 → 真人素材映射 → provider 状态同步。
 * 列表和删除不再把普通 Asset ID 当作真人档案 ID。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FileImageOutlined,
  InboxOutlined,
  LoadingOutlined,
  LockOutlined,
  MobileOutlined,
  PlusCircleFilled,
  ReloadOutlined,
  SafetyOutlined,
  ScanOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import { Dropdown, Pagination } from 'antd'
import type { MenuProps } from 'antd'
import { renderSVG } from 'uqr'
import { getAssetDownloadUrl, getBusinessErrorMessage, uploadAssetFile } from '@/api/business'
import {
  addRealPersonAsset,
  createRealPerson,
  deleteRealPerson,
  deleteRealPersonAsset,
  getRealPerson,
  listRealPeople,
  restartRealPersonVerification,
  syncRealPerson,
  syncRealPersonAsset,
} from '@/api/realPeople'
import type { RealPerson, RealPersonAsset, RealPersonSession } from '@/api/realPeople'
import realPersonMoreIcon from '@/assets/resource/figma-real-person-more.svg'
import realPersonPlusIcon from '@/assets/resource/figma-real-person-plus.svg'
import { useConfirmDialog, useToast } from '@/composables/useToast'
import './RealPersonLibrary.css'

/** 普通素材上传时写入的来源标记，便于素材中心识别真人素材。 */
export const REAL_PERSON_ASSET_SOURCE = 'real_person'
/** Figma 真人卡片每页显示数量。专用列表接口返回完整数组，分页在前端完成。 */
const REAL_PERSON_DISPLAY_PAGE_SIZE = 20
const FIVE_MB = 5 * 1024 * 1024
const ONE_HUNDRED_MB = 100 * 1024 * 1024
const ASSET_SYNC_ATTEMPTS = 5
const ASSET_SYNC_INTERVAL_MS = 1500
const BIND_RECOVERY_ATTEMPTS = 8
const BIND_RECOVERY_INTERVAL_MS = 1000
const KYC_SYNC_INTERVAL_MS = 3000
const KYC_SYNC_MAX_DURATION_MS = 30 * 60 * 1000

interface RealPersonLibraryProps {
  workspaceId: number
  userId: number
  query?: string
}

interface RealPersonCardRecord {
  id: number
  name: string
  imageUrl: string
  createdAt: number
  person: RealPerson
}

interface PendingLocalAsset {
  assetId: number
  name: string
}

interface StoredCreationDraft {
  personId: number
  localAssetId?: number
  localAssetName?: string
  mappingId?: number
}

type FlowStep = 1 | 2 | 3
type FlowMode = 'create' | 'manage'
type StatusTone = 'ready' | 'pending' | 'failed'

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value
  }
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function statusToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
}

function statusIs(value: unknown, candidates: readonly string[]): boolean {
  const token = statusToken(value)
  return candidates.includes(token)
}

function isRealPersonVerified(person: RealPerson | null | undefined): boolean {
  if (!person) return false
  if (toTimestamp(person.verified_at) > 0) return true
  return statusIs(person.status, ['verified'])
}

function isVerificationExpired(person: RealPerson | null | undefined, session?: RealPersonSession | null): boolean {
  const expiresAt = toTimestamp(session?.expires_at || person?.verification_expires_at)
  if (expiresAt > 0 && expiresAt <= Date.now()) return true
  return statusIs(person?.status, ['expired', 'verification_expired', 'kyc_expired'])
}

function isRealPersonFailed(person: RealPerson | null | undefined): boolean {
  if (!person) return false
  return statusIs(person.status, [
    'failed',
    'failure',
    'rejected',
    'denied',
    'cancelled',
    'canceled',
    'error',
    'verification_failed',
  ])
}

function isRealPersonAssetActive(asset: RealPersonAsset | null | undefined): boolean {
  return statusIs(asset?.status, ['active'])
}

function isRealPersonAssetFailed(asset: RealPersonAsset | null | undefined): boolean {
  if (!asset) return false
  return statusIs(asset.status, ['failed', 'failure', 'rejected', 'error', 'deleted'])
}

function getPersonStatus(person: RealPerson): { label: string; tone: StatusTone } {
  if (isRealPersonVerified(person)) {
    return person.assets?.some(isRealPersonAssetActive)
      ? { label: '已可用', tone: 'ready' }
      : { label: '待上传素材', tone: 'pending' }
  }
  if (isVerificationExpired(person)) return { label: '认证已过期', tone: 'failed' }
  if (isRealPersonFailed(person)) return { label: '认证失败', tone: 'failed' }
  return { label: '待真人认证', tone: 'pending' }
}

function getAssetStatus(asset: RealPersonAsset): { label: string; tone: StatusTone } {
  if (isRealPersonAssetActive(asset)) return { label: '可用', tone: 'ready' }
  if (isRealPersonAssetFailed(asset)) return { label: '处理失败', tone: 'failed' }
  return { label: '处理中', tone: 'pending' }
}

function friendlyName(value: unknown, fallback = '真人形象'): string {
  const name = String(value || '')
    .replace(/\.[^.]+$/, '')
    .trim()
  return (name || fallback).slice(0, 32)
}

function isAbortError(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    ('cause' in error || 'name' in error) &&
    ((error as { cause?: unknown }).cause === 'aborted' || (error as { name?: unknown }).name === 'AbortError')
  )
}

function getRealPeopleErrorMessage(error: unknown, fallback: string): string {
  if (Number((error as { status?: unknown })?.status || 0) === 404) {
    return '当前环境尚未部署真人素材接口，请联系后端部署后重试'
  }
  return getBusinessErrorMessage(error, fallback)
}

function safeKycUrl(value: unknown): string {
  const raw = firstText(value)
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'https:') return parsed.toString()
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]')
    ) {
      return parsed.toString()
    }
  } catch {
    return ''
  }
  return ''
}

function creationStorageKey(workspaceId: number, userId: number): string {
  return `zzh:real-person-creation:${Math.floor(Number(userId) || 0)}:${Math.floor(Number(workspaceId) || 0)}`
}

function readCreationDraft(workspaceId: number, userId: number): StoredCreationDraft | null {
  try {
    const raw = sessionStorage.getItem(creationStorageKey(workspaceId, userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCreationDraft
    return Number(parsed?.personId || 0) > 0 ? parsed : null
  } catch {
    return null
  }
}

function writeCreationDraft(workspaceId: number, userId: number, value: StoredCreationDraft | null): void {
  try {
    if (!value) {
      sessionStorage.removeItem(creationStorageKey(workspaceId, userId))
      return
    }
    sessionStorage.setItem(creationStorageKey(workspaceId, userId), JSON.stringify(value))
  } catch {
    // 隐私模式或存储配额不足不应阻断真人认证主流程。
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('请求已取消'), { cause: 'aborted' }))
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const timer = window.setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      cleanup()
      reject(Object.assign(new Error('请求已取消'), { cause: 'aborted' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function pickCoverAsset(person: RealPerson): RealPersonAsset | null {
  const assets = Array.isArray(person.assets) ? person.assets : []
  return (
    assets.find((asset) => isRealPersonAssetActive(asset) && statusToken(asset.asset_type) === 'image') ||
    assets.find((asset) => isRealPersonAssetActive(asset)) ||
    assets.find((asset) => statusToken(asset.asset_type) === 'image') ||
    assets[0] ||
    null
  )
}

async function normalizePerson(person: RealPerson, workspaceId: number): Promise<RealPersonCardRecord> {
  const cover = pickCoverAsset(person)
  let imageUrl = ''
  if (Number(cover?.local_asset_id || 0) > 0 && statusToken(cover?.asset_type) !== 'video') {
    try {
      imageUrl = firstText(
        await getAssetDownloadUrl({
          workspaceId,
          assetId: Number(cover?.local_asset_id || 0),
        }),
      )
    } catch {
      imageUrl = ''
    }
  }
  return {
    id: Number(person.id || 0),
    name: friendlyName(person.name),
    imageUrl,
    createdAt: toTimestamp(person.created_at) || toTimestamp(person.updated_at),
    person,
  }
}

function CreationSteps({ step }: { step: FlowStep }) {
  const steps = ['真人认证', '上传照片', '创建完成']
  return (
    <ol className="real-person-steps" aria-label="创建真人形象进度">
      {steps.map((label, index) => {
        const number = (index + 1) as FlowStep
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

function GuideFeature({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
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

function ResilientImage({ src, alt, fallback }: { src: string; alt: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) return <>{fallback}</>
  return <img src={src} alt={alt} onError={() => setFailed(true)} />
}

function LocalQrCode({ value }: { value: string }) {
  const source = useMemo(() => {
    const svg = renderSVG(value, { ecc: 'M', border: 2 })
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }, [value])

  return <img src={source} alt="真人认证二维码" aria-label={`认证二维码 ${value}`} />
}

interface VerificationStepProps {
  person: RealPerson | null
  session: RealPersonSession | null
  name: string
  description: string
  consentConfirmed: boolean
  busy: boolean
  syncing: boolean
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onConsentChange: (value: boolean) => void
  onCreate: () => void
  onRestart: () => void
  onSync: () => void
}

function VerificationStep({
  person,
  session,
  name,
  description,
  consentConfirmed,
  busy,
  syncing,
  onNameChange,
  onDescriptionChange,
  onConsentChange,
  onCreate,
  onRestart,
  onSync,
}: VerificationStepProps) {
  const verified = isRealPersonVerified(person)
  const sessionExpired = Boolean(person && isVerificationExpired(person, session))
  const verificationFailed = Boolean(person && isRealPersonFailed(person))
  const usableLink = safeKycUrl(session?.h5_link)

  return (
    <div className="real-person-flow-content">
      <section className="real-person-guide-copy" aria-labelledby="real-person-verification-title">
        <h2 id="real-person-verification-title">完成真人认证</h2>
        <p>为保障数字形象安全及版权归属，创建形象需完成真人认证</p>
        <div className="real-person-guide-features">
          <GuideFeature
            icon={<SafetyOutlined />}
            title="安全可靠"
            description="认证信息仅用于身份验证，我们将严格保护你的隐私安全"
          />
          <GuideFeature
            icon={<ClockCircleOutlined />}
            title="长期有效"
            description="认证通过后长期有效，无需重复认证"
          />
          <GuideFeature
            icon={<ScanOutlined />}
            title="快速便捷"
            description="通过认证页面完成人脸识别，通常约 1 分钟"
          />
        </div>
        <div className="real-person-service-note">
          <span />
          真人认证服务由火山引擎提供
          <span />
        </div>
      </section>

      <section className="real-person-verify-panel" aria-busy={busy || syncing}>
        <div className="real-person-phone-illustration" aria-hidden="true">
          <MobileOutlined />
          <UserOutlined className="real-person-phone-user" />
          <ScanOutlined className="real-person-phone-scan" />
        </div>

        <div className="real-person-methods">
          {!person ? (
            <>
              <h3>创建真人档案</h3>
              <p>填写形象名称并确认已获得本人授权后开始认证</p>
              <div className="real-person-profile-form">
                <label>
                  <span>形象名称</span>
                  <input
                    type="text"
                    value={name}
                    maxLength={32}
                    placeholder="请输入真人形象名称"
                    disabled={busy}
                    onChange={(event) => onNameChange(event.target.value)}
                  />
                </label>
                <label>
                  <span>形象说明（选填）</span>
                  <textarea
                    value={description}
                    maxLength={200}
                    placeholder="例如：品牌主理人、产品讲解人"
                    disabled={busy}
                    onChange={(event) => onDescriptionChange(event.target.value)}
                  />
                </label>
                <label className="real-person-consent">
                  <input
                    type="checkbox"
                    checked={consentConfirmed}
                    disabled={busy}
                    onChange={(event) => onConsentChange(event.target.checked)}
                  />
                  <span>我确认已取得本人授权，并同意进行真人身份认证</span>
                </label>
                <button
                  type="button"
                  className="real-person-primary-action"
                  disabled={busy || !name.trim() || !consentConfirmed}
                  onClick={onCreate}
                >
                  {busy ? <LoadingOutlined spin /> : <ScanOutlined />} 开始真人认证
                </button>
              </div>
            </>
          ) : verified ? (
            <div className="real-person-inline-success" role="status">
              <CheckCircleFilled />
              <strong>真人认证已通过</strong>
              <span>正在进入素材上传步骤…</span>
            </div>
          ) : sessionExpired || verificationFailed ? (
            <>
              <h3>{sessionExpired ? '认证会话已过期' : '认证未通过'}</h3>
              <p>
                {firstText(person.last_error) ||
                  (sessionExpired ? '认证链接约 30 分钟有效，请重新发起认证' : '请重新发起认证后再继续')}
              </p>
              <button
                type="button"
                className="real-person-primary-action"
                disabled={busy || syncing}
                onClick={onRestart}
              >
                {busy ? <LoadingOutlined spin /> : <ReloadOutlined />} 重新发起认证
              </button>
              <button type="button" className="real-person-sync-action" disabled={syncing || busy} onClick={onSync}>
                {syncing ? <LoadingOutlined spin /> : <ReloadOutlined />} 同步认证状态
              </button>
            </>
          ) : usableLink ? (
            <>
              <h3>认证方式</h3>
              <p>支持以下方式完成真人验证，完成后页面会自动同步</p>
              <a className="real-person-method-card" href={usableLink} target="_blank" rel="noreferrer">
                <span className="real-person-method-visual real-person-method-qr">
                  <LocalQrCode value={usableLink} />
                </span>
                <span className="real-person-method-copy">
                  <strong>扫码认证</strong>
                  <small>使用手机扫描二维码进入认证页面</small>
                </span>
                <span aria-hidden="true">›</span>
              </a>
              <a className="real-person-method-card" href={usableLink} target="_blank" rel="noreferrer">
                <span className="real-person-method-visual real-person-method-face">
                  <ScanOutlined />
                </span>
                <span className="real-person-method-copy">
                  <strong>人脸认证</strong>
                  <small>在新窗口中打开认证页面并完成人脸识别</small>
                </span>
                <span aria-hidden="true">›</span>
              </a>
              <button type="button" className="real-person-sync-action" disabled={syncing || busy} onClick={onSync}>
                {syncing ? <LoadingOutlined spin /> : <ReloadOutlined />}
                我已完成认证，同步状态
              </button>
            </>
          ) : (
            <>
              <h3>需要认证链接</h3>
              <p>认证链接不可用，请重新获取后继续完成真人认证</p>
              <button
                type="button"
                className="real-person-primary-action"
                disabled={busy || syncing}
                onClick={onRestart}
              >
                {busy ? <LoadingOutlined spin /> : <ReloadOutlined />} 重新发起认证
              </button>
              <button type="button" className="real-person-sync-action" disabled={syncing || busy} onClick={onSync}>
                {syncing ? <LoadingOutlined spin /> : <ReloadOutlined />} 同步认证状态
              </button>
            </>
          )}
        </div>

        <div className="real-person-trust-row" aria-label="认证安全说明">
          <span>
            <LockOutlined /> 数据加密传输
          </span>
          <span>
            <SafetyOutlined /> 通过安全认证
          </span>
          <span>
            <LockOutlined /> 隐私保护承诺
          </span>
        </div>
      </section>
    </div>
  )
}

interface UploadStepProps {
  assets: RealPersonAsset[]
  assetUrls: Record<number, string>
  uploading: boolean
  activityText: string
  pendingLocalAsset: PendingLocalAsset | null
  pendingMapping: RealPersonAsset | null
  syncingAssetId: number
  deletingAssetId: number
  onUpload: (file: File) => void
  onRetryBinding: () => void
  onRetryMappingSync: () => void
  onSyncAsset: (asset: RealPersonAsset) => void
  onDeleteAsset: (asset: RealPersonAsset) => void
}

function UploadStep({
  assets,
  assetUrls,
  uploading,
  activityText,
  pendingLocalAsset,
  pendingMapping,
  syncingAssetId,
  deletingAssetId,
  onUpload,
  onRetryBinding,
  onRetryMappingSync,
  onSyncAsset,
  onDeleteAsset,
}: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div className="real-person-flow-content">
      <section className="real-person-guide-copy" aria-labelledby="real-person-upload-title">
        <h2 id="real-person-upload-title">上传照片或视频</h2>
        <p>上传本人清晰正脸素材，系统会将素材与已认证真人档案安全关联</p>
        <div className="real-person-guide-features is-compact">
          <GuideFeature icon={<ScanOutlined />} title="面部清晰" description="确保脸部清晰可见，避免模糊或遮挡" />
          <GuideFeature
            icon={<SafetyOutlined />}
            title="合法授权"
            description="请仅上传本人素材或已取得明确授权的内容"
          />
        </div>

        {assets.length ? (
          <div className="real-person-existing-assets" aria-label="已关联真人素材">
            <strong>已关联素材</strong>
            <div className="real-person-existing-assets-list">
              {assets.map((asset) => {
                const status = getAssetStatus(asset)
                const busy = syncingAssetId === asset.id || deletingAssetId === asset.id
                const isVideo = statusToken(asset.asset_type) === 'video'
                return (
                  <article key={asset.id} className="real-person-existing-asset" aria-busy={busy}>
                    <span className="real-person-existing-asset-preview">
                      <ResilientImage
                        src={!isVideo ? assetUrls[asset.id] || '' : ''}
                        alt={friendlyName(asset.name, '真人素材')}
                        fallback={<VideoCameraOutlined aria-label={isVideo ? '视频素材' : '素材暂无预览'} />}
                      />
                    </span>
                    <span className="real-person-existing-asset-copy">
                      <b title={asset.name}>{friendlyName(asset.name, isVideo ? '真人视频' : '真人照片')}</b>
                      <small className={`is-${status.tone}`}>{status.label}</small>
                    </span>
                    <span className="real-person-existing-asset-actions">
                      {!isRealPersonAssetActive(asset) ? (
                        <button
                          type="button"
                          aria-label={`同步${friendlyName(asset.name, '真人素材')}`}
                          disabled={busy}
                          onClick={() => onSyncAsset(asset)}
                        >
                          <ReloadOutlined /> 同步
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`删除${friendlyName(asset.name, '真人素材')}`}
                        disabled={busy}
                        onClick={() => onDeleteAsset(asset)}
                      >
                        {deletingAssetId === asset.id ? <LoadingOutlined spin /> : <CloseCircleOutlined />} 删除
                      </button>
                    </span>
                  </article>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="real-person-service-note">
          <span />
          素材会保存到当前团队的真人素材档案
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
          <strong>{uploading ? activityText || '正在处理真人素材…' : '点击上传照片或视频'}</strong>
          <small>图片支持 JPG、PNG（≤5MB），视频支持 MP4、MOV（≤100MB）</small>
        </button>
        <input
          ref={inputRef}
          className="real-person-file-input"
          type="file"
          accept="image/jpeg,image/png,video/mp4,video/quicktime"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onUpload(file)
            event.currentTarget.value = ''
          }}
        />

        {!uploading && pendingLocalAsset && !pendingMapping ? (
          <div className="real-person-upload-recovery" role="alert">
            <span>文件已上传，但尚未关联真人档案，不需要重新上传。</span>
            <button type="button" onClick={onRetryBinding}>
              <ReloadOutlined /> 重试关联
            </button>
          </div>
        ) : null}
        {!uploading && pendingMapping && !isRealPersonAssetActive(pendingMapping) ? (
          <div
            className={`real-person-upload-recovery${isRealPersonAssetFailed(pendingMapping) ? ' is-error' : ''}`}
            role={isRealPersonAssetFailed(pendingMapping) ? 'alert' : 'status'}
            aria-live="polite"
          >
            <span>
              {firstText(pendingMapping.last_error) ||
                (isRealPersonAssetFailed(pendingMapping)
                  ? '素材处理失败，请重试同步'
                  : '素材正在处理中，可继续同步状态')}
            </span>
            <button type="button" onClick={onRetryMappingSync}>
              <ReloadOutlined /> 同步素材状态
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function SuccessStep({ personName, onFinish }: { personName: string; onFinish: () => void }) {
  return (
    <section className="real-person-success" aria-labelledby="real-person-success-title">
      <span className="real-person-success-illustration" aria-hidden="true">
        <CheckCircleFilled />
        <InboxOutlined />
      </span>
      <h2 id="real-person-success-title">创建完成</h2>
      <p>“{personName || '真人形象'}”已完成认证并保存到当前团队素材库</p>
      <button type="button" onClick={onFinish}>
        完成
      </button>
    </section>
  )
}

export default function RealPersonLibrary({ workspaceId, userId, query = '' }: RealPersonLibraryProps) {
  const { showToast } = useToast()
  const { requestConfirm } = useConfirmDialog()
  const [people, setPeople] = useState<RealPersonCardRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [restoringFlow, setRestoringFlow] = useState(false)
  const [step, setStep] = useState<FlowStep>(1)
  const [flowMode, setFlowMode] = useState<FlowMode>('create')
  const [profileName, setProfileName] = useState('')
  const [profileDescription, setProfileDescription] = useState('')
  const [consentConfirmed, setConsentConfirmed] = useState(false)
  const [activePerson, setActivePerson] = useState<RealPerson | null>(null)
  const [verificationSession, setVerificationSession] = useState<RealPersonSession | null>(null)
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [syncingKyc, setSyncingKyc] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activityText, setActivityText] = useState('')
  const [pendingLocalAsset, setPendingLocalAsset] = useState<PendingLocalAsset | null>(null)
  const [pendingMapping, setPendingMapping] = useState<RealPersonAsset | null>(null)
  const [personAssetUrls, setPersonAssetUrls] = useState<Record<number, string>>({})
  const [syncingPersonId, setSyncingPersonId] = useState(0)
  const [syncingAssetId, setSyncingAssetId] = useState(0)
  const [deletingPersonId, setDeletingPersonId] = useState(0)
  const [deletingAssetId, setDeletingAssetId] = useState(0)
  const loadSequenceRef = useRef(0)
  const loadAbortRef = useRef<AbortController | null>(null)
  const flowAbortRef = useRef<AbortController | null>(null)
  const cardAbortRef = useRef<AbortController | null>(null)
  const kycSyncInFlightRef = useRef(false)
  const kycPollingDeadlineRef = useRef<{ key: string; deadline: number } | null>(null)
  const flowRootRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const identityScope = `${Math.floor(Number(userId) || 0)}:${Math.floor(Number(workspaceId) || 0)}`
  const identityScopeRef = useRef(identityScope)

  useEffect(() => {
    identityScopeRef.current = identityScope
    return () => {
      if (identityScopeRef.current === identityScope) identityScopeRef.current = ''
    }
  }, [identityScope])

  const beginFlow = useCallback(() => {
    flowAbortRef.current?.abort()
    const controller = new AbortController()
    flowAbortRef.current = controller
    return controller
  }, [])

  const loadPeople = useCallback(async () => {
    const wsId = Math.floor(Number(workspaceId) || 0)
    const sequence = ++loadSequenceRef.current
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    setLoadError('')

    if (!wsId) {
      setPeople([])
      setLoading(false)
      setLoadError('当前团队空间不可用')
      return
    }

    setLoading(true)
    try {
      const response = await listRealPeople({ workspaceId: wsId, signal: controller.signal })
      const normalized = await Promise.all(
        (Array.isArray(response) ? response : []).map((person) => normalizePerson(person, wsId)),
      )
      if (sequence === loadSequenceRef.current && !controller.signal.aborted) {
        setPeople(normalized.filter((person) => person.id > 0).sort((a, b) => b.createdAt - a.createdAt))
      }
    } catch (error: unknown) {
      if (sequence === loadSequenceRef.current && !controller.signal.aborted && !isAbortError(error)) {
        setPeople([])
        setLoadError(getRealPeopleErrorMessage(error, '真人素材加载失败，请稍后重试'))
      }
    } finally {
      if (sequence === loadSequenceRef.current && !controller.signal.aborted) setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadPeople()
    return () => {
      loadSequenceRef.current += 1
      loadAbortRef.current?.abort()
    }
  }, [loadPeople])

  useEffect(
    () => () => {
      flowAbortRef.current?.abort()
      cardAbortRef.current?.abort()
    },
    [],
  )

  const filteredPeople = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return people
    return people.filter((record) => {
      const haystack = [record.name, record.person.description, record.person.status, record.person.provider]
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [people, query])
  const totalPages = Math.max(1, Math.ceil(filteredPeople.length / REAL_PERSON_DISPLAY_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginatedPeople = filteredPeople.slice(
    (safePage - 1) * REAL_PERSON_DISPLAY_PAGE_SIZE,
    safePage * REAL_PERSON_DISPLAY_PAGE_SIZE,
  )

  useEffect(() => {
    setPage(1)
  }, [query, workspaceId])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    if (!activePerson) {
      setPersonAssetUrls({})
      return
    }
    let active = true
    void Promise.all(
      (Array.isArray(activePerson.assets) ? activePerson.assets : []).map(async (asset) => {
        if (!asset.local_asset_id || statusToken(asset.asset_type) === 'video') return [asset.id, ''] as const
        try {
          const url = await getAssetDownloadUrl({ workspaceId, assetId: asset.local_asset_id })
          return [asset.id, firstText(url)] as const
        } catch {
          return [asset.id, ''] as const
        }
      }),
    ).then((entries) => {
      if (active) setPersonAssetUrls(Object.fromEntries(entries))
    })
    return () => {
      active = false
    }
  }, [activePerson, workspaceId])

  const persistFlow = useCallback(
    (
      person: RealPerson | null,
      _session: RealPersonSession | null,
      localAsset: PendingLocalAsset | null,
      mapping: RealPersonAsset | null,
    ) => {
      if (flowMode !== 'create' || !person?.id) return
      writeCreationDraft(workspaceId, userId, {
        personId: person.id,
        ...(localAsset?.assetId ? { localAssetId: localAsset.assetId, localAssetName: localAsset.name } : {}),
        ...(mapping?.id ? { mappingId: mapping.id } : {}),
      })
    },
    [flowMode, userId, workspaceId],
  )

  const openNewFlow = useCallback(async () => {
    if (loading || uploading || !workspaceId) return
    const controller = beginFlow()
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFlowMode('create')
    setCreating(true)
    setRestoringFlow(true)
    setStep(1)
    setProfileName('')
    setProfileDescription('')
    setConsentConfirmed(false)
    setActivePerson(null)
    setVerificationSession(null)
    setPendingLocalAsset(null)
    setPendingMapping(null)

    const stored = readCreationDraft(workspaceId, userId)
    if (!stored?.personId) {
      setRestoringFlow(false)
      return
    }

    try {
      const person = await getRealPerson({
        workspaceId,
        personId: stored.personId,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setActivePerson(person)
      setProfileName(person.name || '')
      setProfileDescription(person.description || '')
      setConsentConfirmed(Boolean(person.consent_confirmed_at))
      if (stored.localAssetId) {
        setPendingLocalAsset({ assetId: stored.localAssetId, name: stored.localAssetName || '真人素材' })
      }
      const mapping = Array.isArray(person.assets)
        ? person.assets.find(
            (asset) =>
              (stored.mappingId && asset.id === stored.mappingId) ||
              (stored.localAssetId && Number(asset.local_asset_id) === stored.localAssetId),
          ) || null
        : null
      setPendingMapping(mapping)
      if (isRealPersonVerified(person)) {
        setStep(mapping && isRealPersonAssetActive(mapping) ? 3 : 2)
      } else {
        setStep(1)
      }
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        writeCreationDraft(workspaceId, userId, null)
        showToast(getRealPeopleErrorMessage(error, '未能恢复上次创建进度，请重新创建'), 'error')
      }
    } finally {
      if (!controller.signal.aborted) setRestoringFlow(false)
    }
  }, [beginFlow, loading, showToast, uploading, userId, workspaceId])

  const openPersonFlow = useCallback(
    async (record: RealPersonCardRecord) => {
      const controller = beginFlow()
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setFlowMode('manage')
      setCreating(true)
      setRestoringFlow(true)
      setStep(isRealPersonVerified(record.person) ? 2 : 1)
      setActivePerson(record.person)
      setProfileName(record.person.name || '')
      setProfileDescription(record.person.description || '')
      setConsentConfirmed(Boolean(record.person.consent_confirmed_at))
      setVerificationSession(null)
      setPendingLocalAsset(null)
      setPendingMapping(null)
      try {
        const detail = await getRealPerson({
          workspaceId,
          personId: record.id,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setActivePerson(detail)
        setStep(isRealPersonVerified(detail) ? 2 : 1)
      } catch (error: unknown) {
        if (!isAbortError(error)) {
          showToast(getRealPeopleErrorMessage(error, '真人档案详情加载失败'), 'error')
        }
      } finally {
        if (!controller.signal.aborted) setRestoringFlow(false)
      }
    },
    [beginFlow, showToast, workspaceId],
  )

  const leaveCreating = useCallback(() => {
    if (uploading || creatingProfile || syncingKyc || syncingAssetId || deletingAssetId) return
    flowAbortRef.current?.abort()
    flowAbortRef.current = null
    if (flowMode === 'create' && step === 3) {
      writeCreationDraft(workspaceId, userId, null)
    }
    setCreating(false)
    setRestoringFlow(false)
    setStep(1)
    setVerificationSession(null)
    setPendingLocalAsset(null)
    setPendingMapping(null)
    setActivityText('')
    window.setTimeout(() => previousFocusRef.current?.focus(), 0)
    void loadPeople()
  }, [
    creatingProfile,
    deletingAssetId,
    flowMode,
    loadPeople,
    step,
    syncingAssetId,
    syncingKyc,
    uploading,
    userId,
    workspaceId,
  ])

  useEffect(() => {
    if (!creating) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      flowRootRef.current?.querySelector<HTMLElement>('.real-person-flow-exit')?.focus()
    }, 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      leaveCreating()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [creating, leaveCreating])

  const finishCreating = useCallback(() => {
    writeCreationDraft(workspaceId, userId, null)
    leaveCreating()
  }, [leaveCreating, userId, workspaceId])

  const handleCreateProfile = useCallback(async () => {
    const name = profileName.trim()
    if (!name || !consentConfirmed || creatingProfile) return
    const signal = flowAbortRef.current?.signal
    const existingPersonIds = new Set(people.map((record) => record.id))
    setCreatingProfile(true)
    try {
      const session = await createRealPerson({
        workspaceId,
        name,
        consentConfirmed: true,
        description: profileDescription.trim() || undefined,
        signal,
      })
      kycPollingDeadlineRef.current = null
      setActivePerson(session.person)
      setVerificationSession(session)
      persistFlow(session.person, session, null, null)
      showToast('真人档案已创建，请完成真人认证', 'success')
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        let recoveredPerson: RealPerson | null = null
        try {
          const latestPeople = await listRealPeople({ workspaceId, signal })
          recoveredPerson =
            latestPeople.find(
              (person) => !existingPersonIds.has(person.id) && firstText(person.name).trim() === name,
            ) || null
        } catch {
          recoveredPerson = null
        }
        if (recoveredPerson) {
          setActivePerson(recoveredPerson)
          setVerificationSession(null)
          persistFlow(recoveredPerson, null, null, null)
          showToast('真人档案已创建，请重新获取认证链接后继续', 'info')
        } else {
          showToast(getRealPeopleErrorMessage(error, '真人档案创建失败，请稍后重试'), 'error')
        }
      }
    } finally {
      if (!signal?.aborted) setCreatingProfile(false)
    }
  }, [consentConfirmed, creatingProfile, people, persistFlow, profileDescription, profileName, showToast, workspaceId])

  const handleRestartVerification = useCallback(async () => {
    if (!activePerson?.id || creatingProfile || syncingKyc) return
    const signal = flowAbortRef.current?.signal
    setCreatingProfile(true)
    try {
      const session = await restartRealPersonVerification({
        workspaceId,
        personId: activePerson.id,
        signal,
      })
      kycPollingDeadlineRef.current = null
      setActivePerson(session.person)
      setVerificationSession(session)
      persistFlow(session.person, session, pendingLocalAsset, pendingMapping)
      showToast('已生成新的认证链接', 'success')
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        showToast(getRealPeopleErrorMessage(error, '重新发起认证失败，请稍后重试'), 'error')
      }
    } finally {
      if (!signal?.aborted) setCreatingProfile(false)
    }
  }, [
    activePerson,
    creatingProfile,
    pendingLocalAsset,
    pendingMapping,
    persistFlow,
    showToast,
    syncingKyc,
    workspaceId,
  ])

  const synchronizeKyc = useCallback(
    async (personId: number, feedback: boolean) => {
      if (!personId || kycSyncInFlightRef.current) return
      const signal = flowAbortRef.current?.signal
      kycSyncInFlightRef.current = true
      setSyncingKyc(true)
      try {
        const person = await syncRealPerson({ workspaceId, personId, signal })
        setActivePerson(person)
        if (isRealPersonVerified(person)) {
          setStep(2)
          setVerificationSession(null)
          persistFlow(person, null, pendingLocalAsset, pendingMapping)
          if (feedback) showToast('真人认证已通过，可以上传素材', 'success')
          void loadPeople()
        } else {
          persistFlow(person, verificationSession, pendingLocalAsset, pendingMapping)
          if (feedback) {
            showToast(
              firstText(person.last_error) ||
                (isVerificationExpired(person, verificationSession)
                  ? '认证会话已过期，请重新发起认证'
                  : '认证结果尚未返回，请稍后再同步'),
              isRealPersonFailed(person) || isVerificationExpired(person, verificationSession) ? 'error' : 'info',
            )
          }
        }
      } catch (error: unknown) {
        if (feedback && !isAbortError(error)) {
          showToast(getRealPeopleErrorMessage(error, '认证状态同步失败，请稍后重试'), 'error')
        }
      } finally {
        kycSyncInFlightRef.current = false
        if (!signal?.aborted) setSyncingKyc(false)
      }
    },
    [loadPeople, pendingLocalAsset, pendingMapping, persistFlow, showToast, verificationSession, workspaceId],
  )

  useEffect(() => {
    if (
      !creating ||
      step !== 1 ||
      !activePerson?.id ||
      isRealPersonVerified(activePerson) ||
      isRealPersonFailed(activePerson) ||
      isVerificationExpired(activePerson, verificationSession) ||
      !safeKycUrl(verificationSession?.h5_link)
    ) {
      kycPollingDeadlineRef.current = null
      return
    }
    const personId = activePerson.id
    const serverDeadline = toTimestamp(verificationSession?.expires_at || activePerson.verification_expires_at)
    const sessionKey = `${personId}:${firstText(verificationSession?.h5_link)}:${serverDeadline}`
    const now = Date.now()
    if (kycPollingDeadlineRef.current?.key !== sessionKey) {
      kycPollingDeadlineRef.current = {
        key: sessionKey,
        deadline:
          serverDeadline > now
            ? Math.min(serverDeadline, now + KYC_SYNC_MAX_DURATION_MS)
            : now + KYC_SYNC_MAX_DURATION_MS,
      }
    }
    const pollDeadline = kycPollingDeadlineRef.current.deadline
    const syncSilently = () => {
      if (document.visibilityState !== 'visible' || Date.now() >= pollDeadline) return
      void synchronizeKyc(personId, false)
    }
    const timer = window.setInterval(syncSilently, KYC_SYNC_INTERVAL_MS)
    const deadlineTimer = window.setTimeout(() => window.clearInterval(timer), Math.max(0, pollDeadline - Date.now()))
    window.addEventListener('focus', syncSilently)
    document.addEventListener('visibilitychange', syncSilently)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(deadlineTimer)
      window.removeEventListener('focus', syncSilently)
      document.removeEventListener('visibilitychange', syncSilently)
    }
  }, [activePerson, creating, step, synchronizeKyc, verificationSession])

  const completeAssetFlow = useCallback(
    async (mapping: RealPersonAsset) => {
      if (!activePerson?.id) return
      const signal = flowAbortRef.current?.signal
      const detail = await getRealPerson({
        workspaceId,
        personId: activePerson.id,
        signal,
      })
      setActivePerson(detail)
      const serverMapping =
        (detail.assets || []).find(
          (asset) =>
            asset.id === mapping.id ||
            (mapping.local_asset_id && Number(asset.local_asset_id) === Number(mapping.local_asset_id)),
        ) || null
      setPendingMapping(serverMapping || mapping)
      persistFlow(detail, null, pendingLocalAsset, serverMapping || mapping)
      if (!serverMapping || !isRealPersonAssetActive(serverMapping)) {
        setStep(2)
        showToast('服务端仍在处理真人素材，请稍后继续同步', 'info')
        return
      }
      setStep(3)
      setActivityText('')
      showToast('真人素材已创建完成', 'success')
      void loadPeople()
    },
    [activePerson, loadPeople, pendingLocalAsset, persistFlow, showToast, workspaceId],
  )

  const synchronizeMappingUntilReady = useCallback(
    async (initialMapping: RealPersonAsset): Promise<RealPersonAsset> => {
      if (!activePerson?.id) return initialMapping
      const signal = flowAbortRef.current?.signal
      let mapping = initialMapping
      setPendingMapping(mapping)
      if (isRealPersonAssetActive(mapping) || isRealPersonAssetFailed(mapping)) return mapping

      for (let attempt = 0; attempt < ASSET_SYNC_ATTEMPTS; attempt += 1) {
        setActivityText(`正在同步真人素材状态（${attempt + 1}/${ASSET_SYNC_ATTEMPTS}）…`)
        if (attempt > 0) await wait(ASSET_SYNC_INTERVAL_MS, signal)
        mapping = await syncRealPersonAsset({
          workspaceId,
          personId: activePerson.id,
          assetId: mapping.id,
          signal,
        })
        setPendingMapping(mapping)
        persistFlow(activePerson, null, pendingLocalAsset, mapping)
        if (isRealPersonAssetActive(mapping) || isRealPersonAssetFailed(mapping)) break
      }
      return mapping
    },
    [activePerson, pendingLocalAsset, persistFlow, workspaceId],
  )

  const bindUploadedAsset = useCallback(
    async (localAsset: PendingLocalAsset) => {
      if (!activePerson?.id) throw new Error('真人档案不可用，请重新进入创建流程')
      const signal = flowAbortRef.current?.signal
      setActivityText('正在关联真人档案…')
      let mapping: RealPersonAsset | null = null
      try {
        mapping = await addRealPersonAsset({
          workspaceId,
          personId: activePerson.id,
          assetId: localAsset.assetId,
          name: localAsset.name,
          signal,
        })
      } catch (error: unknown) {
        // 创建映射的响应可能丢失；短暂轮询服务端真相，避免最终一致期间重复绑定。
        for (let attempt = 0; attempt < BIND_RECOVERY_ATTEMPTS && !mapping; attempt += 1) {
          if (attempt > 0) await wait(BIND_RECOVERY_INTERVAL_MS, signal)
          try {
            const detail = await getRealPerson({
              workspaceId,
              personId: activePerson.id,
              signal,
            })
            setActivePerson(detail)
            mapping =
              (Array.isArray(detail.assets)
                ? detail.assets.find((asset) => Number(asset.local_asset_id) === localAsset.assetId)
                : null) || null
          } catch {
            mapping = null
          }
        }
        if (!mapping) throw error
      }

      setPendingMapping(mapping)
      persistFlow(activePerson, null, localAsset, mapping)
      const latest = await synchronizeMappingUntilReady(mapping)
      if (isRealPersonAssetActive(latest)) {
        await completeAssetFlow(latest)
      } else if (isRealPersonAssetFailed(latest)) {
        throw new Error(firstText(latest.last_error) || '真人素材处理失败，请重试同步')
      } else {
        showToast('真人素材仍在处理中，可点击“同步素材状态”继续查询', 'info')
      }
    },
    [activePerson, completeAssetFlow, persistFlow, showToast, synchronizeMappingUntilReady, workspaceId],
  )

  const handleUpload = useCallback(
    async (file: File) => {
      if (uploading || !activePerson?.id) return
      const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || ''
      const isImage = ['image/jpeg', 'image/png'].includes(file.type) || ['.jpg', '.jpeg', '.png'].includes(extension)
      const isVideo = ['video/mp4', 'video/quicktime'].includes(file.type) || ['.mp4', '.mov'].includes(extension)
      if (!isImage && !isVideo) {
        showToast('仅支持 JPG、PNG、MP4、MOV 格式的素材', 'error')
        return
      }
      if (isImage && file.size > FIVE_MB) {
        showToast('照片大小不能超过 5MB', 'error')
        return
      }
      if (isVideo && file.size > ONE_HUNDRED_MB) {
        showToast('视频大小不能超过 100MB', 'error')
        return
      }

      const signal = flowAbortRef.current?.signal
      setUploading(true)
      setActivityText('正在上传并保存素材…')
      try {
        const result = (await uploadAssetFile({
          workspaceId,
          file,
          source: REAL_PERSON_ASSET_SOURCE,
          prompt: activePerson.name || '真人形象',
          signal,
        })) as { asset?: { id?: number } }
        const localAssetId = Number(result?.asset?.id || 0)
        if (!localAssetId) throw new Error('服务端未返回有效的本地素材 ID')
        const localAsset = { assetId: localAssetId, name: friendlyName(file.name) }
        setPendingLocalAsset(localAsset)
        setPendingMapping(null)
        persistFlow(activePerson, null, localAsset, null)
        await bindUploadedAsset(localAsset)
      } catch (error: unknown) {
        if (!isAbortError(error)) {
          showToast(getRealPeopleErrorMessage(error, '真人素材上传或关联失败，请重试'), 'error')
        }
      } finally {
        if (!signal?.aborted) {
          setUploading(false)
          setActivityText('')
        }
      }
    },
    [activePerson, bindUploadedAsset, persistFlow, showToast, uploading, workspaceId],
  )

  const retryBinding = useCallback(async () => {
    if (!pendingLocalAsset || uploading) return
    setUploading(true)
    try {
      await bindUploadedAsset(pendingLocalAsset)
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        showToast(getRealPeopleErrorMessage(error, '真人素材关联失败，请稍后重试'), 'error')
      }
    } finally {
      setUploading(false)
      setActivityText('')
    }
  }, [bindUploadedAsset, pendingLocalAsset, showToast, uploading])

  const syncOneAsset = useCallback(
    async (asset: RealPersonAsset, completeWhenReady = false) => {
      if (!activePerson?.id || syncingAssetId) return
      const signal = flowAbortRef.current?.signal
      setSyncingAssetId(asset.id)
      try {
        const latest = await syncRealPersonAsset({
          workspaceId,
          personId: activePerson.id,
          assetId: asset.id,
          signal,
        })
        setPendingMapping((current) => (current?.id === latest.id ? latest : current))
        setActivePerson((current) =>
          current
            ? {
                ...current,
                assets: (current.assets || []).map((item) => (item.id === latest.id ? latest : item)),
              }
            : current,
        )
        if (isRealPersonAssetActive(latest)) {
          if (completeWhenReady) await completeAssetFlow(latest)
          else {
            showToast('素材状态已同步为可用', 'success')
            void loadPeople()
          }
        } else {
          showToast(
            firstText(latest.last_error) || '素材仍在处理中，请稍后再同步',
            isRealPersonAssetFailed(latest) ? 'error' : 'info',
          )
        }
      } catch (error: unknown) {
        if (!isAbortError(error)) {
          showToast(getRealPeopleErrorMessage(error, '素材状态同步失败，请稍后重试'), 'error')
        }
      } finally {
        if (!signal?.aborted) setSyncingAssetId(0)
      }
    },
    [activePerson, completeAssetFlow, loadPeople, showToast, syncingAssetId, workspaceId],
  )

  const removeOneAsset = useCallback(
    async (asset: RealPersonAsset) => {
      if (!activePerson?.id || deletingAssetId) return
      const confirmed = await requestConfirm(`确定删除“${friendlyName(asset.name, '该真人素材')}”吗？`, {
        title: '删除真人素材',
        confirmLabel: '删除',
        danger: true,
      })
      if (!confirmed) return
      const signal = flowAbortRef.current?.signal
      setDeletingAssetId(asset.id)
      try {
        await deleteRealPersonAsset({
          workspaceId,
          personId: activePerson.id,
          assetId: asset.id,
          signal,
        })
        const nextMapping = pendingMapping?.id === asset.id ? null : pendingMapping
        const nextLocalAsset =
          pendingLocalAsset?.assetId === Number(asset.local_asset_id || 0) ? null : pendingLocalAsset
        const optimisticDetail = {
          ...activePerson,
          assets: (activePerson.assets || []).filter((item) => item.id !== asset.id),
        }
        setActivePerson(optimisticDetail)
        setPendingMapping(nextMapping)
        setPendingLocalAsset(nextLocalAsset)
        persistFlow(optimisticDetail, null, nextLocalAsset, nextMapping)
        showToast('真人素材已删除，素材中心原始文件不受影响', 'success')
        void loadPeople()
        try {
          const detail = await getRealPerson({
            workspaceId,
            personId: activePerson.id,
            signal,
          })
          setActivePerson(detail)
          persistFlow(detail, null, nextLocalAsset, nextMapping)
        } catch {
          // DELETE 已成功；详情回读失败不应把已完成的删除误报为失败。
        }
      } catch (error: unknown) {
        if (!isAbortError(error)) {
          showToast(getRealPeopleErrorMessage(error, '真人素材删除失败，请稍后重试'), 'error')
        }
      } finally {
        if (!signal?.aborted) setDeletingAssetId(0)
      }
    },
    [
      activePerson,
      deletingAssetId,
      loadPeople,
      pendingLocalAsset,
      pendingMapping,
      persistFlow,
      requestConfirm,
      showToast,
      workspaceId,
    ],
  )

  const synchronizeCardPerson = useCallback(
    async (record: RealPersonCardRecord) => {
      if (syncingPersonId) return
      cardAbortRef.current?.abort()
      const controller = new AbortController()
      cardAbortRef.current = controller
      setSyncingPersonId(record.id)
      try {
        await syncRealPerson({ workspaceId, personId: record.id, signal: controller.signal })
        if (controller.signal.aborted) return
        showToast('真人认证状态已同步', 'success')
        await loadPeople()
      } catch (error: unknown) {
        if (!isAbortError(error)) showToast(getRealPeopleErrorMessage(error, '真人认证状态同步失败'), 'error')
      } finally {
        if (!controller.signal.aborted) setSyncingPersonId(0)
      }
    },
    [loadPeople, showToast, syncingPersonId, workspaceId],
  )

  const removePerson = useCallback(
    async (record: RealPersonCardRecord) => {
      if (deletingPersonId) return
      const requestScope = identityScope
      const confirmed = await requestConfirm(`确定删除“${record.name}”吗？该档案下的真人素材将同时删除。`, {
        title: '删除真人档案',
        confirmLabel: '删除',
        danger: true,
      })
      if (!confirmed || identityScopeRef.current !== requestScope) return

      cardAbortRef.current?.abort()
      const controller = new AbortController()
      cardAbortRef.current = controller
      setDeletingPersonId(record.id)
      try {
        await deleteRealPerson({ workspaceId, personId: record.id, signal: controller.signal })
        if (controller.signal.aborted) return
        const stored = readCreationDraft(workspaceId, userId)
        if (stored?.personId === record.id) writeCreationDraft(workspaceId, userId, null)
        showToast('真人档案已删除', 'success')
        await loadPeople()
      } catch (error: unknown) {
        if (!isAbortError(error)) {
          showToast(getRealPeopleErrorMessage(error, '真人档案删除失败，请稍后重试'), 'error')
        }
      } finally {
        if (!controller.signal.aborted) setDeletingPersonId(0)
      }
    },
    [deletingPersonId, identityScope, loadPeople, requestConfirm, showToast, userId, workspaceId],
  )

  if (creating) {
    return (
      <div
        ref={flowRootRef}
        className="real-person-flow"
        role="dialog"
        aria-modal="true"
        aria-label="创建或管理真人形象"
      >
        <button
          type="button"
          className="real-person-flow-exit"
          disabled={uploading || creatingProfile || syncingKyc || Boolean(syncingAssetId)}
          onClick={leaveCreating}
        >
          返回真人素材库
        </button>
        <CreationSteps step={step} />
        {restoringFlow ? (
          <p className="real-person-flow-loading" role="status">
            <LoadingOutlined spin /> 正在恢复真人档案…
          </p>
        ) : step === 1 ? (
          <VerificationStep
            person={activePerson}
            session={verificationSession}
            name={profileName}
            description={profileDescription}
            consentConfirmed={consentConfirmed}
            busy={creatingProfile}
            syncing={syncingKyc}
            onNameChange={setProfileName}
            onDescriptionChange={setProfileDescription}
            onConsentChange={setConsentConfirmed}
            onCreate={() => void handleCreateProfile()}
            onRestart={() => void handleRestartVerification()}
            onSync={() => void synchronizeKyc(activePerson?.id || 0, true)}
          />
        ) : step === 2 ? (
          <UploadStep
            assets={activePerson?.assets || []}
            assetUrls={personAssetUrls}
            uploading={uploading}
            activityText={activityText}
            pendingLocalAsset={pendingLocalAsset}
            pendingMapping={pendingMapping}
            syncingAssetId={syncingAssetId}
            deletingAssetId={deletingAssetId}
            onUpload={(file) => void handleUpload(file)}
            onRetryBinding={() => void retryBinding()}
            onRetryMappingSync={() => {
              if (pendingMapping) void syncOneAsset(pendingMapping, true)
            }}
            onSyncAsset={(asset) => void syncOneAsset(asset)}
            onDeleteAsset={(asset) => void removeOneAsset(asset)}
          />
        ) : (
          <SuccessStep personName={activePerson?.name || profileName} onFinish={finishCreating} />
        )}
      </div>
    )
  }

  return (
    <section className="real-person-library" aria-label="真人素材库" aria-busy={loading}>
      <div className="real-person-grid">
        {paginatedPeople.map((record) => {
          const status = getPersonStatus(record.person)
          const deleting = deletingPersonId === record.id
          const syncing = syncingPersonId === record.id
          const menuItems: MenuProps['items'] = [
            {
              key: 'manage',
              label: isRealPersonVerified(record.person) ? '管理素材' : '继续创建',
              disabled: deleting || syncing,
            },
            {
              key: 'sync',
              label: syncing ? '同步中…' : '同步状态',
              disabled: deleting || syncing,
            },
            {
              type: 'divider',
            },
            {
              key: 'delete',
              label: deleting ? '删除中…' : '删除形象',
              danger: true,
              disabled: deleting || syncing,
            },
          ]

          return (
            <article key={record.id} className="real-person-card" aria-busy={deleting || syncing}>
              <button
                type="button"
                className="real-person-card-image"
                aria-label={`${isRealPersonVerified(record.person) ? '管理' : '继续创建'}${record.name}`}
                onClick={() => void openPersonFlow(record)}
              >
                <ResilientImage
                  src={record.imageUrl}
                  alt={record.name}
                  fallback={
                    <span className="real-person-card-placeholder">
                      {syncing ? <LoadingOutlined spin /> : <UserOutlined />}
                      <small>{status.label}</small>
                    </span>
                  }
                />
                {status.tone !== 'ready' ? (
                  <span className={`real-person-card-status is-${status.tone}`}>{status.label}</span>
                ) : null}
              </button>
              <div className="real-person-card-footer">
                <strong title={record.name}>{record.name}</strong>
                <Dropdown
                  disabled={deleting || syncing}
                  trigger={['click']}
                  placement="bottomRight"
                  overlayClassName="real-person-card-menu"
                  align={{ offset: [0, 12] }}
                  menu={{
                    items: menuItems,
                    onClick: ({ key }) => {
                      if (key === 'manage') void openPersonFlow(record)
                      if (key === 'sync') void synchronizeCardPerson(record)
                      if (key === 'delete') void removePerson(record)
                    },
                  }}
                >
                  <button
                    type="button"
                    disabled={deleting || syncing}
                    aria-label={`${record.name}的更多操作`}
                    aria-haspopup="menu"
                  >
                    {deleting || syncing ? (
                      <LoadingOutlined spin />
                    ) : (
                      <img src={realPersonMoreIcon} alt="" aria-hidden="true" />
                    )}
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
          onClick={() => void openNewFlow()}
        >
          <img className="real-person-create-icon" src={realPersonPlusIcon} alt="" aria-hidden="true" />
          <strong>创建新形象</strong>
          <span>完成真人认证后上传素材</span>
        </button>

        {loading ? (
          <p className="real-person-state" role="status">
            <LoadingOutlined spin /> 正在加载真人素材…
          </p>
        ) : loadError ? (
          <div className="real-person-state is-error" role="alert">
            <span>{loadError}</span>
            <button type="button" onClick={() => void loadPeople()}>
              重新加载
            </button>
          </div>
        ) : !filteredPeople.length ? (
          <p className="real-person-no-result">
            {query.trim() ? '未找到匹配的真人形象' : '暂无真人形象，完成认证并上传素材后会显示在这里'}
          </p>
        ) : null}
      </div>

      {filteredPeople.length > REAL_PERSON_DISPLAY_PAGE_SIZE ? (
        <div className="real-person-pagination" aria-label="真人素材分页">
          <Pagination
            current={safePage}
            pageSize={REAL_PERSON_DISPLAY_PAGE_SIZE}
            total={filteredPeople.length}
            showSizeChanger={false}
            showLessItems
            onChange={setPage}
          />
        </div>
      ) : null}
    </section>
  )
}
