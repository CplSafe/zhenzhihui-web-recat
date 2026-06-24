/**
 * HotCopyCreateView — 爆款复制 三步流程编排器(独立于 SmartCreateView)。
 * 流程:上传爆款视频(入口)→ 准备素材(分镜脚本表 + 主体素材)→ 生成视频(整片 + 时间轴 + 片段修改)。
 * 交互/数据契约对齐智能成片,复用 smart 组件与 smart* API;整片用 generateFullVideo(经确认)。
 * v1 不接后端项目 CRUD / 草稿持久化(刷新不保留),作为后续增强。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import StepProgress, { type StepItem } from '@/components/smart/StepProgress'
import ScriptStoryboardTable, { type Shot } from '@/components/smart/ScriptStoryboardTable'
import SubjectAssetDialog from '@/components/smart/SubjectAssetDialog'
import SubjectMaterialBoard from '@/components/smart/SubjectMaterialBoard'
import VideoStage from '@/components/smart/VideoStage'
import HotCopyEntry, { type HotCopyEntryPayload } from '@/components/hotcopy/HotCopyEntry'
import iconProjectEdit from '@/assets/icons/project-edit.svg'
import { Streamdown } from 'streamdown'
import { generateProjectName, refineElementPrompt, refineElementPromptWithImage } from '@/api/aiPolish'
import { generateScriptShotsStream } from '@/api/smartScript'
import { generateShotImage, ensureAssetId, refreshAssetUrl, persistImageAsset } from '@/api/smartShotImage'
import { generateFullVideo, buildTimelinePrompt } from '@/api/smartVideo'
import { blurFacesOnAsset } from '@/api/smartFaceBlur'
import { uploadAssetFile, getAssetDownloadUrl, listAssets, extractAssetPageItems } from '@/api/business'
import {
  useWorkspaceId,
  useModelPlanCandidates,
  useWorkspaceSessionStore,
  deriveModelPlanCandidates,
} from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import './SmartCreateView.css'

// 三步:上传爆款视频(入口)/ 准备素材 / 生成视频
const STEPS: StepItem[] = [
  { key: 'upload', label: '上传爆款视频' },
  { key: 'material', label: '准备素材' },
  { key: 'video', label: '生成视频' },
]
const ACTIVE_STATUS = ['视频上传中', '素材生成中', '视频生成中']

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

const DEFAULT_RATIO = '9:16'
const DEFAULT_DURATION = '10s'
const styleOf = (tab: 'remake' | 'replica') => (tab === 'replica' ? '商业、精准复刻' : '商业、爆款节奏')

const stripAt = (t: string) =>
  String(t || '')
    .replace(/^@/, '')
    .trim()

// 准备素材:每个主体只出「单一独立元素」(供合成时再组合),简洁背景、便于抠图。
function subjectPrompt(name: string, kind: string, style?: string, context?: string) {
  const probe = name + kind
  const frame = /人物|角色|人|男|女|主角|闺蜜|宝妈|宝爸|学生|白领|model|girl|boy/i.test(probe)
    ? '只有一个人物,单人,全身或半身,正面清晰,纯色简洁背景,不要其他人物、不要文字'
    : /场景|街道|背景|环境|室内|室外|校园|店|路|空间|夜景|门口|广场/i.test(probe)
      ? '空场景/空镜,只有环境与背景,无任何人物、无产品,干净简洁'
      : '只有这一个物体,单个产品特写,白色/纯色背景,不要其他物体、不要文字'
  return [
    `只画「${name}」这一个元素`,
    frame,
    context && `需贴合以下广告语境与用途(据此选择最贴切的具体形态,但画面仍只含该单一元素):${context}`,
    style && `${style}视觉风格`,
    '高清,单一主体',
  ]
    .filter(Boolean)
    .join(',')
}

interface HotMeta {
  style: string
  ratio: string
  duration: string
  images: string[]
  imageAssetIds: number[]
}

export default function HotCopyCreateView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
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

  const [started, setStarted] = useState(false) // false=入口(上传爆款视频步), true=进入后续步骤
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [step, setStep] = useState(0) // 0=上传 1=准备素材 2=生成视频
  const [maxReached, setMaxReached] = useState(0)

  // 入口回填(返回上一步用)+ 生成所需的需求/选项
  const [entryInitial, setEntryInitial] = useState<Partial<HotCopyEntryPayload> | undefined>(undefined)
  const [requirement, setRequirement] = useState('')
  const [reqSummary, setReqSummary] = useState('')
  const [entryMeta, setEntryMeta] = useState<HotMeta | null>(null)

  // 项目名(v1 仅本地)
  const [projectName, setProjectName] = useState('未命名项目')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [naming, setNaming] = useState(false)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const nameAbortRef = useRef<AbortController | null>(null)
  const materialFileRef = useRef<HTMLInputElement | null>(null)

  // 分镜脚本
  const [shots, setShots] = useState<Shot[]>([])
  const [scriptLoading, setScriptLoading] = useState(false)
  const [scriptError, setScriptError] = useState('')

  // 主体素材统一管理(同名共享 + 版本库)
  const [subjectAssets, setSubjectAssets] = useState<
    Record<
      string,
      { versions: string[]; prompt?: string; sources?: Record<string, 'ai' | 'upload'>; ids?: Record<string, number> }
    >
  >({})
  const [subjectDlg, setSubjectDlg] = useState<{ open: boolean; name: string; kind: string; autoGen: boolean }>({
    open: false,
    name: '',
    kind: '',
    autoGen: false,
  })
  // 分镜图生成(逐镜进度仅用于内部 setShotGen 追踪,无 ShotArrange 步不读取)
  const [, setShotGen] = useState<Record<string, boolean>>({})
  const [shotGenRunning, setShotGenRunning] = useState(false)
  const autoGenRef = useRef(false)

  // 整片视频
  const [fullVideo, setFullVideo] = useState<{ url: string; assetId: number }>({ url: '', assetId: 0 })
  const [videoVersions, setVideoVersions] = useState<{ url: string; assetId: number }[]>([])
  const [vidGenRunning, setVidGenRunning] = useState(false)
  const autoVidRef = useRef(false)
  const [blurPhase, setBlurPhase] = useState('')
  const [blurDebug, setBlurDebug] = useState<any[]>([])

  // ── 主体素材:同名联动 + 版本库 ──
  const applySubjectImage = (name: string, url: string, assetId = 0) =>
    setShots((prev) =>
      prev.map((sh) => ({
        ...sh,
        subjects: sh.subjects.map((su) => (stripAt(su.tag) === name ? { ...su, image: url, assetId } : su)),
      })),
    )
  const addSubjectVersion = (name: string, url: string, assetId: number, source: 'ai' | 'upload', prompt?: string) => {
    setSubjectAssets((a) => {
      const e = a[name] || { versions: [] }
      return {
        ...a,
        [name]: {
          versions: [...e.versions, url],
          prompt: prompt ?? e.prompt,
          sources: { ...(e.sources || {}), [url]: source },
          ids: { ...(e.ids || {}), [url]: assetId },
        },
      }
    })
    applySubjectImage(name, url, assetId)
  }
  const subjectKindOf = (name: string) => {
    for (const sh of shots) for (const su of sh.subjects) if (stripAt(su.tag) === name && su.kind) return su.kind
    return ''
  }
  const subjectImageOf = (name: string) => {
    for (const sh of shots) for (const su of sh.subjects) if (stripAt(su.tag) === name && su.image) return su.image
    return ''
  }
  const subjectContext = (name: string) => {
    const theme = (reqSummary || requirement || '').slice(0, 80)
    const descs: string[] = []
    for (const sh of shots) {
      if (sh.subjects.some((su) => stripAt(su.tag) === name) && sh.desc) descs.push(sh.desc)
      if (descs.length >= 2) break
    }
    return [theme && `广告主题:${theme}`, descs.length && `该元素出现的画面:${descs.join(';').slice(0, 160)}`]
      .filter(Boolean)
      .join('。')
  }

  // 主体出图(可带参考图 VL 优化 + img2img 底图)
  const genForSubject = async (
    name: string,
    prompt: string,
    opts: { refImageUrl?: string; carryCurrent?: boolean } = {},
  ) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成素材', 'error')
      return
    }
    try {
      const plans = await resolvePlanCandidates()
      let finalPrompt = prompt
      const refAssetIds: number[] = []
      const cache: Record<string, number> = {}
      if (opts.refImageUrl) {
        try {
          finalPrompt = await refineElementPromptWithImage(prompt, opts.refImageUrl, {
            name,
            kind: subjectKindOf(name),
            style: entryMeta?.style,
          })
        } catch {
          /* 优化失败用原提示词 */
        }
        try {
          const id = await ensureAssetId(ws, opts.refImageUrl, cache)
          if (id) refAssetIds.push(id)
        } catch {
          /* ignore */
        }
      }
      if (opts.carryCurrent) {
        const cur = subjectImageOf(name)
        if (cur) {
          try {
            const id = await ensureAssetId(ws, cur, cache)
            if (id) refAssetIds.push(id)
          } catch {
            /* ignore */
          }
        }
      }
      const { url, assetId } = await generateShotImage({
        workspaceId: ws,
        prompt: finalPrompt,
        refAssetIds,
        modelPlanCandidates: plans,
        ratio: entryMeta?.ratio,
        lowRes: true,
      })
      addSubjectVersion(name, url, assetId, 'ai', prompt)
    } catch (e: any) {
      showToast(`素材「${name}」生成失败:${e?.message || '请重试'}`, 'error')
    }
  }
  const uploadForSubject = async (name: string, file: File) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法上传素材', 'error')
      return
    }
    try {
      const out: any = await uploadAssetFile({ workspaceId: ws, file })
      const assetId = Number(out?.asset?.id || 0) || 0
      if (!assetId) throw new Error('未取得素材 asset_id')
      const url = (await getAssetDownloadUrl({ workspaceId: ws, assetId }).catch(() => '')) || ''
      if (!url) throw new Error('未取得素材地址')
      addSubjectVersion(name, url, assetId, 'upload')
    } catch (e: any) {
      showToast(`素材上传失败:${e?.message || '请检查存储配置/网络'}`, 'error')
    }
  }
  // 「添加素材」:上传图片直传后端成 asset,加入 entryMeta.images
  const handleMaterialFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法上传素材', 'error')
      return
    }
    const urls: string[] = []
    const ids: number[] = []
    for (const file of Array.from(files)) {
      try {
        const out: any = await uploadAssetFile({ workspaceId: ws, file })
        const assetId = Number(out?.asset?.id || 0) || 0
        if (!assetId) continue
        const url = (await getAssetDownloadUrl({ workspaceId: ws, assetId }).catch(() => '')) || ''
        if (url) {
          urls.push(url)
          ids.push(assetId)
        }
      } catch {
        /* 单张失败跳过 */
      }
    }
    if (!urls.length) {
      showToast('素材上传失败:请检查存储配置/网络', 'error')
      return
    }
    setEntryMeta((m) =>
      m ? { ...m, images: [...(m.images || []), ...urls], imageAssetIds: [...(m.imageAssetIds || []), ...ids] } : m,
    )
  }
  const openSubject = (name: string, autoGen = false) =>
    setSubjectDlg({ open: true, name, kind: subjectKindOf(name), autoGen })

  // 某镜头无主体素材时,点「上传图片」给它加一个占位主体并打开素材弹窗
  const addShotMaterial = (shot: Shot) => {
    const used = new Set<string>()
    shots.forEach((sh) => sh.subjects.forEach((su) => used.add(stripAt(su.tag))))
    let name = '素材'
    let k = 1
    while (used.has(name)) name = `素材${++k}`
    setShots((prev) =>
      prev.map((sh) => (sh.id === shot.id ? { ...sh, subjects: [...sh.subjects, { tag: `@${name}`, kind: '' }] } : sh)),
    )
    openSubject(name)
  }

  // 后端"上传类"asset id 集合,用于区分 上传/AI(projectImages 分类)
  const [uploadAssetIds, setUploadAssetIds] = useState<Set<number>>(new Set())
  useEffect(() => {
    const ws = Number(workspaceId || 0)
    if (!ws || !started) return
    let cancelled = false
    listAssets({ workspaceId: ws, type: 'image', limit: 300 })
      .then((payload: any) => {
        if (cancelled) return
        const ids = new Set<number>()
        extractAssetPageItems(payload).forEach((a: any) => {
          if (String(a?.source || '') === 'upload' && Number(a?.id)) ids.add(Number(a.id))
        })
        setUploadAssetIds(ids)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspaceId, started, subjectAssets, entryMeta])

  const urlAssetId = (() => {
    const map = new Map<string, number>()
    ;(entryMeta?.images || []).forEach((u: string, i: number) => {
      const id = Number(entryMeta?.imageAssetIds?.[i] || 0)
      if (u && id) map.set(u, id)
    })
    Object.values(subjectAssets).forEach((e: any) =>
      Object.entries(e?.ids || {}).forEach(([u, id]: any) => {
        if (Number(id)) map.set(u, Number(id))
      }),
    )
    shots.forEach((sh) => {
      if (sh.image && sh.imageAssetId) map.set(sh.image, Number(sh.imageAssetId))
    })
    return map
  })()

  const projectImages: { url: string; source: 'ai' | 'upload'; assetId?: number }[] = (() => {
    const classify = (url: string, guess: 'ai' | 'upload'): 'ai' | 'upload' => {
      const id = urlAssetId.get(url)
      if (id && uploadAssetIds.has(id)) return 'upload'
      if (id && uploadAssetIds.size) return 'ai'
      return guess
    }
    const m = new Map<string, 'ai' | 'upload'>()
    ;(entryMeta?.images || []).forEach((u: string) => u && m.set(u, classify(u, 'upload')))
    Object.values(subjectAssets).forEach((e: any) =>
      (e?.versions || []).forEach((u: string) => {
        if (u) m.set(u, classify(u, e?.sources?.[u] || 'upload'))
      }),
    )
    shots.forEach((sh) => {
      if (sh.image) m.set(sh.image, classify(sh.image, 'ai'))
    })
    return [...m.entries()]
      .filter(([u]) => /^(https?:|data:)/.test(u))
      .map(([url, source]) => ({ url, source, assetId: urlAssetId.get(url) || 0 }))
  })()

  // ── 分镜图生成(画面描述 + 该镜素材 + 上一张连贯)──
  const genShotFrame = async (
    ws: number,
    sh: Shot,
    prevUrl: string,
    cache: Record<string, number>,
    plans: string[],
  ) => {
    const elUrls = Array.from(new Set(sh.subjects.map((s) => s.image).filter(Boolean))) as string[]
    const refIds: number[] = []
    for (const u of elUrls) {
      try {
        const id = await ensureAssetId(ws, u, cache)
        if (id) refIds.push(id)
      } catch {
        /* 单张参考上传失败则跳过 */
      }
    }
    const baseUrl = prevUrl
    if (baseUrl) {
      try {
        const id = await ensureAssetId(ws, baseUrl, cache)
        if (id) refIds.push(id)
      } catch {
        /* ignore */
      }
    }
    const elNames = Array.from(new Set(sh.subjects.map((s) => stripAt(s.tag)).filter(Boolean))).join('、')
    const prompt = [
      sh.desc,
      elNames && `画面主体仅含:${elNames}(不要出现其它无关物体)`,
      entryMeta?.style && `${entryMeta.style}风格`,
      prevUrl && '与上一镜头保持人物形象、场景、配色、画风一致',
      '画面比例 ' + (entryMeta?.ratio || DEFAULT_RATIO),
    ]
      .filter(Boolean)
      .join(';')
    const r = await generateShotImage({
      workspaceId: ws,
      prompt,
      refAssetIds: refIds,
      modelPlanCandidates: plans,
      ratio: entryMeta?.ratio,
    })
    const url = r.url
    const assetId = Number(r.assetId || 0) || 0
    setShots((prev) =>
      prev.map((x) =>
        x.id === sh.id
          ? {
              ...x,
              image: url,
              imageAssetId: assetId,
              imagePrompt: prompt,
              isNew: false,
              imageVersions: [...(x.imageVersions || []), { url, assetId, prompt, refs: elUrls }],
            }
          : x,
      ),
    )
    // 出图即脱敏,结果缓存到分镜供出视频直接复用(失败静默,不阻塞)
    if (assetId) {
      try {
        const blur = await blurFacesOnAsset({ workspaceId: ws, assetId, modelPlanCandidates: plans })
        if (blur.ok && blur.assetId) {
          setShots((prev) =>
            prev.map((x) =>
              x.id === sh.id
                ? { ...x, blurredImageUrl: blur.url, blurredImageAssetId: blur.assetId, blurredFromAssetId: assetId }
                : x,
            ),
          )
        }
      } catch {
        /* ignore */
      }
    }
    return url
  }

  // 串行生成全部分镜图
  const generateShotImages = async (list: Shot[] = shots) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成分镜图', 'error')
      return
    }
    if (shotGenRunning) return
    setShotGenRunning(true)
    const cache: Record<string, number> = {}
    const plans = await resolvePlanCandidates()
    let prevUrl = ''
    try {
      for (const sh of list) {
        setShotGen((m) => ({ ...m, [sh.id]: true }))
        try {
          prevUrl = await genShotFrame(ws, sh, prevUrl, cache, plans)
        } catch (e: any) {
          showToast(`分镜「${sh.no}」生成失败:${e?.message || ''}`, 'error')
        } finally {
          setShotGen((m) => ({ ...m, [sh.id]: false }))
        }
      }
    } finally {
      setShotGenRunning(false)
    }
  }

  // ── 整片视频生成(脱敏后喂 generateFullVideo)──
  const runFullVideo = async (note?: string) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成视频', 'error')
      return
    }
    if (!shots.length) {
      showToast('暂无分镜,无法生成视频', 'error')
      return
    }
    if (vidGenRunning) return
    const activeShots = shots.filter((s) => s.includeInVideo !== false)
    if (!activeShots.length) {
      showToast('请至少勾选一个分镜参与视频生成', 'error')
      return
    }
    setVidGenRunning(true)
    try {
      const plans = await resolvePlanCandidates()
      const cache: Record<string, number> = {}
      const srcIds: { shotId: string | number; id: number }[] = []
      for (const sh of activeShots) {
        let id = Number(sh.imageAssetId || 0) || 0
        if (!id && sh.image) {
          try {
            id = await ensureAssetId(ws, sh.image, cache)
          } catch {
            /* 单张失败跳过 */
          }
        }
        if (id) srcIds.push({ shotId: sh.id, id })
      }
      const dbg: any[] = []
      const imageAssetIds: number[] = []
      const blurPatch: Record<string, Partial<Shot>> = {}
      for (let i = 0; i < srcIds.length; i++) {
        const { shotId, id } = srcIds[i]
        const sh = shots.find((s) => s.id === shotId)
        setBlurPhase(`人脸脱敏 ${i + 1}/${srcIds.length}…`)
        if (sh?.blurredImageAssetId && Number(sh.blurredFromAssetId || 0) === id) {
          imageAssetIds.push(Number(sh.blurredImageAssetId))
          dbg.push({
            no: sh.no,
            srcAssetId: id,
            cached: true,
            outAssetId: sh.blurredImageAssetId,
            outUrl: sh.blurredImageUrl,
            ok: true,
          })
          continue
        }
        const r = await blurFacesOnAsset({ workspaceId: ws, assetId: id, modelPlanCandidates: plans })
        dbg.push({ no: sh?.no || '', ...r.debug, ok: r.ok, cached: false })
        if (r.ok && r.assetId) {
          imageAssetIds.push(r.assetId)
          blurPatch[String(shotId)] = { blurredImageUrl: r.url, blurredImageAssetId: r.assetId, blurredFromAssetId: id }
        } else {
          imageAssetIds.push(id)
        }
      }
      setBlurDebug(dbg)
      if (Object.keys(blurPatch).length) {
        setShots((prev) => prev.map((s) => (blurPatch[String(s.id)] ? { ...s, ...blurPatch[String(s.id)] } : s)))
      }
      setBlurPhase('')
      const { url, assetId } = await generateFullVideo({
        workspaceId: ws,
        shots: activeShots,
        basePrompt: reqSummary || requirement,
        ratio: entryMeta?.ratio,
        style: entryMeta?.style,
        imageAssetIds,
        note,
        modelPlanCandidates: plans,
      })
      setFullVideo({ url, assetId })
      setVideoVersions((prev) => [...prev, { url, assetId }])
    } catch (e: any) {
      showToast(`视频生成失败:${e?.message || ''}`, 'error')
    } finally {
      setBlurPhase('')
      setVidGenRunning(false)
    }
  }

  // 进入「生成视频」:先自动补齐缺失分镜图(无 ShotArrange 步)
  useEffect(() => {
    if (step !== 2 || !shots.length || shotGenRunning) return
    if (autoGenRef.current) return
    if (shots.some((s) => s.image)) return
    autoGenRef.current = true
    void generateShotImages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shots])

  // 分镜图就绪后自动合成整片(一次)
  useEffect(() => {
    if (step !== 2 || !shots.length || vidGenRunning || shotGenRunning) return
    if (autoVidRef.current) return
    if (fullVideo.url) return
    if (!shots.some((s) => s.image)) return
    autoVidRef.current = true
    void runFullVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shots, shotGenRunning])

  // 同名主体素材联动 + 纳入版本库
  useEffect(() => {
    const imgByName = new Map<string, { url: string; assetId: number }>()
    shots.forEach((sh) =>
      sh.subjects.forEach((su) => {
        const n = stripAt(su.tag)
        if (su.image && !imgByName.has(n)) imgByName.set(n, { url: su.image, assetId: Number(su.assetId || 0) || 0 })
      }),
    )
    Object.entries(subjectAssets).forEach(([name, e]: any) => {
      if (imgByName.has(name)) return
      const vs: string[] = e?.versions || []
      const last = vs[vs.length - 1]
      if (last) imgByName.set(name, { url: last, assetId: e?.ids?.[last] || 0 })
    })
    let shotsChanged = false
    const nextShots = shots.map((sh) => {
      let touched = false
      const subjects = sh.subjects.map((su) => {
        const got = imgByName.get(stripAt(su.tag))
        if (got && !su.image) {
          touched = true
          return { ...su, image: got.url, assetId: got.assetId }
        }
        return su
      })
      if (touched) {
        shotsChanged = true
        return { ...sh, subjects }
      }
      return sh
    })
    if (shotsChanged) {
      setShots(nextShots)
      return
    }
    setSubjectAssets((prev) => {
      let changed = false
      const next = { ...prev }
      imgByName.forEach((got, n) => {
        const img = got.url
        const e = next[n] || { versions: [] }
        if (!e.versions.includes(img)) {
          next[n] = {
            versions: [...e.versions, img],
            prompt: e.prompt,
            sources: { ...(e.sources || {}), [img]: e.sources?.[img] || 'upload' },
            ids: { ...(e.ids || {}), [img]: got.assetId },
          }
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [shots, subjectAssets])

  // 生成分镜脚本(流式)
  const generateScript = async (req: string, meta: HotMeta) => {
    // 重新生成等入口可能传入空原文,这里兜底成通用需求(展示用的「我的描述」仍是原文)
    const genReq = req?.trim() || '为该产品制作一条爆款短视频广告'
    setScriptLoading(true)
    setScriptError('')
    setShots([])
    autoGenRef.current = false
    autoVidRef.current = false
    let got = 0
    try {
      const result = await generateScriptShotsStream(
        { requirement: genReq, style: meta.style, ratio: meta.ratio, duration: meta.duration, images: meta.images },
        (partial) => {
          got = partial.length
          setShots(partial)
        },
      )
      setShots(result)
    } catch (e: any) {
      if (!got) setScriptError(e?.message || '脚本生成失败,请重试')
    } finally {
      setScriptLoading(false)
    }
  }

  // 自动命名项目(本地模型,best-effort)
  const autoNameProject = async (reqArg?: string) => {
    const req = (reqArg ?? requirement).trim()
    if (!req || nameTouched || naming) return
    nameAbortRef.current?.abort()
    const ctrl = new AbortController()
    nameAbortRef.current = ctrl
    setNaming(true)
    try {
      const nm = await generateProjectName(req, ctrl.signal)
      if (!nameTouched) setProjectName(nm)
    } catch {
      /* 命名失败保留原名 */
    } finally {
      setNaming(false)
    }
  }

  // 入口发送 → 进入「准备素材」,生成分镜脚本
  const handleStart = (payload: HotCopyEntryPayload) => {
    // 我的描述展示用户原文(可能为空);生成脚本用 genReq(空时才兜底,不污染展示)
    const raw = payload.text
    const genReq = raw.trim() || `为该产品制作一条${payload.tab === 'replica' ? '精准复刻' : '同款翻拍'}爆款短视频广告`
    const imgs = payload.products.filter((p) => !p.isVideo).map((p) => p.url)
    const meta: HotMeta = {
      style: styleOf(payload.tab),
      ratio: DEFAULT_RATIO,
      duration: DEFAULT_DURATION,
      images: imgs,
      imageAssetIds: [],
    }
    setEntryInitial(payload)
    setRequirement(raw)
    setReqSummary(genReq)
    setEntryMeta(meta)
    setStarted(true)
    setStep(1)
    setMaxReached(1)
    setShots([])
    setScriptError('')
    setFullVideo({ url: '', assetId: 0 })
    setVideoVersions([])
    autoGenRef.current = false
    autoVidRef.current = false
    if (raw.trim()) void autoNameProject(genReq)
    // 替换素材图片落库成 asset(否则刷新/出图取不到 asset_id)
    const wsId = Number(workspaceId || 0)
    if (wsId && imgs.length) {
      void (async () => {
        const cache: Record<string, number> = {}
        const urls: string[] = []
        const ids: number[] = []
        for (const u of imgs) {
          try {
            const out = await persistImageAsset(wsId, u, cache)
            urls.push(out.url)
            ids.push(out.assetId || 0)
          } catch {
            urls.push(u)
            ids.push(0)
          }
        }
        setEntryMeta((m) => (m ? { ...m, images: urls, imageAssetIds: ids } : m))
      })()
    }
    void generateScript(genReq, meta)
  }

  // 下载整片
  const handleDownloadVideo = async () => {
    if (!fullVideo.url) {
      showToast('请先生成视频', 'info')
      return
    }
    const ws = Number(workspaceId || 0)
    let url = fullVideo.url
    if (ws && fullVideo.assetId) {
      const fresh = await refreshAssetUrl(ws, fullVideo.assetId)
      if (fresh) url = fresh
    }
    const fileName = `${(projectName || '视频').replace(/[\\/:*?"<>|]/g, '').trim() || '视频'}.mp4`
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch {
      window.open(url, '_blank')
    }
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

  // 底部按钮
  const bottomButtons = (() => {
    switch (step) {
      case 1: // 准备素材
        return [
          { label: '上一步', variant: 'ghost' as const, action: () => goStep(0) },
          {
            label: '生成视频',
            variant: 'primary' as const,
            action: () => {
              autoGenRef.current = false
              autoVidRef.current = false
              goStep(2)
            },
            disabled: scriptLoading || !shots.length,
          },
        ]
      default:
        return []
    }
  })()

  const renderStepBody = () => {
    if (step === 1) {
      // 准备素材:我的描述 + 用户素材 + 分镜表(含主体「AI自动生成 / 上传图片」)
      const promptText = requirement || '（未填写需求）'
      return (
        <div className="smart__script">
          <div className="smart__prompt-label">我的描述：</div>
          <div className="smart__prompt smart__md">
            <Streamdown>{promptText}</Streamdown>
          </div>

          <SubjectMaterialBoard
            subjects={[]}
            uploads={entryMeta?.images || []}
            onAdd={() => materialFileRef.current?.click()}
            onOpen={(name) => openSubject(name)}
          />
          <input
            ref={materialFileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              handleMaterialFiles(e.target.files)
              e.target.value = ''
            }}
          />

          <div className="smart__script-done">
            <span className="smart__script-done-icon" aria-hidden="true">
              💡
            </span>
            {scriptLoading ? '分镜脚本生成中…' : scriptError ? '分镜脚本生成失败' : '分镜脚本生成完成'}
          </div>
          {shots.length ? (
            <>
              <ScriptStoryboardTable
                shots={shots}
                showSubjects
                onAddMaterial={addShotMaterial}
                onOpenSubject={openSubject}
                onShotsChange={setShots}
              />
              {scriptLoading && (
                <div className="smart__gen-hint">
                  <span className="smart__gen-spin" aria-hidden="true" />
                  分镜持续生成中…
                </div>
              )}
            </>
          ) : scriptLoading ? (
            <div className="smart__placeholder smart__placeholder--sm">正在根据创作需求生成分镜脚本…</div>
          ) : scriptError ? (
            <div className="smart__script-error">
              {scriptError}
              <button
                type="button"
                className="smart__btn smart__btn--primary"
                onClick={() => entryMeta && generateScript(requirement, entryMeta)}
              >
                重新生成
              </button>
            </div>
          ) : (
            <div className="smart__placeholder smart__placeholder--sm">暂无分镜</div>
          )}
        </div>
      )
    }
    // step === 2 生成视频
    return (
      <VideoStage
        shots={shots}
        videoUrl={fullVideo.url}
        videoGenerating={vidGenRunning || shotGenRunning}
        videoStatusText={shotGenRunning ? '分镜图生成中…' : blurPhase || undefined}
        faceBlurDebug={blurDebug}
        videoVersions={videoVersions}
        onSwitchVideo={(v) => setFullVideo({ url: v.url, assetId: v.assetId })}
        onRegenerateVideo={runFullVideo}
        onSaveVideo={() => (fullVideo.url ? showToast('视频已保存', 'success') : showToast('请先生成视频', 'info'))}
        onDownloadVideo={handleDownloadVideo}
        onPrev={() => goStep(1)}
        debug={{
          prompt: buildTimelinePrompt({
            shots,
            basePrompt: reqSummary || requirement,
            ratio: entryMeta?.ratio,
            style: entryMeta?.style,
          }),
          firstImage: shots.find((s) => s.image)?.image || '',
          shots: shots.map((s) => ({
            no: s.no,
            duration: s.duration,
            desc: s.desc,
            line: s.line,
            subtitle: s.subtitle,
            sfx: s.sfx,
            image: s.image,
          })),
        }}
      />
    )
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
        <AppTopbar onMenu={() => setSidebarOpen(true)} onMember={() => showToast('会员中心待开放', 'info')} />

        {!started ? (
          <HotCopyEntry onSubmit={handleStart} initial={entryInitial} />
        ) : (
          <>
            <div className="smart__progress">
              <StepProgress
                steps={STEPS}
                current={step}
                statuses={[
                  started ? '已完成' : '待生成',
                  scriptLoading ? ACTIVE_STATUS[1] : shots.length ? '已完成' : step === 1 ? ACTIVE_STATUS[1] : '待生成',
                  vidGenRunning || shotGenRunning ? ACTIVE_STATUS[2] : fullVideo.url ? '已完成' : '待生成',
                ]}
                maxReached={maxReached}
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

            <div className="smart__body">{renderStepBody()}</div>

            {bottomButtons.length > 0 && (
              <footer className="smart__footer">
                <div className="smart__footer-inner">
                  {/* 与智能成片一致:左右分组,按钮默认靠右(footer-inner 用 space-between) */}
                  {(['left', 'right'] as const).map((side) => (
                    <div className="smart__footer-group" key={side}>
                      {bottomButtons
                        .filter((b) => ((b as any).align ?? 'right') === side)
                        .map((b) => (
                          <button
                            key={b.label}
                            type="button"
                            className={`smart__btn smart__btn--${b.variant}`}
                            onClick={b.action}
                            disabled={b.disabled}
                          >
                            {b.label}
                          </button>
                        ))}
                    </div>
                  ))}
                </div>
              </footer>
            )}
          </>
        )}
      </div>

      <SubjectAssetDialog
        open={subjectDlg.open}
        name={subjectDlg.name}
        kind={subjectDlg.kind}
        currentImage={subjectImageOf(subjectDlg.name)}
        versions={subjectAssets[subjectDlg.name]?.versions || []}
        defaultPrompt={
          subjectAssets[subjectDlg.name]?.prompt ||
          subjectPrompt(subjectDlg.name, subjectDlg.kind, entryMeta?.style, subjectContext(subjectDlg.name))
        }
        autoGen={subjectDlg.autoGen}
        refinePrompt={
          subjectAssets[subjectDlg.name]?.prompt
            ? undefined
            : (intent: string) =>
                refineElementPrompt(intent, { name: subjectDlg.name, kind: subjectDlg.kind, style: entryMeta?.style })
        }
        projectImages={projectImages}
        onClose={() => setSubjectDlg((d) => ({ ...d, open: false }))}
        onGenerate={(p, opts) => genForSubject(subjectDlg.name, p, opts)}
        onSelect={(url) => applySubjectImage(subjectDlg.name, url, subjectAssets[subjectDlg.name]?.ids?.[url] || 0)}
        onUpload={(file) => uploadForSubject(subjectDlg.name, file)}
      />
    </div>
  )
}
