/**
 * HotCopyCreateView — 爆款复制 编排器(两步流程,独立于智能成片)。
 * 流程:① 上传爆款视频 + 替换素材(入口)→ ② 生成视频(video.replicate「做同款」:源视频 role:video + 替换素材 role:image)。
 *
 * 与智能成片不同:不走「脚本→分镜图→video.generate」管线,而是把上传的爆款视频 + 替换素材图
 * 直接喂后端 video.replicate 一锅出片(由后端拆解源视频后用 Seedance 重生成)。
 * 结果支持预览 / 下载 / 重新生成 / 确认修改(片段意见拼进提示词重跑 replicate)。
 * 会话持久化:用 localStorage 存会话 + 在途任务 id(hotCopyDraft),生成途中切走/刷新回来不丢
 * (恢复到生成步并用 task id 续轮询),与智能成片一致;暂不接后端项目 CRUD。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import StepProgress, { type StepItem } from '@/components/smart/StepProgress'
import HotCopyEntry, { type HotCopyEntryPayload } from '@/components/hotcopy/HotCopyEntry'
import VideoStage from '@/components/smart/VideoStage'
import iconProjectEdit from '@/assets/icons/project-edit.svg'
import { replicateHotVideo, uploadHotCopyAsset, awaitHotVideoResult, estimateReplicateCost } from '@/api/hotCopy'
import { editFullVideo } from '@/api/smartVideo'
import { readVideoDurationSec } from '@/utils/videoDuration'
import {
  saveHotCopyDraft,
  loadHotCopyDraft,
  clearHotCopyDraft,
  type HotCopyDraft,
  type HotCopyGenRecord,
} from '@/utils/hotCopyDraft'
import { refreshAssetUrl } from '@/api/smartShotImage'
import { generateProjectName } from '@/api/aiPolish'
import {
  createCreativeProject,
  updateCreativeProjectDraft,
  getCreativeProject,
  patchCreativeProject,
  getModelForOperation,
  isAbortedTaskError,
} from '@/api/business'
import { getModelParamOptions } from '@/utils/videoOptions'
import {
  useWorkspaceId,
  useModelPlanCandidates,
  useWorkspaceSessionStore,
  deriveModelPlanCandidates,
} from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import { openComingSoon, useUiStore } from '@/stores/ui'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { downloadToDisk } from '@/utils/downloadToDisk'
import { getRunningVideoGen, isAnyVideoGenRunning, trackVideoGen, type VideoGenResult } from '@/utils/videoGenRegistry'
import './SmartCreateView.css'

// 两步:上传爆款视频(入口)/ 生成视频
const STEPS: StepItem[] = [
  { key: 'upload', label: '上传爆款视频' },
  { key: 'video', label: '生成视频' },
]

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

// 默认尺寸/时长与智能成片一致:16:9、10s
const DEFAULT_RATIO = '16:9'
const DEFAULT_DURATION_SEC = 10
const HOT_COPY_STALE_GENERATION_MS = 70 * 60 * 1000

// 据 Tab + 文案构造 replicate 提示词
function buildBasePrompt(tab: 'remake' | 'replica', text: string): string {
  const intent =
    tab === 'replica'
      ? '精准复刻:尽量 1:1 还原原视频的画面、运镜与节奏'
      : '同款翻拍:保留原视频镜头节奏与爆点结构,把主体替换为提供的替换素材产品'
  return [text.trim(), intent].filter(Boolean).join(';') || '做同款-爆款复制'
}

function buildEntrySnapshot(payload?: Partial<HotCopyEntryPayload> | null): Partial<HotCopyEntryPayload> | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const products = Array.isArray(payload.products)
    ? payload.products
        .map((p: any) => ({
          url: String(p?.url || ''),
          file: null,
          isVideo: Boolean(p?.isVideo),
          assetId: Number(p?.assetId || 0) || undefined,
          submitAssetId: Number(p?.submitAssetId || 0) || undefined,
        }))
        .filter((p: any) => p.url)
    : []
  const libraryVideo =
    payload.libraryVideo && (payload.libraryVideo.src || payload.libraryVideo.assetId)
      ? {
          assetId: Number(payload.libraryVideo.assetId || 0) || 0,
          src: String(payload.libraryVideo.src || ''),
        }
      : null
  const snapshot: Partial<HotCopyEntryPayload> = {
    tab: (payload.tab as any) || 'remake',
    videoSource: (payload.videoSource as any) || '',
    videoFile: null,
    libraryVideo,
    videoFileName: String(payload.videoFileName || ''),
    videoPreview: String(payload.videoPreview || libraryVideo?.src || ''),
    products,
    text: String(payload.text || ''),
    ratio: String(payload.ratio || DEFAULT_RATIO),
    duration: String(payload.duration || `${DEFAULT_DURATION_SEC}s`),
  }
  return snapshot
}

// 默认/未命名标题:不回写后端(避免无意义的 PATCH 撞草稿保存的 draft_revision → 409)
function isUnnamedTitle(title: string): boolean {
  const t = String(title || '').trim()
  return !t || t.includes('未命名')
}

// 从 createCreativeProject 返回里取项目 id(字段名后端不统一,做兜底)
function resolveProjectId(payload: any): number {
  return (
    Number(
      payload?.id ?? payload?.project_id ?? payload?.projectId ?? payload?.data?.id ?? payload?.data?.project_id ?? 0,
    ) || 0
  )
}

// 从后端 draft_json 还原爆款复制草稿(我们把字段存在 .smart 块里;兼容字符串/对象)
function parseHotCopyDraft(draftJson: any): { obj: any; smart: any } | null {
  let obj = draftJson
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null
  const smart = obj.smart && typeof obj.smart === 'object' ? obj.smart : obj
  return { obj, smart }
}

export default function HotCopyCreateView() {
  const navigate = useNavigate()
  const location = useLocation()
  const { showToast } = useToast()
  const requireAuth = useRequireAuth()
  const workspaceId = useWorkspaceId()
  const modelPlanCandidates = useModelPlanCandidates() as string[]
  const ensureModelPlanCandidatesLoaded = useWorkspaceSessionStore((s) => s.ensureModelPlanCandidatesLoaded)

  const resolvePlanCandidates = async (): Promise<string[]> => {
    try {
      await ensureModelPlanCandidatesLoaded()
    } catch {
      /* 失败用兜底候选 */
    }
    return (deriveModelPlanCandidates(useWorkspaceSessionStore.getState()) as string[]) || modelPlanCandidates
  }

  const [started, setStarted] = useState(false) // false=入口(上传步), true=生成视频步
  const [entryKey, setEntryKey] = useState(0) // 「创建新视频」自增 → 重挂载入口页,清空其内部输入状态
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)

  // 入口回填(返回上一步用)
  // 从「项目管理 → 新建视频」携带的上传素材,需在【首帧】就绪(HotCopyEntry 内部状态只初始化一次),
  // 故用 useState 初始化器同步读 location.state(而非挂载后 setState)。
  const [entryInitial, setEntryInitial] = useState<Partial<HotCopyEntryPayload> | undefined>(() => {
    const st = (location.state as any) || {}
    const imgs = (Array.isArray(st.carryImages) ? st.carryImages : []).filter((m: any) => m && m.url)
    const vid = st.carryVideo && (st.carryVideo.url || st.carryVideo.assetId) ? st.carryVideo : null
    if (!imgs.length && !vid) return undefined
    return {
      tab: 'remake',
      products: imgs.map((m: any) => ({
        url: m.url,
        file: null,
        isVideo: false,
        assetId: Number(m.assetId || 0) || undefined,
        submitAssetId: Number(m.submitAssetId || 0) || undefined,
      })),
      ...(vid
        ? {
            videoSource: 'library' as const,
            videoPreview: vid.url || '',
            libraryVideo: { assetId: Number(vid.assetId || 0), src: vid.url || '' },
          }
        : {}),
    } as any
  })
  const [basePrompt, setBasePrompt] = useState('')

  // replicate 输入:源视频 + 替换素材(asset_id)
  const [sourceVideo, setSourceVideo] = useState<{ assetId: number; url: string }>({ assetId: 0, url: '' })
  const [productAssetIds, setProductAssetIds] = useState<number[]>([])

  // 项目名(v1 仅本地)
  const [projectName, setProjectName] = useState('未命名项目')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [naming, setNaming] = useState(false)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const nameAbortRef = useRef<AbortController | null>(null)

  // 整片视频(replicate 产物)
  const [fullVideo, setFullVideo] = useState<{ url: string; assetId: number }>({ url: '', assetId: 0 })
  const [videoVersions, setVideoVersions] = useState<{ url: string; assetId: number }[]>([])
  const [vidGenRunning, setVidGenRunning] = useState(false)
  const [genTriggerBusy, setGenTriggerBusy] = useState(false)
  const [videoStageKey, setVideoStageKey] = useState(0)
  // 在途生成任务 id(>0=有任务在跑):持久化后,刷新/切换页面回来用它续轮询,不丢生成结果
  const [vidGenTaskId, setVidGenTaskId] = useState(0)
  const vidGenAbortRef = useRef<AbortController | null>(null)
  const aliveRef = useRef(true)
  const vidGenPendingTimerRef = useRef<number>(0)
  const resumeRetryTimerRef = useRef<number>(0)
  const staleGenTimerRef = useRef<number>(0)
  const genTriggerLockRef = useRef(false)
  const completedTaskIdsRef = useRef<Set<number>>(new Set())

  // 每次生成的独立记录(对齐智能成片):processing=生成中、failed=失败(可重试)、published=已并入成片。
  // 作用:① 项目管理里把「生成中/失败」显示成可重试的「草稿」(失败不再让项目凭空消失);
  //       ② 进行中那条的 createdAt 作为加载进度锚点 → 切页面/刷新回来续算,不从头爬。
  type GenRecord = HotCopyGenRecord

  const normalizeGenStatus = (s: any): GenRecord['status'] => {
    const v = String(s || '').trim()
    if (v === 'processing' || v === 'failed' || v === 'published' || v === 'cancelled') return v
    return 'processing'
  }

  // 后端主动中断（cancelled/expired），区别于前端 abort 和后端 failed
  const isTaskCancelled = (e: any): boolean => String(e?.code || '').toUpperCase() === 'TASK_CANCELLED'

  const normalizeGenRecords = (list: any): GenRecord[] => {
    if (!Array.isArray(list)) return []
    return list
      .map((g: any) => {
        const id = String(g?.id || '').trim()
        if (!id) return null
        return {
          id,
          status: normalizeGenStatus(g?.status),
          taskId: Number(g?.taskId || 0) || 0,
          note: String(g?.note || ''),
          error: String(g?.error || ''),
          createdAt: Number(g?.createdAt || 0) || Date.now(),
        } as GenRecord
      })
      .filter(Boolean) as GenRecord[]
  }

  const mergeGenRecords = (...groups: any[]): GenRecord[] => {
    const out: GenRecord[] = []
    const seen = new Set<string>()
    const add = (item: any) => {
      if (Array.isArray(item)) {
        normalizeGenRecords(item).forEach(add)
        return
      }
      const id = String(item?.id || '').trim()
      if (!id || seen.has(id)) return
      seen.add(id)
      out.push(item as GenRecord)
    }
    groups.forEach(add)
    return out
  }
  const dropProcessingGenerations = (...groups: any[]): GenRecord[] =>
    mergeGenRecords(...groups).filter((g) => String(g?.status || '') !== 'processing')
  const dropCompletedGeneration = (...groups: any[]): GenRecord[] => {
    const flatGroups = groups.slice(0, -1)
    const opts = (groups[groups.length - 1] || {}) as { genId?: string | null; taskId?: number }
    const genId = String(opts.genId || '').trim()
    const taskId = Number(opts.taskId || 0) || 0
    return mergeGenRecords(...flatGroups).filter((g) => {
      if (String(g?.status || '') !== 'processing') return true
      if (genId && g.id === genId) return false
      if (taskId > 0 && Number(g.taskId || 0) === taskId) return false
      return true
    })
  }
  const restoreGenerationRecords = (list: any, hasResult: boolean, isGenerating: boolean): GenRecord[] => {
    const records = normalizeGenRecords(list)
    return hasResult && !isGenerating ? records.filter((g) => String(g?.status || '') !== 'processing') : records
  }
  const hasVideoResult = (...items: any[]): boolean =>
    items.some((item) => {
      if (Array.isArray(item)) return item.some((v) => hasVideoResult(v))
      return Boolean(item?.url || item?.assetId)
    })
  const videoGenerationsRef = useRef<GenRecord[]>([])
  const [videoGenerations, setVideoGenerationsState] = useState<GenRecord[]>([])
  const setVideoGenerations = useCallback((nextOrUpdater: GenRecord[] | ((prev: GenRecord[]) => GenRecord[])) => {
    if (typeof nextOrUpdater !== 'function') {
      videoGenerationsRef.current = nextOrUpdater
      setVideoGenerationsState(nextOrUpdater)
      return
    }
    setVideoGenerationsState((prev) => {
      const next = nextOrUpdater(prev)
      videoGenerationsRef.current = next
      return next
    })
  }, [])
  const immediateSaveRef = useRef(false) // 生成记录变化时请求立即落后端,草稿/失败态即时出现在项目里(不等防抖)

  type VideoVersion = { url: string; assetId: number }
  const mergeVideoVersions = (...groups: any[]): VideoVersion[] => {
    const out: VideoVersion[] = []
    const seen = new Set<string>()
    const add = (item: any) => {
      if (Array.isArray(item)) {
        item.forEach(add)
        return
      }
      const url = String(item?.url || '')
      const assetId = Number(item?.assetId || 0) || 0
      if (!url && !assetId) return
      const key = assetId > 0 ? `asset:${assetId}` : `url:${url}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ url, assetId })
    }
    groups.forEach(add)
    return out
  }

  // 源视频真实时长(秒):video.replicate/edit 按它计费;前端读上传视频 HTML5 元数据得到
  const [sourceVideoDurSec, setSourceVideoDurSec] = useState(0)
  const acquireGenTriggerLock = (): boolean => {
    if (genTriggerLockRef.current || vidGenRunning) return false
    genTriggerLockRef.current = true
    setGenTriggerBusy(true)
    return true
  }
  const releaseGenTriggerLock = () => {
    genTriggerLockRef.current = false
    setGenTriggerBusy(false)
  }
  const refreshVideoStage = () => setVideoStageKey((key) => key + 1)
  const clearStaleGenTimer = useCallback(() => {
    if (staleGenTimerRef.current) {
      window.clearTimeout(staleGenTimerRef.current)
      staleGenTimerRef.current = 0
    }
  }, [])
  useEffect(() => {
    return () => {
      aliveRef.current = false
      genTriggerLockRef.current = false
      if (vidGenPendingTimerRef.current) {
        window.clearInterval(vidGenPendingTimerRef.current)
        vidGenPendingTimerRef.current = 0
      }
      if (resumeRetryTimerRef.current) {
        window.clearTimeout(resumeRetryTimerRef.current)
        resumeRetryTimerRef.current = 0
      }
      clearStaleGenTimer()
    }
  }, [clearStaleGenTimer])
  // 用户在入口选择的成片尺寸(画面比例)与时长(秒);默认与智能成片一致 16:9、10s。
  const [genRatio, setGenRatio] = useState(DEFAULT_RATIO)
  const [genDurationSec, setGenDurationSec] = useState(DEFAULT_DURATION_SEC)
  // replicate 模型支持的比例选项(取自模型 params_schema 的 ratio 字段);供入口下拉只放模型真做得了的比例。
  const [ratioOptions, setRatioOptions] = useState<string[]>([])
  // 提交前积分预估(estimate-cost)
  const [videoCost, setVideoCost] = useState<{
    loading: boolean
    error: string
    estimate: { estimatedCost: number; balance: number; canAfford: boolean } | null
  }>({ loading: false, error: '', estimate: null })
  const setWorkspaceSwitchLock = useUiStore((s) => s.setWorkspaceSwitchLock)
  const shouldLockWorkspaceSwitch = genTriggerBusy || vidGenRunning || videoGenerations.some(isActiveProcessingGen)

  useEffect(() => {
    setWorkspaceSwitchLock(shouldLockWorkspaceSwitch || isAnyVideoGenRunning(), '当前视频处理中，暂不支持切换团队')
    return () => {
      setWorkspaceSwitchLock(isAnyVideoGenRunning(), '当前视频处理中，暂不支持切换团队')
    }
  }, [setWorkspaceSwitchLock, shouldLockWorkspaceSwitch])

  // 开一条生成记录(已有进行中的则复用,避免重复);返回记录 id。立即落盘起始时间,供进度锚点。
  const startGen = (note?: string, opts: { forceNew?: boolean } = {}): string => {
    const current = videoGenerationsRef.current
    const existing = opts.forceNew ? null : current.find((g) => g.status === 'processing')
    if (existing) {
      immediateSaveRef.current = true
      return existing.id
    }
    const id = `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const ts = Date.now()
    const rec: GenRecord = { id, status: 'processing', taskId: 0, note: note || '', createdAt: ts }
    immediateSaveRef.current = true
    const ws = Number(workspaceId || 0)
    if (ws) {
      const d = loadHotCopyDraft(ws)
      const prev = mergeGenRecords(current, d?.videoGenerations)
      const next = [rec, ...prev]
      persistNow({ started: true, step: 1, maxReached: 1, videoGenerating: true, videoGenerations: next })
    }
    const next = [rec, ...current]
    setVideoGenerations(next)
    persistNow({ videoGenerations: next })
    return id
  }
  // 结束一条生成记录:成功 published(从草稿列表消失)、失败 failed(留作可重试草稿)。
  const markGen = (id: string | null, status: 'failed' | 'published' | 'cancelled', error = '') => {
    immediateSaveRef.current = true
    setVideoGenerations((prev) => {
      const next = prev.map((g) =>
        g.id === id || (id == null && g.status === 'processing')
          ? { ...g, status, taskId: 0, error: status === 'failed' ? error || g.error || '生成失败，请重试' : '' }
          : g,
      )
      if (!next.some((g) => g.status === 'processing')) {
        persistNow({ videoGenerating: false, vidGenTaskId: 0, videoGenerations: next })
      } else {
        persistNow({ videoGenerations: next })
      }
      return next
    })
  }

  const rememberCompletedTask = (taskId: number) => {
    const id = Number(taskId || 0) || 0
    if (id > 0) completedTaskIdsRef.current.add(id)
  }

  function isActiveProcessingGen(g: any): boolean {
    if (String(g?.status || '') !== 'processing') return false
    const taskId = Number(g?.taskId || 0) || 0
    return !(taskId > 0 && completedTaskIdsRef.current.has(taskId))
  }

  const attachTaskIdToProcessingGen = (taskId: number, genId?: string | null) => {
    const id = Number(taskId || 0) || 0
    if (!id) return
    const targetId = String(genId || '').trim()
    setVideoGenerations((prev) => {
      let changed = false
      const next = prev.map((g) => {
        if (g.status !== 'processing') return g
        if (targetId && g.id !== targetId) return g
        changed = true
        return { ...g, taskId: id }
      })
      persistNow({ videoGenerating: true, vidGenTaskId: id, videoGenerations: changed ? next : prev })
      return changed ? next : prev
    })
  }

  const failStaleGenerations = useCallback(
    (reason = '生成请求已停止，请重新生成') => {
      let changed = false
      immediateSaveRef.current = true
      setVideoGenerations((prev) => {
        const next: GenRecord[] = prev.map((g) => {
          if (g.status !== 'processing') return g
          changed = true
          return { ...g, status: 'failed' as const, taskId: 0, error: reason }
        })
        persistNow({ videoGenerating: false, vidGenTaskId: 0, videoGenerations: next })
        return next
      })
      releaseGenTriggerLock()
      if (vidGenPendingTimerRef.current) {
        window.clearInterval(vidGenPendingTimerRef.current)
        vidGenPendingTimerRef.current = 0
      }
      if (aliveRef.current) {
        setVidGenRunning(false)
        setVidGenTaskId(0)
        if (changed) showToast(`视频生成失败:${reason}`, 'error')
      }
    },
    [showToast],
  )

  // ── 后端项目(对齐智能成片:建项目 + 草稿落库 → 出现在项目管理 + 视频列表;/hot-copy/:id 可恢复)──
  const params = useParams()
  const routeId = Number(params.id || 0)
  const [projectId, setProjectId] = useState(0)
  const projectIdRef = useRef(0)
  const draftRevisionRef = useRef(0) // 后端草稿版本号(防 409)
  const runningVideoPromiseRef = useRef<Promise<VideoGenResult> | null>(null)
  // 项目「视频清单」存档(待分类归类记录,随草稿存云端)。本编辑器不维护它,加载时原样存下、
  // 保存时原样写回,避免整盘重建 draft_json 时被覆盖丢失。
  const projectVideoStoreRef = useRef<any>(null)
  const serverTitleRef = useRef('') // 已同步到后端的标题(去重)
  const pendingAutoTitleRef = useRef('')
  const saveChainRef = useRef<Promise<any>>(Promise.resolve()) // 串行化草稿保存

  const bindRunningVideoPromise = (p: Promise<VideoGenResult>) => {
    runningVideoPromiseRef.current = p
    const pid = Number(projectIdRef.current || 0) || 0
    const tracked = pid > 0 ? trackVideoGen('hot-copy', pid, p) : p
    void tracked.finally(() => {
      if (runningVideoPromiseRef.current === tracked || runningVideoPromiseRef.current === p) {
        runningVideoPromiseRef.current = null
      }
    })
    return tracked
  }

  const attachRunningPromiseToProject = (projectId: number) => {
    const pid = Number(projectId || 0) || 0
    const inflight = runningVideoPromiseRef.current
    if (pid > 0 && inflight) trackVideoGen('hot-copy', pid, inflight)
  }

  const subscribeRunningVideo = (projectId: number): boolean => {
    const pid = Number(projectId || 0) || 0
    const inflight = pid > 0 ? getRunningVideoGen('hot-copy', pid) : null
    if (!inflight) return false
    setVidGenRunning(true)
    inflight
      .then(({ url, assetId }) => {
        const ws = Number(workspaceId || 0)
        const d = ws ? loadHotCopyDraft(ws) : null
        commitGeneratedVideo(ws, { url, assetId }, Number(d?.vidGenTaskId || vidGenTaskId || 0) || 0)
      })
      .catch((e: any) => {
        if (isAbortedTaskError(e)) {
          const ws = Number(workspaceId || 0)
          const taskId = Number(loadHotCopyDraft(ws)?.vidGenTaskId || vidGenTaskId || 0) || 0
          if (ws && taskId) scheduleResumeVideoTask(ws, taskId)
          return
        }
        persistNow({ videoGenerating: false })
        if (aliveRef.current) {
          if (isTaskCancelled(e)) {
            markGen(null, 'cancelled')
            showToast('视频生成已中断', 'info')
          } else {
            markGen(null, 'failed')
            showToast(`视频生成失败:${e?.message || '请重试'}`, 'error')
          }
        }
      })
      .finally(() => {
        persistNow({ videoGenerating: false, vidGenTaskId: 0 })
        if (aliveRef.current) {
          setVidGenRunning(false)
          setVidGenTaskId(0)
        }
      })
    return true
  }

  // 从「项目管理 → 新建视频」进入:沿用原项目名 + 携带上传素材(源视频/替换素材)+ 绑定同一项目(不新建重复项目)。
  // 全新流程:不恢复旧草稿,仅把素材预填入口;生成保存到同一 projectId(覆盖其草稿)。
  useEffect(() => {
    const st = location.state as any
    if (!st || routeId > 0) return // /hot-copy/:id 走恢复;此分支仅用于无 id 的全新流程
    if (typeof st.newProjectName === 'string' && st.newProjectName.trim()) {
      setProjectName(st.newProjectName.trim())
      setNameTouched(true)
    }
    // 上传素材已在 entryInitial 初始化器同步读入(见上),此处不再 setEntryInitial
    if (Number(st.restartProjectId)) {
      projectIdRef.current = Number(st.restartProjectId)
      setProjectId(Number(st.restartProjectId))
      serverTitleRef.current = ''
    }
    // 仅 mount 注入一次([] 依赖)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 续等在途视频任务并回填(本地恢复 / 后端恢复共用)
  const resumeVideoTask = (ws: number, taskId: number) => {
    if (!ws || !taskId) return
    setVidGenTaskId(taskId)
    setVidGenRunning(true)
    persistNow({ videoGenerating: true, vidGenTaskId: taskId })
    vidGenAbortRef.current?.abort()
    const ctrl = new AbortController()
    vidGenAbortRef.current = ctrl
    let aborted = false
    const inflight = bindRunningVideoPromise(awaitHotVideoResult({ workspaceId: ws, taskId, signal: ctrl.signal }))
    inflight
      .then(({ url, assetId }) => {
        commitGeneratedVideo(ws, { url, assetId }, taskId)
      })
      .catch((e: any) => {
        if (isAbortedTaskError(e)) {
          aborted = true
          scheduleResumeVideoTask(ws, taskId)
          return
        }
        if (!aliveRef.current) return
        persistNow({ videoGenerating: false, vidGenTaskId: 0 })
        if (isTaskCancelled(e)) {
          markGen(null, 'cancelled')
          showToast('视频生成已中断', 'info')
        } else {
          const errMsg = e?.message || '请重试'
          markGen(null, 'failed')
          showToast(`视频生成失败:${errMsg}`, 'error')
        }
      })
      .finally(() => {
        if (!aborted) {
          if (!aliveRef.current) return
          persistNow({ videoGenerating: false, vidGenTaskId: 0 })
          if (aliveRef.current) {
            setVidGenRunning(false)
            setVidGenTaskId(0)
          }
        }
      })
  }

  const scheduleResumeVideoTask = (ws: number, taskId: number) => {
    const id = Number(taskId || 0) || 0
    if (!ws || !id || !aliveRef.current) return
    if (resumeRetryTimerRef.current) return
    resumeRetryTimerRef.current = window.setTimeout(() => {
      resumeRetryTimerRef.current = 0
      if (!aliveRef.current || runningVideoPromiseRef.current) return
      const draft = loadHotCopyDraft(ws)
      const draftTaskId = Number(draft?.vidGenTaskId || 0) || 0
      const hasResult = hasVideoResult(draft?.fullVideo, draft?.videoVersions, fullVideo)
      if (draftTaskId === id && !hasResult) resumeVideoTask(ws, id)
    }, 1200)
  }

  const ensurePendingTaskId = (ws: number) => {
    if (!ws) return
    if (vidGenPendingTimerRef.current) return
    vidGenPendingTimerRef.current = window.setInterval(() => {
      const d = loadHotCopyDraft(ws)
      const id = Number(d?.vidGenTaskId || 0) || 0
      const hasResult = hasVideoResult(d?.fullVideo, d?.videoVersions)
      if (hasResult) {
        if (vidGenPendingTimerRef.current) {
          window.clearInterval(vidGenPendingTimerRef.current)
          vidGenPendingTimerRef.current = 0
        }
        if (aliveRef.current) {
          setVidGenRunning(false)
          setVidGenTaskId(0)
        }
        return
      }
      if (id > 0) {
        if (vidGenPendingTimerRef.current) {
          window.clearInterval(vidGenPendingTimerRef.current)
          vidGenPendingTimerRef.current = 0
        }
        if (aliveRef.current) resumeVideoTask(ws, id)
      }
    }, 800)
  }

  // ── 进入恢复(对齐智能成片) ──
  // A) /hot-copy/:id → 从后端项目草稿恢复(权威,进项目管理后重开走这条);
  // B) /hot-copy(无 id):本地草稿若是「在制项目」→ 跳回 /hot-copy/:id;否则按本地会话恢复(不回入口)。
  const hydratedRef = useRef(false)
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (!ws || hydratedRef.current) return

    // 全新流程,不恢复本地在制草稿、不跳回旧进度(清掉旧本地草稿,避免把页面带回上次未完成的步骤):
    //   ① 项目管理 → 新建视频(restartProjectId);② 主页/模板「做同款」(carryVideo / carryImages)。
    // 绑定项目 + 携带素材由 初始化器 / 上面的注入 effect 处理。
    const navSt = (location.state as any) || {}
    if (navSt.workspaceSwitchReset) {
      hydratedRef.current = true
      navigate('/hot-copy', { replace: true })
      return
    }
    const hasCarry =
      (navSt.carryVideo && (navSt.carryVideo.url || navSt.carryVideo.assetId)) ||
      (Array.isArray(navSt.carryImages) && navSt.carryImages.length > 0)
    if (routeId === 0 && (Number(navSt.restartProjectId) || hasCarry)) {
      clearHotCopyDraft(ws)
      hydratedRef.current = true
      return
    }

    if (routeId > 0) {
      hydratedRef.current = true
      projectIdRef.current = routeId
      setProjectId(routeId)
      getCreativeProject({ projectId: routeId, workspaceId: ws })
        .then((proj: any) => {
          draftRevisionRef.current = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
          const parsed = parseHotCopyDraft(proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft)
          const smart = parsed?.smart || {}
          const obj = parsed?.obj || {}
          const localD = loadHotCopyDraft(ws)
          // 留存项目视频清单存档(归类记录),保存时原样写回,避免被本编辑器的草稿快照覆盖
          projectVideoStoreRef.current = obj && typeof obj === 'object' ? obj.projectVideoStore || null : null
          setStarted(true)
          setStep(1)
          setMaxReached(1)
          setBasePrompt(String(smart.basePrompt || obj.description || ''))
          setNameTouched(!!smart.nameTouched)
          setSourceVideo(
            smart.sourceVideo && typeof smart.sourceVideo === 'object' ? smart.sourceVideo : { assetId: 0, url: '' },
          )
          setProductAssetIds(Array.isArray(smart.productAssetIds) ? smart.productAssetIds : [])
          const fv = {
            url: String(smart.fullVideoUrl || obj.generatedVideoUrl || ''),
            assetId: Number(smart.fullVideoAssetId || obj.generatedVideoAssetId || 0) || 0,
          }
          setFullVideo(fv)
          const rawVers =
            Array.isArray(smart.videoVersions) && smart.videoVersions.length
              ? smart.videoVersions
              : Array.isArray(obj.videoHistoryList)
                ? obj.videoHistoryList
                : []
          const restoredVersions = mergeVideoVersions(rawVers, fv)
          const restoredHasResult = hasVideoResult(restoredVersions, fv, localD?.videoVersions, localD?.fullVideo)
          const restoredIsGenerating = Boolean(smart.videoGenerating || (!restoredHasResult && localD?.videoGenerating))
          const restoredGenerations = restoreGenerationRecords(
            (smart as any)?.videoGenerations,
            restoredHasResult,
            restoredIsGenerating,
          )
          setVideoVersions(restoredVersions)
          setVideoGenerations(restoredGenerations)
          if (smart.genRatio) setGenRatio(String(smart.genRatio))
          if (Number(smart.genDurationSec) > 0) setGenDurationSec(Number(smart.genDurationSec))
          const t = String(proj?.title || proj?.name || '').trim()
          if (t) {
            setProjectName(t)
            serverTitleRef.current = t
          }
          // 入口快照优先取后端草稿,本地草稿兜底。否则回到上一步时会只显示恢复态按钮,但表单历史数据丢失。
          if (smart.entryInitial && typeof smart.entryInitial === 'object') setEntryInitial(smart.entryInitial)
          else if (localD?.entryInitial) setEntryInitial(localD.entryInitial)
          if (localD?.fullVideo && typeof localD.fullVideo === 'object' && localD.fullVideo.url && !fv.url) {
            setFullVideo({ url: String(localD.fullVideo.url), assetId: Number(localD.fullVideo.assetId || 0) || 0 })
          }
          if (Array.isArray(localD?.videoVersions) && localD.videoVersions.length) {
            const localVers = localD.videoVersions
              .map((v: any) => ({ url: String(v?.url || ''), assetId: Number(v?.assetId || 0) || 0 }))
              .filter((v: any) => v.url || v.assetId)
            if (localVers.length && localVers.length > rawVers.length)
              setVideoVersions(mergeVideoVersions(localVers, fv))
          }
          const pendingTask = restoredIsGenerating ? Number(smart.vidGenTaskId || localD?.vidGenTaskId || 0) || 0 : 0
          if (pendingTask > 0 && !restoredHasResult) {
            resumeVideoTask(ws, pendingTask)
          } else if (!restoredHasResult) {
            const subscribed = subscribeRunningVideo(routeId)
            if (!subscribed) ensurePendingTaskId(ws)
          }
        })
        .catch(() => showToast('项目加载失败', 'error'))
      return
    }

    // B) 无 id:同浏览器在制会话 → 直接用本地草稿恢复并续轮询(【不重定向、不重挂载】,
    //    避免打断/丢失正在进行的生成)。后端项目句柄(projectId)也一并恢复,保存继续写后端,
    //    项目管理照样可见。跨设备/全新浏览器的恢复走「项目管理→进入编辑」的 /hot-copy/:id(A 分支)。
    hydratedRef.current = true
    const d = loadHotCopyDraft(ws)
    if (d?.entryInitial) setEntryInitial(d.entryInitial)
    const hasProcessing = normalizeGenRecords((d as any)?.videoGenerations).some((g) => g.status === 'processing')
    const hasGeneratingFlag = Boolean(d?.videoGenerating)
    const pendingTaskId = Number(d?.vidGenTaskId || 0) || 0
    if (d?.started || hasProcessing || pendingTaskId > 0 || hasGeneratingFlag) {
      const pid = Number(d.projectId || 0) || 0
      if (pid) {
        projectIdRef.current = pid
        setProjectId(pid)
        draftRevisionRef.current = 0 // 未知 revision:首次后端保存时由 doPutHotCopyDraft 自动拉取/重试
      }
      setStarted(true)
      setStep(d.step || 1)
      setMaxReached(d.maxReached || 1)
      setBasePrompt(d.basePrompt || '')
      if (d.projectName) setProjectName(d.projectName)
      setNameTouched(!!d.nameTouched)
      setSourceVideo(d.sourceVideo || { assetId: 0, url: '' })
      setProductAssetIds(Array.isArray(d.productAssetIds) ? d.productAssetIds : [])
      const restoredFullVideo = d.fullVideo || { url: '', assetId: 0 }
      const restoredVersions = mergeVideoVersions(d.videoVersions, restoredFullVideo)
      const restoredHasResult = hasVideoResult(restoredVersions, restoredFullVideo)
      const restoredIsGenerating = Boolean(d?.videoGenerating)
      setFullVideo(restoredFullVideo)
      setVideoVersions(restoredVersions)
      setVideoGenerations(
        restoreGenerationRecords((d as any)?.videoGenerations, restoredHasResult, restoredIsGenerating),
      )
      if (d.genRatio) setGenRatio(String(d.genRatio))
      if (Number(d.genDurationSec) > 0) setGenDurationSec(Number(d.genDurationSec))
      // 普通进入 /hot-copy 根页时，优先只按已持久化的 taskId 续轮询，避免被旧 in-flight 占位误带回假生成态。
      if (pendingTaskId > 0 && restoredIsGenerating && !restoredHasResult) resumeVideoTask(ws, pendingTaskId)
      else if ((hasProcessing || hasGeneratingFlag) && !restoredHasResult) ensurePendingTaskId(ws)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, workspaceId])

  useEffect(() => {
    const ws = Number(workspaceId || 0)
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasProcessing = videoGenerations.some(isActiveProcessingGen)
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && getRunningVideoGen('hot-copy', pid))
    const processingStartedAt =
      videoGenerations
        .filter(isActiveProcessingGen)
        .reduce((max, g) => Math.max(max, Number(g.createdAt || 0) || 0), 0) || 0
    const inStartupGrace = processingStartedAt > 0 && Date.now() - processingStartedAt < 5 * 60 * 1000
    const draft = ws ? loadHotCopyDraft(ws) : null
    const recoverTaskId =
      Number(vidGenTaskId || videoGenerations.find(isActiveProcessingGen)?.taskId || draft?.vidGenTaskId || 0) || 0
    const hasResult = hasVideoResult(draft?.fullVideo, draft?.videoVersions, fullVideo, videoVersions)
    if (!hasProcessing) {
      clearStaleGenTimer()
      return
    }
    if (hasInflight) {
      clearStaleGenTimer()
      return
    }
    if (recoverTaskId > 0 && !hasResult) {
      if (staleGenTimerRef.current) return
      staleGenTimerRef.current = window.setTimeout(() => {
        staleGenTimerRef.current = 0
        if (!aliveRef.current) return
        const latestPid = Number(projectIdRef.current || projectId || 0) || 0
        const latestInflight =
          Boolean(runningVideoPromiseRef.current) || Boolean(latestPid > 0 && getRunningVideoGen('hot-copy', latestPid))
        if (!latestInflight) resumeVideoTask(ws, recoverTaskId)
      }, 3000)
      return clearStaleGenTimer
    }
    if (inStartupGrace) {
      clearStaleGenTimer()
      return
    }
    if (staleGenTimerRef.current) return
    staleGenTimerRef.current = window.setTimeout(() => {
      staleGenTimerRef.current = 0
      if (!aliveRef.current) return
      const latestPid = Number(projectIdRef.current || projectId || 0) || 0
      const latestInflight =
        Boolean(runningVideoPromiseRef.current) || Boolean(latestPid > 0 && getRunningVideoGen('hot-copy', latestPid))
      if (latestInflight) {
        if (latestPid) subscribeRunningVideo(latestPid)
        return
      }
      const draft = ws ? loadHotCopyDraft(ws) : null
      const draftTaskId = Number(draft?.vidGenTaskId || 0) || 0
      const hasResult = hasVideoResult(draft?.fullVideo, draft?.videoVersions, fullVideo, videoVersions)
      const draftProcessingStartedAt =
        normalizeGenRecords((draft as any)?.videoGenerations)
          .filter(isActiveProcessingGen)
          .reduce((max, g) => Math.max(max, Number(g.createdAt || 0) || 0), processingStartedAt) || 0
      if (draftProcessingStartedAt > 0 && Date.now() - draftProcessingStartedAt > HOT_COPY_STALE_GENERATION_MS) {
        failStaleGenerations('生成任务已超过 1 小时未返回结果，请重新生成')
        return
      }
      if (draftTaskId > 0 && !hasResult) {
        resumeVideoTask(ws, draftTaskId)
        return
      }
      failStaleGenerations()
    }, 15000)
    return clearStaleGenTimer
  }, [clearStaleGenTimer, failStaleGenerations, projectId, vidGenTaskId, videoGenerations, workspaceId])

  useEffect(() => {
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasProcessing = videoGenerations.some(isActiveProcessingGen)
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && getRunningVideoGen('hot-copy', pid))
    if (!(vidGenRunning || genTriggerBusy)) return
    if (hasProcessing || vidGenTaskId > 0 || hasInflight) return
    releaseGenTriggerLock()
    setVidGenRunning(false)
    persistNow({
      videoGenerating: false,
      vidGenTaskId: 0,
      videoGenerations: dropProcessingGenerations(videoGenerations),
    })
  }, [genTriggerBusy, projectId, vidGenRunning, vidGenTaskId, videoGenerations])

  // 状态变更即写回草稿(仅在已水合且已进入流程后,避免用初始空态覆盖已存草稿)
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (!ws || !hydratedRef.current) return
    const hasEntry =
      Boolean(entryInitial?.videoPreview) ||
      Boolean(entryInitial?.text?.trim?.()) ||
      Boolean(entryInitial?.libraryVideo?.assetId || entryInitial?.libraryVideo?.src) ||
      Boolean(entryInitial?.products?.length)
    if (!started && !hasEntry) return
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && getRunningVideoGen('hot-copy', pid))
    const rawTaskId = Number(vidGenTaskId || 0) || 0
    const draftTaskId = rawTaskId > 0 && completedTaskIdsRef.current.has(rawTaskId) ? 0 : rawTaskId
    const hasProcessing = videoGenerations.some(isActiveProcessingGen)
    const hasActiveGeneration = hasProcessing && (genTriggerBusy || vidGenRunning || draftTaskId > 0 || hasInflight)
    const draftVideoGenerations =
      hasActiveGeneration || !fullVideo.url ? videoGenerations : dropProcessingGenerations(videoGenerations)
    const localDraft = loadHotCopyDraft(ws)
    const draftVideoVersions = mergeVideoVersions(
      localDraft?.videoVersions,
      videoVersions,
      localDraft?.fullVideo,
      fullVideo,
    )
    saveHotCopyDraft(ws, {
      entryInitial,
      projectId: projectIdRef.current || projectId,
      started,
      step,
      maxReached,
      basePrompt,
      projectName,
      nameTouched,
      sourceVideo,
      productAssetIds,
      fullVideo,
      videoVersions: draftVideoVersions,
      videoGenerating: hasActiveGeneration,
      vidGenTaskId: hasActiveGeneration ? draftTaskId : 0,
      videoGenerations: draftVideoGenerations,
      genRatio,
      genDurationSec,
    })
  }, [
    workspaceId,
    entryInitial,
    projectId,
    started,
    step,
    maxReached,
    basePrompt,
    projectName,
    nameTouched,
    sourceVideo,
    productAssetIds,
    fullVideo,
    videoVersions,
    genTriggerBusy,
    vidGenRunning,
    vidGenTaskId,
    videoGenerations,
    genRatio,
    genDurationSec,
  ])

  // 命令式立即落盘:在关键节点(开始生成 / 拿到 task id / 拿到源素材)直接写 localStorage,
  // 不依赖 effect 时机 —— 防止「刚点生成就切走、setState 还没触发保存就卸载」导致 task id 丢失。
  const persistNow = (partial: Partial<HotCopyDraft>) => {
    const ws = Number(workspaceId || 0)
    if (!ws) return
    const base: HotCopyDraft = loadHotCopyDraft(ws) || {
      entryInitial,
      projectId: projectIdRef.current || projectId,
      started: true,
      step: 1,
      maxReached: 1,
      basePrompt,
      projectName,
      nameTouched,
      sourceVideo,
      productAssetIds,
      fullVideo,
      videoVersions,
      videoGenerating: vidGenRunning,
      vidGenTaskId,
      videoGenerations,
      genRatio,
      genDurationSec,
    }
    saveHotCopyDraft(ws, { ...base, started: true, ...partial })
  }

  const commitGeneratedVideo = (
    ws: number,
    video: { url: string; assetId: number },
    completedTaskId?: number,
    completedGenId?: string | null,
  ): { versions: VideoVersion[]; generations: GenRecord[] } => {
    const safeVideo = {
      url: String(video?.url || ''),
      assetId: Number(video?.assetId || 0) || 0,
    }
    if (!safeVideo.url && !safeVideo.assetId) return { versions: videoVersions, generations: videoGenerations }
    rememberCompletedTask(Number(completedTaskId || 0) || 0)
    runningVideoPromiseRef.current = null
    const draft = ws ? loadHotCopyDraft(ws) : null
    const nextVersions = mergeVideoVersions(draft?.videoVersions, videoVersions, draft?.fullVideo, fullVideo, safeVideo)
    const nextGenerations = dropCompletedGeneration(videoGenerationsRef.current, draft?.videoGenerations, {
      genId: completedGenId,
      taskId: completedTaskId,
    })
    const hasRemainingProcessing = nextGenerations.some(isActiveProcessingGen)
    immediateSaveRef.current = true
    persistNow({
      fullVideo: safeVideo,
      videoVersions: nextVersions,
      videoGenerating: hasRemainingProcessing,
      vidGenTaskId: hasRemainingProcessing ? vidGenTaskId : 0,
      videoGenerations: nextGenerations,
    })
    if (aliveRef.current) {
      setFullVideo(safeVideo)
      setVideoVersions((prev) => mergeVideoVersions(draft?.videoVersions, prev, draft?.fullVideo, fullVideo, safeVideo))
      setVideoGenerations((prev) =>
        dropCompletedGeneration(prev, draft?.videoGenerations, { genId: completedGenId, taskId: completedTaskId }),
      )
      if (!hasRemainingProcessing) {
        setVidGenRunning(false)
        setVidGenTaskId(0)
      }
      refreshVideoStage()
    }
    return { versions: nextVersions, generations: nextGenerations }
  }

  // ── 后端草稿快照 + 落库(对齐智能成片 buildSmartSnapshot/doPutDraft:顶层供项目管理读取 + smart 块供精确回填) ──
  const buildHotCopySnapshot = (): any => {
    const ws = Number(workspaceId || 0)
    const draft = ws ? loadHotCopyDraft(ws) : null
    const currentVideo = fullVideo.url || fullVideo.assetId ? fullVideo : draft?.fullVideo || { url: '', assetId: 0 }
    const versions = mergeVideoVersions(draft?.videoVersions, videoVersions, draft?.fullVideo, fullVideo)
    const fvUrl = currentVideo.url || ''
    const fvId = currentVideo.assetId || 0
    const snapshotHasResult = hasVideoResult(versions, currentVideo)
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && getRunningVideoGen('hot-copy', pid))
    const hasProcessing = videoGenerations.some(isActiveProcessingGen)
    const snapshotGenerating = hasProcessing && (genTriggerBusy || vidGenRunning || vidGenTaskId > 0 || hasInflight)
    const snapshotTaskId = snapshotGenerating ? vidGenTaskId : 0
    const snapshotGenerations = restoreGenerationRecords(videoGenerations, snapshotHasResult, snapshotGenerating)
    return {
      flow: 'hot-copy',
      title: projectName || '',
      currentStep: 'video',
      description: basePrompt || '',
      generatedVideoUrl: fvUrl,
      generatedVideoAssetId: fvId,
      videoHistoryList: versions.length ? versions : fvUrl || fvId ? [{ url: fvUrl, assetId: fvId }] : [],
      // 原样保留项目视频清单存档(归类记录),避免整盘重建草稿时丢失(本编辑器不维护它)
      ...(projectVideoStoreRef.current ? { projectVideoStore: projectVideoStoreRef.current } : {}),
      smart: {
        flow: 'hot-copy',
        entryInitial,
        projectName,
        nameTouched,
        basePrompt,
        sourceVideo,
        productAssetIds,
        fullVideoUrl: fvUrl,
        fullVideoAssetId: fvId,
        videoVersions: versions,
        videoGenerating: snapshotGenerating,
        vidGenTaskId: snapshotTaskId,
        videoGenerations: snapshotGenerations,
        genRatio,
        genDurationSec,
        step,
        maxReached,
      },
    }
  }

  // 从任意返回体/错误体取 draft_revision(下划线/驼峰/嵌套 data 多种写法)
  const normRev = (p: any): number => {
    const v = Number(p?.draft_revision ?? p?.draftRevision ?? p?.data?.draft_revision ?? p?.data?.draftRevision ?? NaN)
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : NaN
  }
  const fetchRevision = async (id: number, ws: number) => {
    try {
      const proj: any = await getCreativeProject({ projectId: id, workspaceId: ws })
      const r = normRev(proj)
      if (Number.isFinite(r)) draftRevisionRef.current = r
    } catch {
      /* ignore */
    }
  }
  const doPutHotCopyDraft = async (workspaceIdOverride?: number): Promise<boolean> => {
    const id = projectIdRef.current
    const ws = Number(workspaceIdOverride || workspaceId || 0)
    if (!id || !ws) return false
    // 封面:优先首张替换素材图(图片资源,适合做封面);没有则不带(=保持现状,后端封面不变)
    const coverAssetId = Number(productAssetIds[0] || 0) || 0
    try {
      const payload: any = await updateCreativeProjectDraft({
        projectId: id,
        workspaceId: ws,
        draft: buildHotCopySnapshot(),
        draftRevision: draftRevisionRef.current,
        coverAssetId,
      })
      const next = normRev(payload)
      if (Number.isFinite(next)) draftRevisionRef.current = next
      else await fetchRevision(id, ws) // 响应没带 revision → 重新拉,保持同步(否则下次保存必 409)
      return true
    } catch (e: any) {
      const conflict =
        Number(e?.status || 0) === 409 ||
        Number(e?.code || 0) === 409 ||
        String(e?.code || '').toUpperCase() === 'DRAFT_CONFLICT' ||
        String(e?.response?.code_string || e?.response?.codeString || '').toUpperCase() === 'DRAFT_CONFLICT' ||
        Number(e?.response?.code || 0) === 409
      if (!conflict) return false
      // 版本冲突:优先用 409 响应体里直接带的最新 revision,没有再拉一次,然后重试
      const fromErr = normRev(e?.response)
      if (Number.isFinite(fromErr)) draftRevisionRef.current = fromErr
      else await fetchRevision(id, ws)
      try {
        const payload: any = await updateCreativeProjectDraft({
          projectId: id,
          workspaceId: ws,
          draft: buildHotCopySnapshot(),
          draftRevision: draftRevisionRef.current,
          coverAssetId,
        })
        const next = normRev(payload)
        if (Number.isFinite(next)) draftRevisionRef.current = next
        else await fetchRevision(id, ws)
        return true
      } catch {
        return false
      }
    }
  }
  // 串行化后端保存(防并发 PUT 用同 revision 互相 409)
  const putHotCopyDraftToBackend = (workspaceIdOverride?: number): Promise<boolean> => {
    const run = saveChainRef.current.catch(() => {}).then(() => doPutHotCopyDraft(workspaceIdOverride))
    saveChainRef.current = run
    return run
  }

  // 标题 PATCH 与草稿 PUT 共用服务端 draft_revision:必须走同一条串行链,否则两条写入路径
  // 会用同一个 revision 互相 409。PATCH 成功后同步本地 revision(响应没带就重拉),避免下次草稿保存过期。
  const doPatchHotCopyTitle = async (title: string, workspaceIdOverride?: number): Promise<boolean> => {
    const id = projectIdRef.current
    const ws = Number(workspaceIdOverride || workspaceId || 0)
    const t = String(title || '').trim()
    if (!id || !ws || !t) return false
    try {
      const payload: any = await patchCreativeProject({ projectId: id, workspaceId: ws, title: t, name: t })
      const next = normRev(payload)
      if (Number.isFinite(next)) draftRevisionRef.current = next
      else await fetchRevision(id, ws)
      return true
    } catch {
      return false
    }
  }
  const patchHotCopyTitleToBackend = (title: string, workspaceIdOverride?: number): Promise<boolean> => {
    const run = saveChainRef.current.catch(() => {}).then(() => doPatchHotCopyTitle(title, workspaceIdOverride))
    saveChainRef.current = run
    return run
  }

  const flushHotCopyDraft = (workspaceIdOverride?: number) => {
    const ws = Number(workspaceIdOverride || workspaceId || 0)
    if (!ws || !hydratedRef.current) return
    const hasEntry =
      Boolean(entryInitial?.videoPreview) ||
      Boolean(entryInitial?.text?.trim?.()) ||
      Boolean(entryInitial?.libraryVideo?.assetId || entryInitial?.libraryVideo?.src) ||
      Boolean(entryInitial?.products?.length)
    if (!started && !hasEntry) return
    const localDraft = loadHotCopyDraft(ws)
    const draftVideoVersions = mergeVideoVersions(
      localDraft?.videoVersions,
      videoVersions,
      localDraft?.fullVideo,
      fullVideo,
    )
    const draftHasResult = hasVideoResult(draftVideoVersions, fullVideo, localDraft?.fullVideo)
    const pid = Number(projectIdRef.current || projectId || 0) || 0
    const hasInflight =
      Boolean(runningVideoPromiseRef.current) || Boolean(pid > 0 && getRunningVideoGen('hot-copy', pid))
    const hasProcessing = videoGenerations.some(isActiveProcessingGen)
    const draftHasActiveGeneration =
      hasProcessing && (genTriggerBusy || vidGenRunning || vidGenTaskId > 0 || hasInflight)
    const draftVideoGenerations = restoreGenerationRecords(videoGenerations, draftHasResult, draftHasActiveGeneration)
    saveHotCopyDraft(ws, {
      entryInitial,
      projectId: projectIdRef.current || projectId,
      started,
      step,
      maxReached,
      basePrompt,
      projectName,
      nameTouched,
      sourceVideo,
      productAssetIds,
      fullVideo,
      videoVersions: draftVideoVersions,
      videoGenerating: draftHasActiveGeneration,
      vidGenTaskId: draftHasActiveGeneration ? vidGenTaskId : 0,
      videoGenerations: draftVideoGenerations,
      genRatio,
      genDurationSec,
    })
    if (projectIdRef.current) void putHotCopyDraftToBackend(ws)
  }

  // 后端草稿自动保存(1.5s 防抖;已水合且已建项目才存)
  useEffect(() => {
    if (!hydratedRef.current || !projectIdRef.current) return
    const t = window.setTimeout(() => void putHotCopyDraftToBackend(), 1500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    started,
    step,
    basePrompt,
    projectName,
    sourceVideo,
    productAssetIds,
    fullVideo,
    videoVersions,
    vidGenTaskId,
    videoGenerations,
  ])

  // 生成记录(生成中/失败)变化 → 立即落后端,不等防抖:草稿/失败态即时出现在项目管理里。
  useEffect(() => {
    if (!hydratedRef.current || !projectIdRef.current || !immediateSaveRef.current) return
    immediateSaveRef.current = false
    void putHotCopyDraftToBackend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoGenerations])

  const flushHotCopyDraftRef = useRef<() => void>(() => {})
  flushHotCopyDraftRef.current = () => flushHotCopyDraft(Number(workspaceId || 0))
  useEffect(
    () => () => {
      flushHotCopyDraftRef.current()
    },
    [],
  )

  // 项目名变化回写后端标题(防抖;默认/未命名标题不回写,避免 PATCH 撞草稿 revision → 409;与已同步标题相同也跳过)
  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    if (!projectId || !wsId) return
    const t = projectName.trim()
    if (!t || isUnnamedTitle(t) || t === serverTitleRef.current) return
    const timer = window.setTimeout(() => {
      serverTitleRef.current = t
      // 走草稿保存同一条串行链:标题 PATCH 与草稿 PUT 排队执行、共享 revision,不再互相 409
      void patchHotCopyTitleToBackend(t, wsId).then((ok) => {
        if (!ok) serverTitleRef.current = ''
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [projectId, projectName, workspaceId])

  // 拉 replicate 模型,取其 ratio 字段支持的比例选项 → 入口下拉只放模型真做得了的比例(避免选了被悄悄回退)。
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (!ws) return
    let alive = true
    ;(async () => {
      try {
        const plans = await resolvePlanCandidates()
        const model: any = await getModelForOperation('video.replicate', ['seedance'], plans, ws)
        const opts = (getModelParamOptions(model, 'ratio') || []).map(String).filter(Boolean)
        if (!alive || !opts.length) return
        setRatioOptions(opts)
        // 默认比例收敛到模型支持范围内(不在则取第一个支持项)
        setGenRatio((r) => (opts.includes(r) ? r : opts[0]))
      } catch {
        /* 拿不到模型 options 就用默认下拉 */
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // 提交前积分预估(estimate-cost):进入生成视频步、有源视频且非生成中时估一次(口径同「重新生成」replicate)。
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (!ws || !started || vidGenRunning || !sourceVideo.assetId) return
    let alive = true
    setVideoCost((s) => ({ ...s, loading: true, error: '' }))
    const timer = window.setTimeout(async () => {
      try {
        const plans = await resolvePlanCandidates()
        const res: any = await estimateReplicateCost({
          workspaceId: ws,
          sourceVideoDurationSec: sourceVideoDurSec,
          ratio: genRatio,
          durationSec: genDurationSec,
          modelPlanCandidates: plans,
        })
        if (!alive) return
        setVideoCost({
          loading: false,
          error: '',
          estimate: {
            estimatedCost: Number(res?.estimated_cost ?? 0),
            balance: Number(res?.balance ?? 0),
            canAfford: res?.can_afford === true,
          },
        })
      } catch (e: any) {
        if (alive) setVideoCost({ loading: false, error: e?.message || '预估失败', estimate: null })
      }
    }, 500)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, started, vidGenRunning, sourceVideo.assetId, sourceVideoDurSec, genRatio, genDurationSec])

  // 据需求自动命名项目(用户已手动改名 / 需求为空则跳过)
  const autoNameProject = async (req: string) => {
    if (nameTouched || !req.trim()) return
    setNaming(true)
    try {
      nameAbortRef.current?.abort()
      const ctrl = new AbortController()
      nameAbortRef.current = ctrl
      const name = await generateProjectName(req, ctrl.signal)
      if (name && !nameTouched) {
        const next = String(name).trim()
        if (next) {
          pendingAutoTitleRef.current = next
          setProjectName(next)
          const wsId = Number(workspaceId || 0)
          const id = Number(projectIdRef.current || 0)
          if (wsId > 0 && id > 0 && !isUnnamedTitle(next)) {
            serverTitleRef.current = next
            pendingAutoTitleRef.current = ''
            patchCreativeProject({ projectId: id, workspaceId: wsId, title: next, name: next }).catch(() => {
              serverTitleRef.current = ''
              pendingAutoTitleRef.current = next
            })
          }
        }
      }
    } catch {
      /* 命名失败保留原名 */
    } finally {
      setNaming(false)
    }
  }

  // 低层:调 video.replicate 出片,写回当前整片 + 版本库。srcDurSec=源视频真实时长(按它计费)
  const doReplicate = async (
    ws: number,
    videoAssetId: number,
    productIds: number[],
    prompt: string,
    srcDurSec?: number,
    genId?: string | null,
  ): Promise<VideoGenResult> => {
    const validProductIds = (Array.isArray(productIds) ? productIds : []).filter((id) => Number(id) > 0)
    if (!validProductIds.length) {
      throw new Error('未获取到替换素材,请返回上一步重新选择图片')
    }
    const plans = await resolvePlanCandidates()
    vidGenAbortRef.current?.abort()
    const ctrl = new AbortController()
    vidGenAbortRef.current = ctrl
    let activeTaskId = 0
    const tracked = bindRunningVideoPromise(
      replicateHotVideo({
        workspaceId: ws,
        videoAssetId,
        productAssetIds: validProductIds,
        prompt,
        ratio: genRatio,
        durationSec: genDurationSec,
        sourceVideoDurationSec: srcDurSec || sourceVideoDurSec || 0,
        modelPlanCandidates: plans,
        signal: ctrl.signal,
        onTask: (id) => {
          activeTaskId = Number(id || 0) || 0
          setVidGenTaskId(id)
          attachTaskIdToProcessingGen(activeTaskId, genId)
          persistNow({ videoGenerating: true, vidGenTaskId: id }) // 立即落盘 task id,供切换/刷新后续轮询(不丢在途生成)
        },
      }),
    )
    const { url, assetId } = await tracked
    commitGeneratedVideo(
      ws,
      { url, assetId },
      Number(activeTaskId || loadHotCopyDraft(ws)?.vidGenTaskId || vidGenTaskId || 0) || 0,
      genId,
    )
    return { url, assetId }
  }

  // 入口提交:上传本地素材取 asset_id → 直接 video.replicate 出片
  const prepareAndGenerate = async (payload: HotCopyEntryPayload, prompt: string) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成视频', 'error')
      releaseGenTriggerLock()
      return
    }
    setVidGenRunning(true)
    const gid = startGen('生成')
    let aborted = false
    try {
      // ① 源视频 asset_id(素材库已有;本地现传)
      let videoAssetId = 0
      let videoUrl = ''
      if (payload.videoSource === 'library' && payload.libraryVideo) {
        videoAssetId = payload.libraryVideo.assetId
        videoUrl = payload.libraryVideo.src
      } else if (payload.videoSource === 'local' && payload.videoFile) {
        videoAssetId = await uploadHotCopyAsset(ws, payload.videoFile)
        videoUrl = payload.videoPreview
      }
      if (!videoAssetId) throw new Error('爆款视频上传失败,请重试')

      // ② 替换素材图 asset_id(只用图片;素材库已有,本地现传)
      const productIds: number[] = []
      let productFailures = 0
      for (const p of payload.products) {
        if (p.isVideo) continue
        const existingAssetId = Number((p as any).submitAssetId || p.assetId || 0) || 0
        if (existingAssetId) {
          productIds.push(existingAssetId)
          continue
        }
        if (p.file) {
          try {
            const id = await uploadHotCopyAsset(ws, p.file)
            if (id) {
              productIds.push(id)
            } else {
              productFailures++
            }
          } catch {
            productFailures++
          }
        }
      }
      // 所有素材都失败或未提供时,不给后端发空的 productAssetIds——那会导致 replicate 只拿视频没替换图,白白消耗积分。
      if (!productIds.length) {
        throw new Error(
          productFailures > 0
            ? `${productFailures} 张素材图片上传失败,请重试或更换图片`
            : '未获取到替换素材,请至少上传一张图片',
        )
      }
      setSourceVideo({ assetId: videoAssetId, url: videoUrl })
      setProductAssetIds(productIds)
      let productIdCursor = 0
      const nextEntryInitial = buildEntrySnapshot({
        ...payload,
        videoSource: 'library',
        videoFile: null,
        libraryVideo: { assetId: videoAssetId, src: videoUrl },
        videoPreview: videoUrl,
        products: (payload.products || []).map((p) => {
          const submitAssetId = p.isVideo
            ? Number((p as any).submitAssetId || p.assetId || 0) || undefined
            : Number(productIds[productIdCursor++] || (p as any).submitAssetId || p.assetId || 0) || undefined
          return {
            ...p,
            file: null,
            assetId: Number(p.assetId || 0) || undefined,
            submitAssetId,
          }
        }),
      })
      setEntryInitial(nextEntryInitial)
      persistNow({ sourceVideo: { assetId: videoAssetId, url: videoUrl }, productAssetIds: productIds })
      persistNow({ entryInitial: nextEntryInitial })

      // 读源视频真实时长(秒),按它计费(source_video_duration);读不到回退默认 duration
      const srcDur = await readVideoDurationSec(videoUrl)
      if (srcDur) setSourceVideoDurSec(srcDur)

      // ③ 出片
      await doReplicate(ws, videoAssetId, productIds, prompt, srcDur, gid)
      if (aliveRef.current) markGen(gid, 'published')
    } catch (e: any) {
      if (isAbortedTaskError(e)) {
        aborted = true
        const taskId = Number(loadHotCopyDraft(ws)?.vidGenTaskId || vidGenTaskId || 0) || 0
        if (taskId) scheduleResumeVideoTask(ws, taskId)
        return
      }
      if (!aliveRef.current) return
      persistNow({ videoGenerating: false, vidGenTaskId: 0 })
      if (aliveRef.current) {
        if (isTaskCancelled(e)) {
          markGen(gid, 'cancelled')
          showToast('视频生成已中断', 'info')
        } else {
          markGen(gid, 'failed')
          showToast(`视频生成失败:${e?.message || '请重试'}`, 'error')
        }
      }
    } finally {
      releaseGenTriggerLock()
      if (!aborted && aliveRef.current) {
        persistNow({ videoGenerating: false, vidGenTaskId: 0 })
        setVidGenRunning(false)
        setVidGenTaskId(0)
      }
    }
  }

  // VideoStage「重新生成 / 确认修改」:
  //  - opts.edit=true(「确认修改」)且已有整片时:走视频编辑(video.edit,模型 happyhorse-1.0-video-edit),
  //    在已生成的整片基础上按修改意见微调(与智能成片一致),不再用 video.replicate 从源视频重做同款。
  //  - 否则(「重新生成」):基于已上传的源视频 + 替换素材重跑 replicate。
  const regenerate = async (note?: string, opts?: { edit?: boolean }) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成视频', 'error')
      return
    }
    if (!acquireGenTriggerLock()) return

    // 「确认修改」:把当前整片当 video 输入,按修改提示在原视频基础上改
    if (opts?.edit && fullVideo.assetId) {
      setVidGenRunning(true)
      const gid = startGen('确认修改')
      try {
        const plans = await resolvePlanCandidates()
        let activeEditTaskId = 0
        const editPrompt = [
          '请在保留原视频镜头内容、顺序与节奏的前提下,按以下修改要求调整画面(只改提到的部分,其余保持不变):',
          note || '',
        ]
          .filter(Boolean)
          .join('\n')
        const editSrcDur = (await readVideoDurationSec(fullVideo.url)) || sourceVideoDurSec || 0
        const trackedEdit = bindRunningVideoPromise(
          editFullVideo({
            workspaceId: ws,
            videoAssetId: fullVideo.assetId,
            prompt: editPrompt,
            ratio: genRatio,
            durationSec: genDurationSec,
            sourceVideoDurationSec: editSrcDur,
            modelPlanCandidates: plans,
            onTask: (id) => {
              activeEditTaskId = Number(id || 0) || 0
              setVidGenTaskId(id)
              attachTaskIdToProcessingGen(activeEditTaskId, gid)
              persistNow({ videoGenerating: true, vidGenTaskId: id })
            },
          }),
        )
        const { url, assetId } = await trackedEdit
        commitGeneratedVideo(
          ws,
          { url, assetId },
          Number(activeEditTaskId || loadHotCopyDraft(ws)?.vidGenTaskId || vidGenTaskId || 0) || 0,
          gid,
        )
        markGen(gid, 'published')
      } catch (e: any) {
        if (!aliveRef.current) return
        markGen(gid, 'failed')
        showToast(`视频修改失败:${e?.message || '请重试'}`, 'error')
      } finally {
        releaseGenTriggerLock()
        if (aliveRef.current) {
          persistNow({ videoGenerating: false, vidGenTaskId: 0 })
          setVidGenRunning(false)
          setVidGenTaskId(0)
        }
      }
      return
    }

    // 「重新生成」:基于已上传的源视频 + 替换素材重跑 replicate(note=片段/整段修改意见)
    if (!sourceVideo.assetId) {
      showToast('请先上传爆款视频', 'error')
      releaseGenTriggerLock()
      return
    }
    setVidGenRunning(true)
    try {
      const prompt = [basePrompt, note && `修改要求:${note}`].filter(Boolean).join('\n')
      const reSrcDur = sourceVideoDurSec || (await readVideoDurationSec(sourceVideo.url)) || 0
      const gid = startGen('重新生成')
      try {
        await doReplicate(ws, sourceVideo.assetId, productAssetIds, prompt, reSrcDur, gid)
        markGen(gid, 'published')
      } catch (e: any) {
        if (!aliveRef.current) return
        markGen(gid, isTaskCancelled(e) ? 'cancelled' : 'failed')
        throw e
      }
    } catch (e: any) {
      if (!aliveRef.current) return
      showToast(
        isTaskCancelled(e) ? '视频生成已中断' : `视频生成失败:${e?.message || '请重试'}`,
        isTaskCancelled(e) ? 'info' : 'error',
      )
    } finally {
      releaseGenTriggerLock()
      if (aliveRef.current) {
        setVidGenRunning(false)
        setVidGenTaskId(0)
      }
    }
  }

  // 下载视频:弹「另存为」让用户自选保存位置(不支持的浏览器回退自动下载)。
  const handleDownloadVideo = async () => {
    if (!fullVideo.url) {
      showToast('请先生成视频', 'info')
      return
    }
    const safeName = (projectName || '视频').replace(/[\\/:*?"<>|]/g, '').trim() || '视频'
    const d = new Date()
    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const fileName = `${safeName}_${dateStr}.mp4`
    try {
      await downloadToDisk({
        fileName,
        resolveUrl: async () => {
          const ws = Number(workspaceId || 0)
          let url = fullVideo.url
          if (ws && fullVideo.assetId) {
            const fresh = await refreshAssetUrl(ws, fullVideo.assetId)
            if (fresh) url = fresh
          }
          return url
        },
      })
    } catch (e: any) {
      showToast(e?.message || '视频下载失败,请稍后重试', 'error')
    }
  }

  // 入口提交「做同款/生成视频」→ 需登录(免登录可进页面/上传,但生成需登录)
  const handleStart = (payload: HotCopyEntryPayload) => {
    const ws = Number(workspaceId || 0)
    const d = ws ? loadHotCopyDraft(ws) : null
    const pendingTask = Number(d?.vidGenTaskId || 0) || 0
    const hasResult = hasVideoResult(d?.fullVideo, d?.videoVersions)
    if (ws && pendingTask > 0 && !hasResult) {
      void requireAuth(async () => {
        setStarted(true)
        setStep(1)
        setMaxReached(1)
        setBasePrompt(String(d?.basePrompt || ''))
        setProjectName(String(d?.projectName || projectName))
        setNameTouched(Boolean(d?.nameTouched))
        setSourceVideo(d?.sourceVideo && typeof d.sourceVideo === 'object' ? d.sourceVideo : { assetId: 0, url: '' })
        setProductAssetIds(Array.isArray(d?.productAssetIds) ? d.productAssetIds : [])
        setFullVideo(d?.fullVideo && typeof d.fullVideo === 'object' ? d.fullVideo : { url: '', assetId: 0 })
        setVideoVersions(Array.isArray(d?.videoVersions) ? d.videoVersions : [])
        setVideoGenerations(normalizeGenRecords((d as any)?.videoGenerations))
        if (d?.genRatio) setGenRatio(String(d.genRatio))
        if (Number(d?.genDurationSec) > 0) setGenDurationSec(Number(d.genDurationSec))
        showToast('检测到视频正在生成，已为你恢复进度', 'info')
        resumeVideoTask(ws, pendingTask)
      })
      return
    }
    void requireAuth(() => {
      if (!acquireGenTriggerLock()) return
      startGenerate(payload)
    })
  }
  const startGenerate = (payload: HotCopyEntryPayload) => {
    if (!genTriggerLockRef.current) {
      if (!acquireGenTriggerLock()) return
    }
    const prompt = buildBasePrompt(payload.tab, payload.text)
    const nextEntryInitial = buildEntrySnapshot(payload)
    // 先显式置为生成中,再切到视频页,避免首帧短暂落到「暂无视频」占位态。
    setVidGenRunning(true)
    setVidGenTaskId(0)
    setEntryInitial(nextEntryInitial)
    setBasePrompt(prompt)
    // 采用用户在入口选择的成片尺寸/时长(默认竖屏 9:16、15s)
    const pickedRatio = payload.ratio || DEFAULT_RATIO
    const pickedDurSec = Number.parseInt(String(payload.duration || ''), 10) || DEFAULT_DURATION_SEC
    const initialProjectTitle = (() => {
      const current = String(projectName || '').trim()
      if (current && !isUnnamedTitle(current)) return current
      const firstPrompt = String(prompt || '')
        .split(/[;\n]/)
        .map((s) => s.trim())
        .find(Boolean)
      return (firstPrompt || '爆款复制项目').slice(0, 32)
    })()
    setGenRatio(pickedRatio)
    setGenDurationSec(pickedDurSec)
    setStarted(true)
    setStep(1)
    setMaxReached(1)
    setFullVideo({ url: '', assetId: 0 })
    setVideoVersions([])
    setSourceVideo({ assetId: 0, url: '' })
    setProductAssetIds([])
    setVideoGenerations([])
    if (!nameTouched && isUnnamedTitle(projectName)) setProjectName(initialProjectTitle)
    immediateSaveRef.current = false
    // 每次「做同款」是一个新项目:重置后端项目句柄
    projectIdRef.current = 0
    draftRevisionRef.current = 0
    serverTitleRef.current = ''
    setProjectId(0)
    // 立即落一份干净草稿(重置上一次结果),防止刚开始生成就切走时恢复到旧视频
    const ws = Number(workspaceId || 0)
    if (ws) {
      saveHotCopyDraft(ws, {
        entryInitial: nextEntryInitial,
        projectId: 0,
        started: true,
        step: 1,
        maxReached: 1,
        basePrompt: prompt,
        projectName: initialProjectTitle,
        nameTouched,
        sourceVideo: { assetId: 0, url: '' },
        productAssetIds: [],
        fullVideo: { url: '', assetId: 0 },
        videoVersions: [],
        videoGenerating: true,
        vidGenTaskId: 0,
        videoGenerations: [],
        genRatio: pickedRatio, // 用本地刚算出的值(setState 异步,此刻 state 还没更新)
        genDurationSec: pickedDurSec,
      })
      // 建后端项目(best-effort,使其出现在项目管理/视频列表)。
      // 不在此 navigate 到 /hot-copy/:id —— 否则会重挂载组件、打断正在进行的生成;
      // 重开时由 /hot-copy 无 id 分支按本地 projectId 重定向到 /hot-copy/:id 走后端恢复。
      createCreativeProject({ workspace_id: ws, title: initialProjectTitle, name: initialProjectTitle })
        .then((p: any) => {
          const id = resolveProjectId(p)
          if (!id) return
          projectIdRef.current = id
          setProjectId(id)
          serverTitleRef.current = initialProjectTitle
          attachRunningPromiseToProject(id)
          persistNow({ projectId: id }) // 本地记下 projectId,供「无 id 重定向」
          void putHotCopyDraftToBackend() // 立即落一次后端草稿,确保项目可见
          const title = pendingAutoTitleRef.current.trim()
          if (title && !isUnnamedTitle(title)) {
            serverTitleRef.current = title
            pendingAutoTitleRef.current = ''
            patchCreativeProject({ projectId: id, workspaceId: ws, title, name: title }).catch(() => {
              serverTitleRef.current = ''
              pendingAutoTitleRef.current = title
            })
          }
        })
        .catch(() => {})
    }
    void autoNameProject(prompt)
    void prepareAndGenerate(payload, prompt)
  }

  const hotCopyVideoGenerating =
    genTriggerBusy ||
    videoGenerations.some(isActiveProcessingGen) ||
    (vidGenRunning && (vidGenTaskId > 0 || Boolean(runningVideoPromiseRef.current)))

  const canResumeFlow = Boolean(
    entryInitial?.videoPreview ||
    entryInitial?.libraryVideo?.src ||
    (Array.isArray(entryInitial?.products) && entryInitial.products.length > 0) ||
    sourceVideo.url ||
    sourceVideo.assetId ||
    productAssetIds.length > 0 ||
    fullVideo.url ||
    fullVideo.assetId ||
    videoVersions.length > 0 ||
    vidGenRunning ||
    vidGenTaskId > 0 ||
    videoGenerations.length > 0,
  )

  const resumeFlow = () => {
    setStarted(true)
    setStep(1)
    setMaxReached((m) => Math.max(m, 1))
  }

  const resetToNewVideo = () => {
    const ws = Number(workspaceId || 0)
    vidGenAbortRef.current?.abort()
    releaseGenTriggerLock()
    setStarted(false)
    setStep(0)
    setMaxReached(0)
    setBasePrompt('')
    setEntryInitial(undefined)
    setSourceVideo({ assetId: 0, url: '' })
    setProductAssetIds([])
    setFullVideo({ url: '', assetId: 0 })
    setVideoVersions([])
    setVidGenRunning(false)
    setGenTriggerBusy(false)
    setVidGenTaskId(0)
    setVideoGenerations([])
    projectIdRef.current = 0
    draftRevisionRef.current = 0
    serverTitleRef.current = ''
    setProjectId(0)
    setProjectName('未命名项目')
    setNameTouched(false)
    if (ws) clearHotCopyDraft(ws)
    setEntryKey((k) => k + 1)
  }

  const goStep = (i: number) => {
    if (i <= 0) {
      setStarted(false)
      setStep(0)
      return
    }
    const next = Math.min(STEPS.length - 1, i)
    setStarted(true)
    setStep(next)
    setMaxReached((m) => Math.max(m, next))
  }

  const onNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
    else openComingSoon() // 设置/视频编辑/投前预审/数据看板等未上线项:弹全局「功能待开放」弹窗
  }

  const startRename = () => {
    setDraftName(projectName)
    setEditingName(true)
    setTimeout(() => nameInputRef.current?.select(), 0)
  }
  const commitRename = () => {
    const v = draftName.trim()
    if (v) {
      setProjectName(v)
      setNameTouched(true)
    }
    setEditingName(false)
  }

  return (
    <div className="smart">
      <AppSidebar
        activeKey="hot-copy"
        onNavigate={onNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="smart__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        {!started ? (
          <HotCopyEntry
            key={entryKey}
            onSubmit={handleStart}
            onNewVideo={resetToNewVideo}
            busy={genTriggerBusy || vidGenRunning}
            canResume={canResumeFlow}
            onResume={resumeFlow}
            initial={entryInitial}
            ratioOptions={ratioOptions}
          />
        ) : (
          <>
            <button type="button" className="smart__newvideo" onClick={resetToNewVideo}>
              创建新视频
            </button>
            <div className="smart__progress">
              <StepProgress
                steps={STEPS}
                current={step}
                statuses={[
                  '已完成',
                  vidGenRunning || genTriggerBusy ? '视频生成中' : fullVideo.url ? '已完成' : '待生成',
                ]}
                onStepClick={(i) => goStep(i)}
              />
            </div>

            <div className="smart__projbar">
              {editingName ? (
                <input
                  ref={nameInputRef}
                  className="smart__name-input"
                  value={draftName}
                  autoFocus
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                />
              ) : (
                <button type="button" className="smart__name" onClick={startRename} title="点击修改项目名">
                  <span className="smart__name-label">项目</span>
                  <span className="smart__name-text">/{projectName}</span>
                  {naming && <span className="smart__name-naming">AI 命名中…</span>}
                  <img className="smart__name-edit" src={iconProjectEdit} alt="" width={20} height={20} />
                </button>
              )}
            </div>

            <div className="smart__body">
              <VideoStage
                key={`hot-copy-video-stage-${videoStageKey}`}
                shots={[]}
                videoUrl={fullVideo.url}
                videoGenerating={hotCopyVideoGenerating}
                videoStatusText={hotCopyVideoGenerating ? '爆款复制生成中…' : undefined}
                loadingTitle="爆款复制生成中"
                videoStartedAt={videoGenerations.find(isActiveProcessingGen)?.createdAt || 0}
                costEstimate={videoCost.estimate}
                costLoading={videoCost.loading}
                costError={videoCost.error}
                videoVersions={videoVersions}
                failedGenerations={[...videoGenerations]
                  .filter((g) => g.status === 'failed')
                  .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
                  .map((g) => ({ id: g.id, note: g.note, error: g.error, createdAt: g.createdAt }))}
                pendingGenerations={(() => {
                  const processing = [...videoGenerations]
                    .filter(isActiveProcessingGen)
                    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
                  return processing.map((g) => ({
                    id: g.id,
                    createdAt: g.createdAt,
                    // 爆款复制不支持多任务排队；processing 历史统一按「生成中」展示，避免误导成排队态。
                    running: true,
                  }))
                })()}
                pendingVideoCount={videoGenerations.filter(isActiveProcessingGen).length}
                onSwitchVideo={(v) => setFullVideo({ url: v.url, assetId: v.assetId })}
                onRegenerateVideo={(note, opts) => regenerate(note, opts)}
                onDownloadVideo={handleDownloadVideo}
                onPrev={() => goStep(0)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
