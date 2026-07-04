/*
  WorkbenchView — 工作台首页
  展示当前工作空间概览：项目卡片列表、团队信息、快速入口（创建项目/加入团队等）。
*/
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '@/styles/creative.css'
import '@/styles/workbench.css'
import AppLayout from '@/components/layout/AppLayout'
import AppToast from '@/components/AppToast'
import { useAuth } from '@/auth/AuthContext'
import { getAssetDownloadUrl, getCreativeProject, listCreativeProjects } from '@/api/business'
import { useToast } from '@/composables/useToast'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { resolveProjectPath } from '@/utils/projectRoute'
import library1 from '@/assets/creative/library-1.png'
import library2 from '@/assets/creative/library-2.png'
import library3 from '@/assets/creative/library-3.png'

function formatNumber(value: any): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '')
  return Math.floor(n).toLocaleString('en-US')
}

function formatPercent(value: any, digits = 1): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return `${n.toFixed(digits)}%`
}

function resolveDeltaMeta(delta: any): { text: string; className: string } {
  const n = Number(delta)
  if (!Number.isFinite(n) || n === 0) return { text: '', className: '' }
  const isUp = n > 0
  const arrow = isUp ? '↑' : '↓'
  const className = isUp ? 'up' : 'down'
  return { text: `${arrow}${Math.abs(n).toFixed(0)}%`, className }
}

function getProjectTimestamp(project: any): number {
  const raw =
    project?.updated_at ||
    project?.updatedAt ||
    project?.last_saved_at ||
    project?.created_at ||
    project?.createdAt ||
    ''
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function formatRelativeTime(value: any): string {
  const timestamp = Date.parse(value || '')
  if (!Number.isFinite(timestamp)) return '最近更新'
  const diff = Date.now() - timestamp
  if (diff < 60 * 1000) return '刚刚更新'
  if (diff < 60 * 60 * 1000) return `更新于${Math.floor(diff / (60 * 1000))}分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `更新于${Math.floor(diff / (60 * 60 * 1000))}小时前`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `更新于${Math.floor(diff / (24 * 60 * 60 * 1000))}天前`
  const date = new Date(timestamp)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `更新于${y}/${m}/${d}`
}

function resolveProjectStatusMeta(project: any): { key: string; label: string } | null {
  const raw = String(project?.status || '')
    .trim()
    .toLowerCase()
  if (['processing', 'submitting', 'queued', 'pending', 'running', 'draft'].includes(raw)) {
    return { key: 'processing', label: '进行中' }
  }
  if (['done', 'completed', 'success', 'finished'].includes(raw)) {
    return { key: 'done', label: '已完成' }
  }
  return null
}

function toPlainObject(value: any): any {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return null
}

function normalizeCreativeProjectDraft(payload: any): any {
  const candidates = [
    payload?.draft_json,
    payload?.draftJson,
    payload?.draft,
    payload?.data?.draft_json,
    payload?.data?.draft,
  ]
  for (const item of candidates) {
    const parsed = toPlainObject(item)
    if (parsed) return parsed
  }
  return null
}

function pickFirstString(obj: any, keys: string[]): string {
  for (const key of keys) {
    const value = obj?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function resolveAssetId(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function normalizeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function resolveImageCandidate(value: any): { url: string; assetId: number } {
  if (typeof value === 'string') {
    const url = value.trim()
    return { url, assetId: 0 }
  }
  if (!value || typeof value !== 'object') {
    return { url: '', assetId: 0 }
  }
  return {
    url: pickFirstString(value, [
      'src',
      'url',
      'imageUrl',
      'image_url',
      'thumbnailUrl',
      'thumbnail_url',
      'previewUrl',
      'preview_url',
      'coverUrl',
      'cover_url',
    ]),
    assetId: resolveAssetId(value?.assetId || value?.asset_id),
  }
}

function hasImageCandidate(value: any): boolean {
  const candidate = resolveImageCandidate(value)
  return Boolean(candidate.url || candidate.assetId)
}

function resolveStoryboardVisualCandidate(storyboard: any): { url: string; assetId: number } {
  const currentImage = resolveImageCandidate(storyboard?.currentImage || storyboard?.current_image)
  if (currentImage.url || currentImage.assetId) return currentImage

  const versionHistory = normalizeArray(storyboard?.versionHistory || storyboard?.version_history)
  const currentIndex = Number(storyboard?.currentVersionIndex ?? storyboard?.current_version_index)
  if (versionHistory.length && Number.isFinite(currentIndex)) {
    const safeIndex = Math.max(0, Math.min(Math.floor(currentIndex), versionHistory.length - 1))
    const currentVersion = resolveImageCandidate(versionHistory[safeIndex])
    if (currentVersion.url || currentVersion.assetId) return currentVersion
  }

  for (const version of versionHistory) {
    const candidate = resolveImageCandidate(version)
    if (candidate.url || candidate.assetId) return candidate
  }

  const direct = resolveImageCandidate(storyboard)
  if (direct.url || direct.assetId) return direct

  const historyImages = normalizeArray(storyboard?.historyImages || storyboard?.history_images)
  for (const image of historyImages) {
    const candidate = resolveImageCandidate(image)
    if (candidate.url || candidate.assetId) return candidate
  }

  return { url: '', assetId: 0 }
}

function getDraftStoryboardItems(draft: any): any[] {
  if (Array.isArray(draft?.storyboardItems)) return draft.storyboardItems
  if (Array.isArray(draft?.storyboard_items)) return draft.storyboard_items
  return []
}

function getDraftStoryboards(draft: any): any[] {
  if (Array.isArray(draft?.storyboards)) return draft.storyboards
  if (Array.isArray(draft?.storyboard_list)) return draft.storyboard_list
  return []
}

function countGeneratedStoryboardImages(draft: any): number {
  const storyboardItems = getDraftStoryboardItems(draft)
  if (storyboardItems.length) {
    return storyboardItems.filter(
      (item) => hasImageCandidate(item) || hasImageCandidate(item?.currentImage || item?.current_image),
    ).length
  }

  const storyboards = getDraftStoryboards(draft)
  return storyboards.filter((storyboard) => hasImageCandidate(resolveStoryboardVisualCandidate(storyboard))).length
}

function resolveCoverCandidateFromDraft(draft: any): { url: string; assetId: number } {
  const explicitProjectCover = draft?.projectCover || draft?.project_cover || draft?.cover || null
  if (explicitProjectCover && typeof explicitProjectCover === 'object') {
    const candidate = resolveImageCandidate(explicitProjectCover)
    if (candidate.url || candidate.assetId) return candidate
  }

  const storyboardItems = getDraftStoryboardItems(draft)
  const storyboardCandidate = storyboardItems.find((item) => {
    const candidate = resolveStoryboardVisualCandidate(item)
    return Boolean(candidate.url || candidate.assetId)
  })
  if (storyboardCandidate) {
    return resolveStoryboardVisualCandidate(storyboardCandidate)
  }

  const storyboards = getDraftStoryboards(draft)
  const firstStoryboard = storyboards.find((storyboard) => {
    const candidate = resolveStoryboardVisualCandidate(storyboard)
    return Boolean(candidate.url || candidate.assetId)
  })
  if (firstStoryboard) {
    return resolveStoryboardVisualCandidate(firstStoryboard)
  }

  const selectedMaterials = Array.isArray(draft?.selectedMaterials)
    ? draft.selectedMaterials
    : Array.isArray(draft?.selected_materials)
      ? draft.selected_materials
      : []
  const materialCandidate = selectedMaterials.find((material: any) => {
    if (!material) return false
    const type = String(material?.type || '')
      .trim()
      .toLowerCase()
    const mimeType = String(material?.mimeType || material?.mime_type || '')
      .trim()
      .toLowerCase()
    const assetId = resolveAssetId(material?.assetId || material?.asset_id)
    const url = pickFirstString(material, [
      'thumbnailUrl',
      'thumbnail_url',
      'previewUrl',
      'preview_url',
      'url',
      'src',
      'coverUrl',
      'cover_url',
    ])
    if (url) return true
    if (!assetId) return false
    if (!type && !mimeType) return true
    if (type === 'image') return true
    if (mimeType.startsWith('image/')) return true
    return false
  })
  if (materialCandidate) {
    const url = pickFirstString(materialCandidate, [
      'thumbnailUrl',
      'thumbnail_url',
      'previewUrl',
      'preview_url',
      'url',
      'src',
      'coverUrl',
      'cover_url',
    ])
    const assetId = resolveAssetId(materialCandidate?.assetId || materialCandidate?.asset_id)
    return { url, assetId }
  }

  // 降级到生成好的视频（视频首帧可作为封面）
  const videoUrl = draft?.generatedVideoUrl || draft?.generated_video_url || ''
  const videoAssetId = Number(draft?.generatedVideoAssetId || draft?.generated_video_asset_id || 0) || 0
  if (videoUrl || videoAssetId) {
    return { url: videoUrl, assetId: videoAssetId }
  }

  return { url: '', assetId: 0 }
}

interface AdRow {
  id: number
  name: string
  thumb: string
  exposure: number
  exposureDelta: number
  ctr: number
  ctrDelta: number
  cvr: number
  cvrDelta: number
  roi: number
  roiDelta: number
}

const DATA_TABS = ['千川经营', '巨量广告', '本地推']

export default function WorkbenchView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { authSession, handleLogoutSuccess } = useAuth()
  const workspaceId = useWorkspaceId()

  const [activeDataTab, setActiveDataTab] = useState<string>(DATA_TABS[0])
  const [sortMode, setSortMode] = useState<string>('exposure')

  const [recentProjectItems, setRecentProjectItems] = useState<any[]>([])
  const [recentProjectsLoading, setRecentProjectsLoading] = useState(false)
  const [recentProjectCoverMetaById, setRecentProjectCoverMetaById] = useState<Record<number, any>>({})

  // 在 async 流程中读取最新值（对应 Vue 的 .value 读取）。
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  const coverMetaRef = useRef<Record<number, any>>(recentProjectCoverMetaById)
  coverMetaRef.current = recentProjectCoverMetaById

  const featureCards = [
    {
      key: 'steps',
      title: '分步创作',
      desc: '故事脚本+分镜图片，随时修改',
      cta: '创建项目 →',
      action: () => navigate('/smart'),
    },
    {
      key: 'spark',
      title: '灵感创作',
      desc: '输入灵感，一键生成专属创意',
      cta: '创建项目 →',
      action: () => showToast('灵感创作功能即将开放', 'success'),
    },
  ]

  const adRows = useMemo<AdRow[]>(() => {
    const base: AdRow[] = [
      {
        id: 1,
        name: 'AD好物推广',
        thumb: library1,
        exposure: 5432100,
        exposureDelta: -12,
        ctr: 3.8,
        ctrDelta: 0.8,
        cvr: 1.2,
        cvrDelta: 0.1,
        roi: 4.5,
        roiDelta: 0.3,
      },
      {
        id: 2,
        name: '红牛五一推广',
        thumb: library2,
        exposure: 3241168,
        exposureDelta: -8,
        ctr: 2.1,
        ctrDelta: 0.4,
        cvr: 0.8,
        cvrDelta: 0.2,
        roi: 3.2,
        roiDelta: 0.4,
      },
      {
        id: 3,
        name: '东方树叶广告',
        thumb: library3,
        exposure: 3048257,
        exposureDelta: 2,
        ctr: 3.8,
        ctrDelta: 0.8,
        cvr: 1.2,
        cvrDelta: 0.1,
        roi: 4.5,
        roiDelta: 0.3,
      },
    ]

    if (sortMode === 'exposure') {
      return base.slice().sort((a, b) => Number(b.exposure || 0) - Number(a.exposure || 0))
    }
    return base
  }, [sortMode])

  const recentProjects = useMemo(
    () =>
      recentProjectItems.map((project) => {
        const statusMeta = resolveProjectStatusMeta(project)
        return {
          id: Number(project?.id || 0),
          title: String(project?.title || project?.name || '').trim() || '未命名创意',
          updated: formatRelativeTime(
            project?.updated_at ||
              project?.updatedAt ||
              project?.last_saved_at ||
              project?.created_at ||
              project?.createdAt,
          ),
          status: statusMeta?.key || '',
          statusLabel: statusMeta?.label || '',
          coverUrl: recentProjectCoverMetaById?.[Number(project?.id || 0)]?.url || '',
          coverCount: Number(recentProjectCoverMetaById?.[Number(project?.id || 0)]?.storyboardCount || 0),
        }
      }),
    [recentProjectItems, recentProjectCoverMetaById],
  )

  useEffect(() => {
    async function loadRecentProjectCovers(items: any[], targetWorkspaceId: number) {
      const ids = items.map((item) => Number(item?.id || 0)).filter((id) => Number.isFinite(id) && id > 0)

      if (!ids.length) return

      const nextMap: Record<number, any> = {}
      for (const id of ids) {
        const existing = coverMetaRef.current?.[id]
        if (existing?.url || existing?.storyboardCount) nextMap[id] = existing
      }

      const missingIds = ids.filter((id) => !nextMap[id]?.url)
      if (!missingIds.length) {
        setRecentProjectCoverMetaById(nextMap)
        return
      }

      const detailTasks = missingIds.map((projectId) =>
        getCreativeProject({ projectId, workspaceId: targetWorkspaceId })
          .then((project: any) => ({ projectId, project }))
          .catch(() => null),
      )
      const details = await Promise.all(detailTasks)
      if (Number(workspaceIdRef.current || 0) !== targetWorkspaceId) return

      for (const result of details) {
        if (!result?.projectId || !result.project) continue
        const draft = normalizeCreativeProjectDraft(result.project)
        const candidate = resolveCoverCandidateFromDraft(draft || {})
        const storyboardCount = countGeneratedStoryboardImages(draft || {})
        // 优先用 assetId 获取新的签名 URL，避免使用草稿中已过期的预签名 URL
        let coverUrl = ''
        if (candidate.assetId) {
          coverUrl = await getAssetDownloadUrl({
            workspaceId: targetWorkspaceId,
            assetId: candidate.assetId,
          }).catch(() => '')
          if (Number(workspaceIdRef.current || 0) !== targetWorkspaceId) return
        }
        // 降级：用草稿中保存的原始 URL
        if (!coverUrl) {
          coverUrl = candidate.url
        }
        // 再降级：尝试直接用草稿中的视频 URL
        if (!coverUrl) {
          const videoUrl = draft?.generatedVideoUrl || draft?.generated_video_url || ''
          if (videoUrl) coverUrl = videoUrl
        }
        if (coverUrl || storyboardCount) {
          nextMap[result.projectId] = { url: coverUrl, storyboardCount }
        }
      }

      setRecentProjectCoverMetaById(nextMap)
    }

    async function loadRecentProjects() {
      const currentWorkspaceId = Number(workspaceId || 0)
      if (!currentWorkspaceId) {
        setRecentProjectItems([])
        setRecentProjectsLoading(false)
        setRecentProjectCoverMetaById({})
        return
      }

      setRecentProjectsLoading(true)
      try {
        const items = await listCreativeProjects({ workspaceId: currentWorkspaceId, limit: 50 })
        if (Number(workspaceIdRef.current || 0) !== currentWorkspaceId) return
        const sorted = items.slice().sort((a: any, b: any) => getProjectTimestamp(b) - getProjectTimestamp(a))
        setRecentProjectItems(sorted)
        setRecentProjectCoverMetaById({})
        await loadRecentProjectCovers(sorted, currentWorkspaceId)
      } catch {
        if (Number(workspaceIdRef.current || 0) === currentWorkspaceId) {
          setRecentProjectItems([])
          setRecentProjectCoverMetaById({})
          showToast('最近项目加载失败', 'error')
        }
      } finally {
        if (Number(workspaceIdRef.current || 0) === currentWorkspaceId) {
          setRecentProjectsLoading(false)
        }
      }
    }

    loadRecentProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  function enterProject(project: any) {
    const id = Number(project?.id || 0)
    if (!id) return
    // 按草稿 flow 路由:智能成片→/smart/:id,2.0→/creative/:id
    resolveProjectPath(id, Number(workspaceId || 0)).then((p) => navigate(p))
  }

  return (
    <AppLayout authSession={authSession} activeNav="工作台" onLogoutSuccess={handleLogoutSuccess}>
      <AppToast />

      <section className="wb-main" aria-label="帧智汇工作台">
        <div className="wb-top">
          {featureCards.map((card) => (
            <button key={card.key} type="button" className="wb-feature" onClick={card.action}>
              <div className="wb-feature-icon" aria-hidden="true">
                {card.key === 'steps' ? (
                  <svg className="wb-feature-svg" viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="wbStepsBg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#7c6af7" stopOpacity="0.28" />
                        <stop offset="1" stopColor="#d6dbff" stopOpacity="0.72" />
                      </linearGradient>
                      <filter id="wbShadow" x="-20%" y="-20%" width="140%" height="160%">
                        <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#4e5bd6" floodOpacity="0.18" />
                      </filter>
                    </defs>

                    <g filter="url(#wbShadow)">
                      <rect x="18" y="20" width="148" height="104" rx="18" fill="url(#wbStepsBg)" />
                      <rect x="30" y="34" width="92" height="10" rx="5" fill="#ffffff" fillOpacity="0.85" />
                      <rect x="30" y="52" width="112" height="48" rx="12" fill="#ffffff" fillOpacity="0.6" />
                      <rect x="30" y="106" width="44" height="14" rx="7" fill="#ffffff" fillOpacity="0.7" />
                      <rect x="82" y="106" width="44" height="14" rx="7" fill="#ffffff" fillOpacity="0.7" />
                      <rect x="134" y="106" width="32" height="14" rx="7" fill="#ffffff" fillOpacity="0.55" />
                    </g>

                    <g filter="url(#wbShadow)">
                      <rect x="166" y="20" width="56" height="104" rx="18" fill="#eef0ff" />
                      <circle cx="194" cy="72" r="18" fill="#ffffff" />
                      <path d="M194 63v18M185 72h18" stroke="#7c6af7" strokeWidth="3.2" strokeLinecap="round" />
                    </g>

                    <g filter="url(#wbShadow)">
                      <rect x="88" y="86" width="128" height="48" rx="16" fill="#ffffff" fillOpacity="0.9" />
                      <rect x="104" y="98" width="84" height="8" rx="4" fill="#d6dbff" />
                      <rect x="104" y="112" width="64" height="8" rx="4" fill="#d6dbff" />
                      <path d="M194 118l18 10-18 10" fill="#7c6af7" fillOpacity="0.85" />
                    </g>
                  </svg>
                ) : (
                  <svg className="wb-feature-svg" viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="wbSparkBg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#3e73ff" stopOpacity="0.22" />
                        <stop offset="1" stopColor="#d6dbff" stopOpacity="0.72" />
                      </linearGradient>
                      <filter id="wbShadow2" x="-20%" y="-20%" width="140%" height="160%">
                        <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#2f57e8" floodOpacity="0.16" />
                      </filter>
                    </defs>

                    <g filter="url(#wbShadow2)">
                      <path
                        d="M46 34c0-10 8-18 18-18h92c10 0 18 8 18 18v46c0 10-8 18-18 18H98l-28 18v-18H64c-10 0-18-8-18-18V34Z"
                        fill="url(#wbSparkBg)"
                      />
                      <circle cx="82" cy="48" r="9" fill="#ffffff" fillOpacity="0.9" />
                      <circle cx="110" cy="48" r="9" fill="#ffffff" fillOpacity="0.9" />
                      <circle cx="138" cy="48" r="9" fill="#ffffff" fillOpacity="0.9" />
                    </g>

                    <g filter="url(#wbShadow2)">
                      <path
                        d="M118 62c0-10 8-18 18-18h66c10 0 18 8 18 18v44c0 10-8 18-18 18h-40l-20 14v-14h-6c-10 0-18-8-18-18V62Z"
                        fill="#6d7cff"
                        fillOpacity="0.55"
                      />
                      <path d="M174 62l-16 30h14l-10 30 26-36h-14l14-24Z" fill="#ffffff" fillOpacity="0.92" />
                    </g>

                    <g filter="url(#wbShadow2)">
                      <rect x="78" y="88" width="90" height="72" rx="18" fill="#eef0ff" />
                    </g>
                  </svg>
                )}
              </div>
              <div className="wb-feature-text">
                <strong>{card.title}</strong>
                <p>{card.desc}</p>
                <span className="wb-feature-cta">{card.cta}</span>
              </div>
            </button>
          ))}

          <button
            type="button"
            className="wb-banner"
            aria-label="sentence 2.0 会员限时折扣"
            onClick={() => showToast('开通会员功能即将开放', 'success')}
          >
            <svg
              className="wb-banner-img"
              viewBox="0 0 764 153"
              preserveAspectRatio="xMinYMid meet"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="sentence 2.0 会员限时折扣 稳定可靠，创作无忧"
            >
              <defs>
                <linearGradient id="wbBannerBg" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="0.55" stopColor="#f6fbff" />
                  <stop offset="1" stopColor="#e8fff1" />
                </linearGradient>
                <radialGradient id="wbBannerGlowA" cx="0.32" cy="0.2" r="0.7">
                  <stop offset="0" stopColor="#8aa0ff" stopOpacity="0.28" />
                  <stop offset="1" stopColor="#8aa0ff" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="wbBannerGlowB" cx="0.82" cy="0.3" r="0.75">
                  <stop offset="0" stopColor="#7cf0a8" stopOpacity="0.26" />
                  <stop offset="1" stopColor="#7cf0a8" stopOpacity="0" />
                </radialGradient>
                <filter id="wbBannerSoft" x="-20%" y="-40%" width="140%" height="180%">
                  <feGaussianBlur stdDeviation="14" />
                </filter>
                <linearGradient id="wbBannerTitle" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#5868f1" />
                  <stop offset="1" stopColor="#7a60ff" />
                </linearGradient>
              </defs>

              <rect x="1" y="1" width="762" height="151" rx="18" fill="url(#wbBannerBg)" />
              <rect
                x="1"
                y="1"
                width="762"
                height="151"
                rx="18"
                fill="url(#wbBannerGlowA)"
                filter="url(#wbBannerSoft)"
                opacity="0.9"
              />
              <rect
                x="1"
                y="1"
                width="762"
                height="151"
                rx="18"
                fill="url(#wbBannerGlowB)"
                filter="url(#wbBannerSoft)"
                opacity="0.9"
              />
              <rect x="1" y="1" width="762" height="151" rx="18" fill="none" stroke="rgba(91,107,232,0.22)" />

              <g fontFamily="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif">
                <text x="24" y="58" fontSize="34" fontWeight="800" fill="url(#wbBannerTitle)">
                  sentence 2.0
                </text>
                <text x="248" y="56" fontSize="18" fontWeight="700" fill="#5b6be8">
                  会员限时折扣
                </text>
                <text x="24" y="88" fontSize="18" fontWeight="600" fill="#7a60ff" opacity="0.9">
                  稳定可靠，创作无忧
                </text>
                <text x="24" y="118" fontSize="14" fontWeight="600" fill="#1e2939">
                  立即开通 →
                </text>
              </g>

              <g opacity="0.85">
                <rect
                  x="560"
                  y="46"
                  width="154"
                  height="92"
                  rx="12"
                  fill="rgba(255,255,255,0.55)"
                  stroke="rgba(0,0,0,0.08)"
                />
                <rect x="574" y="58" width="126" height="62" rx="10" fill="rgba(255,255,255,0.8)" />
                <rect x="612" y="124" width="50" height="8" rx="4" fill="rgba(0,0,0,0.08)" />

                <rect
                  x="526"
                  y="64"
                  width="96"
                  height="64"
                  rx="10"
                  fill="rgba(255,255,255,0.55)"
                  stroke="rgba(0,0,0,0.06)"
                />
                <rect x="540" y="74" width="68" height="44" rx="8" fill="rgba(255,255,255,0.78)" />
              </g>

              <g opacity="0.9">
                <rect
                  x="616"
                  y="30"
                  width="110"
                  height="26"
                  rx="8"
                  fill="rgba(124,240,168,0.24)"
                  stroke="rgba(16,185,129,0.18)"
                />
                <rect
                  x="650"
                  y="28"
                  width="118"
                  height="28"
                  rx="8"
                  fill="rgba(124,240,168,0.18)"
                  stroke="rgba(16,185,129,0.14)"
                />
                <rect
                  x="640"
                  y="64"
                  width="126"
                  height="26"
                  rx="8"
                  fill="rgba(124,240,168,0.18)"
                  stroke="rgba(16,185,129,0.14)"
                />
              </g>
            </svg>
          </button>

          <section className="wb-data" aria-label="数据概览">
            <header className="wb-data-head">
              <strong>投放数据</strong>
              <button
                type="button"
                className="wb-data-more"
                onClick={() => showToast('数据看板功能即将开放', 'success')}
              >
                更多
              </button>
            </header>

            <div className="wb-data-subhead">
              <div className="wb-data-tabs" role="tablist" aria-label="投放数据分类">
                {DATA_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`wb-data-tab${tab === activeDataTab ? ' active' : ''}`}
                    role="tab"
                    aria-selected={tab === activeDataTab}
                    onClick={() => setActiveDataTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="wb-data-sort"
                onClick={() => setSortMode(sortMode === 'exposure' ? 'none' : 'exposure')}
              >
                <span>按曝光量排序</span>
                <svg viewBox="0 0 14 14" aria-hidden="true">
                  <path d="m4.5 5.3 2.5 2.5 2.5-2.5" />
                </svg>
              </button>
            </div>

            <div className="wb-data-cards">
              {adRows.map((row) => (
                <article key={row.id} className="wb-data-card">
                  <header className="wb-data-card-head">
                    <strong>{row.name}</strong>
                  </header>
                  <div className="wb-data-card-body">
                    <div className="wb-data-card-thumb">
                      <img src={row.thumb} alt="" loading="lazy" />
                    </div>
                    <div className="wb-data-metrics">
                      <div className="wb-data-metric">
                        <span className="wb-data-metric-label">总曝光量</span>
                        <span className="wb-data-metric-value">{formatNumber(row.exposure)}</span>
                        <span className={`wb-data-metric-delta ${resolveDeltaMeta(row.exposureDelta).className}`}>
                          {resolveDeltaMeta(row.exposureDelta).text}
                        </span>
                      </div>
                      <div className="wb-data-metric">
                        <span className="wb-data-metric-label">点击率</span>
                        <span className="wb-data-metric-value">{formatPercent(row.ctr)}</span>
                        <span className={`wb-data-metric-delta ${resolveDeltaMeta(row.ctrDelta).className}`}>
                          {resolveDeltaMeta(row.ctrDelta).text}
                        </span>
                      </div>
                      <div className="wb-data-metric">
                        <span className="wb-data-metric-label">转化率</span>
                        <span className="wb-data-metric-value">{formatPercent(row.cvr)}</span>
                        <span className={`wb-data-metric-delta ${resolveDeltaMeta(row.cvrDelta).className}`}>
                          {resolveDeltaMeta(row.cvrDelta).text}
                        </span>
                      </div>
                      <div className="wb-data-metric">
                        <span className="wb-data-metric-label">ROI</span>
                        <span className="wb-data-metric-value">{Number(row.roi).toFixed(1)}</span>
                        <span className={`wb-data-metric-delta ${resolveDeltaMeta(row.roiDelta).className}`}>
                          {resolveDeltaMeta(row.roiDelta).text}
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className="wb-recent" aria-label="最近项目">
          <header className="wb-recent-head">
            <strong>最近项目</strong>
            <button type="button" className="wb-data-more" onClick={() => navigate('/projects')}>
              查看全部
            </button>
          </header>
          <div className="wb-projects">
            {recentProjectsLoading ? (
              <div className="wb-project-empty">正在加载当前团队的最近项目...</div>
            ) : !recentProjects.length ? (
              <div className="wb-project-empty">当前团队还没有项目，先创建一个试试。</div>
            ) : (
              recentProjects.map((project) => (
                <button key={project.id} type="button" className="wb-project" onClick={() => enterProject(project)}>
                  <div className={`wb-project-cover${project.coverUrl ? ' has-image' : ''}`} aria-hidden="true">
                    {project.coverUrl ? <img src={project.coverUrl} alt="" loading="lazy" /> : null}
                    {project.coverCount > 0 ? (
                      <span className="wb-project-cover-badge">{project.coverCount} 张分镜</span>
                    ) : null}
                    <div className="wb-project-cover-overlay">
                      <div className="wb-project-cover-copy">
                        <strong>{project.title}</strong>
                        <span>{project.updated}</span>
                      </div>
                      {project.statusLabel ? (
                        <span className={`wb-project-cover-status ${project.status}`}>{project.statusLabel}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="wb-project-body">
                    <strong>{project.title}</strong>
                    <p>{project.updated}</p>
                    {project.statusLabel ? (
                      <span className={`wb-status ${project.status}`}>{project.statusLabel}</span>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </section>
    </AppLayout>
  )
}
