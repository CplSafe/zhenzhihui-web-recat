/**
 * 智能成片 2.1 流程壳子（P0）。
 * 提供:左侧导航 + 顶栏 + 新进度条 + 项目名(可改名) + 各步占位内容 + 各步底部总按钮。
 * 流程:分镜脚本 → 准备素材 → 镜头编排 → 视频生成。
 * 各步具体内容(脚本编辑/素材匹配/镜头编排/视频生成)在后续阶段填充,
 * 大量编排逻辑可复用现有 useCreativeWorkflow / useStoryboard* / useVideoGeneration。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import StepProgress, { type StepItem } from '@/components/smart/StepProgress'
import SmartEntry, { type EntryMeta } from '@/components/smart/SmartEntry'
import ScriptStoryboardTable, { type Shot } from '@/components/smart/ScriptStoryboardTable'
import SubjectAssetDialog from '@/components/smart/SubjectAssetDialog'
import SubjectMaterialBoard from '@/components/smart/SubjectMaterialBoard'
import ShotArrange from '@/components/smart/ShotArrange'
import ImageChat, { type ChatMessage } from '@/components/smart/ImageChat'
import iconProjectEdit from '@/assets/icons/project-edit.svg'
import { Streamdown } from 'streamdown'
import {
  generateProjectName,
  summarizeRequirement,
  refineElementPrompt,
  refineElementPromptWithImage,
  refineShotPrompt,
  polishText,
  skillBreakdown,
} from '@/api/aiPolish'
import { generateScriptShotsStream, generateShotInfo } from '@/api/smartScript'
import { generateShotImage, ensureAssetId, refreshAssetUrl, persistImageAsset } from '@/api/smartShotImage'
import { generateFullVideo, editFullVideo, buildTimelinePrompt, totalDurationSec } from '@/api/smartVideo'
import { blurFacesOnAsset } from '@/api/smartFaceBlur'
import VideoStage from '@/components/smart/VideoStage'
import {
  createCreativeProject,
  patchCreativeProject,
  getCreativeProject,
  updateCreativeProjectDraft,
  uploadAssetFile,
  getAssetDownloadUrl,
  listAssets,
  extractAssetPageItems,
} from '@/api/business'
import {
  useWorkspaceId,
  useModelPlanCandidates,
  useWorkspaceSessionStore,
  deriveModelPlanCandidates,
} from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import {
  saveSmartDraft,
  clearSmartDraft,
  buildSmartSnapshot,
  parseSmartSnapshot,
  type SmartDraft,
} from '@/utils/smartDraft'
import { downloadToDisk } from '@/utils/downloadToDisk'
import './SmartCreateView.css'

// 素材在分镜脚本步已准备,去掉「准备素材」步,流程:分镜脚本 → 镜头编排 → 生成视频
const STEPS: StepItem[] = [
  { key: 'script', label: '分镜脚本' },
  { key: 'material', label: '准备素材' },
  { key: 'shots', label: '镜头编排' },
  { key: 'video', label: '生成视频' },
]
// 各步「当前进行中」时的子状态文案(进度条展示)
const ACTIVE_STATUS = ['脚本生成中', '素材上传中', '镜头编排中', '视频生成中']
// 选中 SKILL 时,在最前面多出的「营销思路拆解」步
const MARKETING_STEP: StepItem = { key: 'marketing', label: '营销思路拆解' }

// 从 createCreativeProject 返回里取项目 id(字段名后端不统一,做兜底)
function resolveProjectId(payload: any): number {
  const id = Number([payload?.id, payload?.project?.id, payload?.data?.id].find((v) => Number(v) > 0) || 0)
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
}

// 是否「未命名」标题(对齐 Vue isUnnamedProjectTitle):空 或 含「未命名」都视为未命名
function isUnnamedTitle(title: string): boolean {
  const t = String(title || '').trim()
  return !t || t.includes('未命名')
}

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

interface BottomButton {
  label: string
  variant: 'ghost' | 'primary' | 'text'
  action: () => void
  disabled?: boolean
  icon?: ReactNode
  /** 底栏对齐:重新生成靠左,其余靠右(默认右) */
  align?: 'left' | 'right'
}

const stripAt = (t: string) =>
  String(t || '')
    .replace(/^@/, '')
    .trim()

// 准备素材:每个主体只出「单一独立元素」(供镜头编排时再组合),简洁背景、便于抠图合成。
// context = 广告主题 + 该元素出现的画面语境/用途,帮模型选对具体形态(如伞广告里的「地铁站」应是雨天出入口而非大厅)。
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

/**
 * 兜底:从后端项目 draft_json 里抽取「整片视频」(最近一版 + 历史版本)。
 * 用于智能成片快照(obj.smart)里没有整片视频、但视频结果由后端写到了项目级字段
 * (generatedVideoUrl / videoHistoryList,常见于上次在「生成视频」中途切走、完成时组件已卸载)
 * 的场景——和项目管理页读取同一批字段,保证「生成视频」步骤能把视频加载出来。
 */
function extractProjectVideoFallback(draftJson: any): {
  latest: { url: string; assetId: number }
  versions: { url: string; assetId: number }[]
} {
  let obj = draftJson
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return { latest: { url: '', assetId: 0 }, versions: [] }
    }
  }
  if (!obj || typeof obj !== 'object') return { latest: { url: '', assetId: 0 }, versions: [] }
  const smart = obj.smart && typeof obj.smart === 'object' ? obj.smart : obj
  const vv = Array.isArray(smart?.videoVersions) ? smart.videoVersions : []
  const vh = Array.isArray(obj?.videoHistoryList || obj?.video_history_list)
    ? obj.videoHistoryList || obj.video_history_list
    : []
  const src = vv.length ? vv : vh
  const versions: { url: string; assetId: number }[] = []
  for (const v of src) {
    const url = String((typeof v === 'string' ? v : v?.url || v?.src) || '').trim()
    const assetId = Number((typeof v === 'string' ? 0 : v?.assetId || v?.asset_id) || 0) || 0
    if (url || assetId) versions.push({ url, assetId })
  }
  const gvUrl = String(obj?.generatedVideoUrl || obj?.generated_video_url || smart?.fullVideoUrl || '').trim()
  const gvId = Number(obj?.generatedVideoAssetId || obj?.generated_video_asset_id || smart?.fullVideoAssetId || 0) || 0
  if (!versions.length && (gvUrl || gvId)) versions.push({ url: gvUrl, assetId: gvId })
  const latest = versions.length ? versions[versions.length - 1] : { url: gvUrl, assetId: gvId }
  return { latest: { url: latest.url || '', assetId: latest.assetId || 0 }, versions }
}

export default function SmartCreateView() {
  const navigate = useNavigate()
  const { id: routeId } = useParams()
  const { showToast } = useToast()
  const workspaceId = useWorkspaceId()
  const modelPlanCandidates = useModelPlanCandidates() as string[]
  const ensureModelPlanCandidatesLoaded = useWorkspaceSessionStore((s) => s.ensureModelPlanCandidatesLoaded)

  // 生成前确保工作空间真实套餐候选已加载,并读最新值(否则只有默认候选,列不到付费套餐里的 seedance/seedream)。
  // 与 2.0 useVideoGeneration 一致:先 ensure,再用 getState 读最新,避免闭包拿到旧的 modelPlanCandidates。
  const resolvePlanCandidates = async (): Promise<string[]> => {
    try {
      await ensureModelPlanCandidatesLoaded()
    } catch {
      /* 加载失败则退回当前已有候选 */
    }
    return (deriveModelPlanCandidates(useWorkspaceSessionStore.getState()) as string[]) || modelPlanCandidates
  }

  const [started, setStarted] = useState(false) // false=入口输入页, true=进入 4 步流程
  const [entryKey, setEntryKey] = useState(0) // 「制作新视频」自增 → 重挂载入口页,清空其内部输入状态
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [entryMeta, setEntryMeta] = useState<EntryMeta | null>(null)
  // ── 制作图片(chat 形式):消息流。image 模式不走分镜/视频 4 步,改为对话出图 ──
  const [imageMessages, setImageMessages] = useState<ChatMessage[]>([])
  const msgIdRef = useRef(0)
  const nextMsgId = () => `m${++msgIdRef.current}-${Date.now()}`
  const imgMsgHydratedRef = useRef(false)
  // 是否处于「制作图片」对话模式;有一轮正在出图(禁用发送)
  const isImageMode = entryMeta?.mode === 'image'
  const imageBusy = imageMessages.some((m) => m.role === 'assistant' && m.status === 'pending')
  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const [projectName, setProjectName] = useState('未命名项目')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [nameTouched, setNameTouched] = useState(false) // 用户手动改过名后不再自动覆盖
  const [naming, setNaming] = useState(false)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const materialFileRef = useRef<HTMLInputElement | null>(null)

  // 第一步:用户输入的创作需求(后续用于生成分镜脚本 + 自动命名项目)
  const [requirement, setRequirement] = useState('')
  const [reqSummary, setReqSummary] = useState('') // ≤100字核心摘要,仅用于生成(basePrompt/大纲),不再展示
  const nameAbortRef = useRef<AbortController | null>(null)

  // ── 营销思路拆解(选中 SKILL 时,在分镜脚本前多出的第 1 步)──
  // marketingOpen=停留在该步;marketingText=skill 拆解出的营销建议(只读展示);确认后才进入分镜脚本流程。
  const [marketingOpen, setMarketingOpen] = useState(false)
  const [marketingText, setMarketingText] = useState('')
  const [marketingLoading, setMarketingLoading] = useState(false)
  const [marketingError, setMarketingError] = useState('')

  // 分镜脚本(后端 /ai/responses 生成)
  const [shots, setShots] = useState<Shot[]>([])
  const [scriptLoading, setScriptLoading] = useState(false)
  const [scriptError, setScriptError] = useState('')
  const [projectId, setProjectId] = useState(0)
  const projectIdRef = useRef(0)
  // 后端当前的项目标题(对齐 Vue serverProjectTitle):用于判断是否需要回写、避免覆盖已有真实标题
  const serverTitleRef = useRef('')
  const draftRevisionRef = useRef(0) // 后端草稿版本号(乐观并发)

  // ── 主体素材统一管理:同名主体(@闺蜜A)共享素材,选定后所有同名处联动 ──
  // 版本/提示词存 registry;选定的图写回所有同名 subject(供表格 + 镜头编排一致展示)
  // 版本图 url + 其 asset_id(ids[url]=assetId,用于刷新签名URL/持久化,见 hydrate)
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
  // 把某元素的选定图(url+assetId)写回所有同名 subject
  const applySubjectImage = (name: string, url: string, assetId = 0) =>
    setShots((prev) =>
      prev.map((sh) => ({
        ...sh,
        subjects: sh.subjects.map((su) => (stripAt(su.tag) === name ? { ...su, image: url, assetId } : su)),
      })),
    )
  // 把生成/上传的图落库(dataURL→后端 asset,得签名URL+assetId),写入版本库 + 同名联动
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
  // 素材出图:
  //  - carryCurrent=true(修改):带上当前这张图作 img2img 底图,在其基础上改;
  //  - carryCurrent=false(重新生成):不带当前图,从头生成;
  //  - refImageUrl(参考图,产品真实照片):VL 读图优化提示词 + 作图生图参考(保证用你的产品)。
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
      // 参考图:VL 优化提示词 + 作参考
      if (opts.refImageUrl) {
        try {
          finalPrompt = await refineElementPromptWithImage(prompt, opts.refImageUrl, {
            name,
            kind: subjectKindOf(name),
            style: entryMeta?.style,
          })
        } catch {
          /* 优化失败则用原提示词 */
        }
        try {
          const id = await ensureAssetId(ws, opts.refImageUrl, cache)
          if (id) refAssetIds.push(id)
        } catch {
          /* ignore */
        }
      }
      // 修改:把当前这张图作底图(img2img)
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
  // 上传素材:直接把 File 经后端 uploadAssetFile 存到服务器,拿 asset_id + 签名URL(失败明确报错)
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
  // 脚本步「添加素材」:上传图片直传后端成 asset,加入 entryMeta.images(与入口上传同一来源)
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
    setEntryMeta((m: any) =>
      m ? { ...m, images: [...(m.images || []), ...urls], imageAssetIds: [...(m.imageAssetIds || []), ...ids] } : m,
    )
  }
  // 上传「额外参考图」(镜头编排面板用):直传后端成 asset(http url + asset_id),供云端草稿持久化
  const uploadRef = async (file: File): Promise<{ url: string; assetId?: number }> => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法上传参考图', 'error')
      return { url: '' }
    }
    try {
      const out: any = await uploadAssetFile({ workspaceId: ws, file })
      const assetId = Number(out?.asset?.id || 0) || 0
      if (!assetId) throw new Error('未取得 asset_id')
      const url = (await getAssetDownloadUrl({ workspaceId: ws, assetId }).catch(() => '')) || ''
      if (!url) throw new Error('未取得素材地址')
      return { url, assetId }
    } catch (e: any) {
      showToast(`参考图上传失败:${e?.message || '请检查存储配置/网络'}`, 'error')
      return { url: '' }
    }
  }
  const openSubject = (name: string, autoGen = false) =>
    setSubjectDlg({ open: true, name, kind: subjectKindOf(name), autoGen })

  // 该主体的广告语境:整体主题 + 它出现的分镜画面描述(帮模型选对元素的具体形态)
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

  // 准备素材:某镜头脚本没给出主体素材时,点「上传图片」给它加一个占位主体(全局唯一名),并打开素材弹窗上传/AI生成
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

  // 去重后的主体素材(脚本步 / 镜头编排顶部共用)
  // 后端"上传类"asset 的 id 集合(asset.source==='upload');用于可靠区分 上传/AI(对齐 2.0)
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

  // url → asset_id(各来源汇总),供按后端 source 判定
  const urlAssetId = (() => {
    const map = new Map<string, number>()
    ;(entryMeta?.images || []).forEach((u: string, i: number) => {
      const id = Number((entryMeta as any)?.imageAssetIds?.[i] || 0)
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

  // 当前项目内所有图(去重,标注来源 + asset_id):入口上传原图 + 各元素版本 + 分镜图。
  // 来源判定优先用后端 asset.source(uploadAssetIds);未知时回退创建时的客户端标记。
  const projectImages: { url: string; source: 'ai' | 'upload'; assetId?: number }[] = (() => {
    const classify = (url: string, guess: 'ai' | 'upload'): 'ai' | 'upload' => {
      const id = urlAssetId.get(url)
      if (id && uploadAssetIds.has(id)) return 'upload'
      if (id && uploadAssetIds.size) return 'ai' // 已加载 asset 列表、该 id 不在 upload 集 → AI
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

  // ── 镜头编排:按 画面描述 + 该镜头素材 + 上一张分镜图(连贯)+ 项目摘要 生成分镜图(后端文/图生图) ──
  const [shotGen, setShotGen] = useState<Record<string, boolean>>({})
  const [shotGenRunning, setShotGenRunning] = useState(false)
  const autoGenRef = useRef(false)
  // 上次「分镜图 / 整片视频」生成时的输入签名:用于区分「草稿恢复/未改动(沿用旧结果)」与
  // 「上游改动(需重新生成)」。进入下一步时输入签名变了 → 重新生成,与产品逻辑一致。
  const shotGenSigRef = useRef('')
  const videoGenSigRef = useRef('')

  // 分镜图的生成输入:每镜「画面描述 + 该镜素材(subjects 选定图)」+ 风格/比例。
  // 改了脚本描述 / 换了素材后再进镜头编排,签名变化 → 重新生成分镜图(否则沿用旧图,与产品逻辑冲突)。
  const shotImageInputSig = (list: Shot[], meta: EntryMeta | null) =>
    JSON.stringify({
      ratio: meta?.ratio || '',
      style: meta?.style || '',
      shots: (list || []).map((s) => ({
        id: s.id,
        desc: s.desc || '',
        subjects: s.subjects.map((su) => su.image || ''),
      })),
    })

  // 整片视频的生成输入:参与视频的分镜(分镜图 + 时长 + 台词 + 字幕 + 音效 + 顺序)+ 风格/比例/大纲。
  // 镜头编排里改了任意分镜(图/时长/文案/顺序/勾选)后再进生成视频,签名变化 → 重新出片。
  const videoInputSig = (list: Shot[], meta: EntryMeta | null, base: string) =>
    JSON.stringify({
      ratio: meta?.ratio || '',
      style: meta?.style || '',
      base: base || '',
      shots: (list || [])
        .filter((s) => s.includeInVideo !== false)
        .map((s) => ({
          id: s.id,
          image: s.image || '',
          duration: s.duration || '',
          line: s.line || '',
          subtitle: s.subtitle || '',
          sfx: s.sfx || '',
        })),
    })

  // 生成单个分镜图:画面描述 + 该镜头素材(多参考图)+ 上一张分镜图(连贯);返回新图 url
  const genShotFrame = async (
    ws: number,
    sh: Shot,
    prevUrl: string,
    cache: Record<string, number>,
    theme: string,
    plans: string[],
    feedback?: string,
    opts: { editPrompt?: string; refUrls?: string[]; carryCurrent?: boolean } = {},
  ) => {
    // manual=面板手动出图(指定素材 + 是否携带当前图);否则=批量自动(用全部元素 + 上一张连贯)
    const manual = opts.refUrls !== undefined
    const elUrls = manual
      ? opts.refUrls!
      : (Array.from(new Set(sh.subjects.map((s) => s.image).filter(Boolean))) as string[])
    const refIds: number[] = []
    for (const u of elUrls) {
      try {
        const id = await ensureAssetId(ws, u, cache)
        if (id) refIds.push(id)
      } catch {
        /* 单张参考上传失败则跳过 */
      }
    }
    // 是否携带当前分镜图作底图(img2img):manual 看 carryCurrent;批量靠 prevUrl 连贯
    const carry = manual ? !!opts.carryCurrent : !!(feedback || opts.editPrompt)
    const baseUrl = carry ? sh.image || '' : manual ? '' : prevUrl
    if (baseUrl) {
      try {
        const id = await ensureAssetId(ws, baseUrl, cache)
        if (id) refIds.push(id)
      } catch {
        /* ignore */
      }
    }
    // 该镜元素名(锚定画面只含这些主体,避免把无关产品/主题塞进来)
    const elNames = Array.from(new Set(sh.subjects.map((s) => stripAt(s.tag)).filter(Boolean))).join('、')
    // 提示词:① 用户编辑过的 imagePrompt 直接用;② 否则按 该镜画面描述 + 该镜元素 + 风格 组合
    // 注意:不再注入"整体广告主题",否则会把全局产品(如雅迪车)塞进每个无关镜头。
    const prompt = opts.editPrompt
      ? [opts.editPrompt, feedback && `修改要求:${feedback}`].filter(Boolean).join(';')
      : [
          sh.desc,
          feedback && `修改要求:${feedback}`,
          elNames && `画面主体仅含:${elNames}(不要出现其它无关物体)`,
          entryMeta?.style && `${entryMeta.style}风格`,
          carry
            ? '在当前画面基础上按修改要求调整,保持其余部分一致'
            : prevUrl && '与上一镜头保持人物形象、场景、配色、画风一致',
          '画面比例 ' + (entryMeta?.ratio || '16:9'),
        ]
          .filter(Boolean)
          .join(';')
    // 全云端:后端文/图生图(带素材组合 + 连贯),产出即后端 asset(http + asset_id),天然持久
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
              // 出图即不再是「插入的新分镜」(清除「生成分镜」按钮)
              isNew: false,
              // 每版记录自己用到的提示词与素材 url,切换历史版本可还原
              imageVersions: [...(x.imageVersions || []), { url, assetId, prompt, refs: elUrls }],
              // 手动出图:把这次选中的素材固化为该镜的选中态(随草稿持久)
              ...(manual ? { selectedRefs: elUrls } : {}),
            }
          : x,
      ),
    )
    // 镜头编排即脱敏(对齐 Vue 2.0):生成分镜图后立即人脸脱敏,结果缓存到分镜,供视频生成直接复用。
    // 脱敏失败/后端未配 image.face_detect 模型则静默跳过,视频生成时回退原图,不阻塞镜头编排。
    // 脱敏开关关闭则跳过(出片直接用原图)。
    if (assetId && faceBlurEnabledRef.current) {
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
        /* 脱敏失败不阻塞镜头编排 */
      }
    }
    return url
  }

  // 串行生成全部分镜图。list 缺省取当前 shots;插入新分镜后传入「已写入新描述」的列表,避免读到旧 state
  const generateShotImages = async (list: Shot[] = shots) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成分镜图', 'error')
      return
    }
    if (shotGenRunning) return
    setShotGenRunning(true)
    // 记录本次出图所依据的输入签名(供「下次进镜头编排时输入未变则不重生成」判断)
    shotGenSigRef.current = shotImageInputSig(list, entryMeta)
    const cache: Record<string, number> = {}
    const theme = (reqSummary || '').slice(0, 60)
    const plans = await resolvePlanCandidates()
    let prevUrl = ''
    try {
      for (const sh of list) {
        setShotGen((m) => ({ ...m, [sh.id]: true }))
        try {
          prevUrl = await genShotFrame(ws, sh, prevUrl, cache, theme, plans)
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

  // 单镜「编辑 / 新增」弹框统一生成(返回是否成功,供弹框「后端真正返回成功才关闭」)。
  // 重点:把【全部现有分镜的完整信息】作上下文 + 用户描述 + 上传素材,
  //   先由 LLM 产出/修改该镜头完整内容(画面描述 + 台词/字幕/音效 + 主体),与前后连贯,
  //   再据此 + 上传素材出分镜图。这样新分镜不再与其它无关,且台词/字幕/音效会一并补全。
  const generateShotFromDialog = async (
    sh: Shot,
    opts: { mode: 'edit' | 'insert'; intent: string; uploadRefUrls: string[] },
  ): Promise<boolean> => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成', 'error')
      return false
    }
    if (shotGen[sh.id]) return false
    setShotGen((m) => ({ ...m, [sh.id]: true }))
    try {
      const plans = await resolvePlanCandidates()
      const intent = (opts.intent || '').trim()
      const doText = opts.mode === 'insert' || intent.length > 0
      let target = sh
      if (doText) {
        const idx = shots.findIndex((s) => s.id === sh.id)
        // 上下文带「全部分镜」:新增时排除自身这条占位空分镜
        const ctxShots = opts.mode === 'insert' ? shots.filter((s) => s.id !== sh.id) : shots
        const info = await generateShotInfo({
          shots: ctxShots,
          targetIndex: idx < 0 ? ctxShots.length : idx,
          mode: opts.mode,
          intent,
          style: entryMeta?.style,
          ratio: entryMeta?.ratio,
          images: opts.uploadRefUrls,
        })
        // 文本字段一律回填(台词/字幕/音效);主体与时长仅新增时采用 LLM 结果,编辑保留原有
        const nextSubjects =
          opts.mode === 'insert' ? (info.subjects?.length ? info.subjects : sh.subjects) : sh.subjects
        target = {
          ...sh,
          desc: info.desc || sh.desc,
          line: info.line,
          subtitle: info.subtitle,
          sfx: info.sfx,
          duration: opts.mode === 'insert' ? info.duration || sh.duration : sh.duration,
          subjects: nextSubjects,
          isNew: false,
        }
        setShots((prev) =>
          prev.map((x) =>
            x.id === sh.id
              ? {
                  ...x,
                  desc: target.desc,
                  line: target.line,
                  subtitle: target.subtitle,
                  sfx: target.sfx,
                  duration: target.duration,
                  subjects: target.subjects,
                }
              : x,
          ),
        )
      }
      // 出图:已有主体素材 + 本次上传素材作参考;编辑在当前图基础上改(img2img)
      const subjectUrls = (target.subjects || []).map((s) => s.image).filter(Boolean) as string[]
      const refUrls = Array.from(new Set([...subjectUrls, ...opts.uploadRefUrls]))
      await genShotFrame(ws, target, '', {}, (reqSummary || '').slice(0, 60), plans, undefined, {
        refUrls,
        carryCurrent: opts.mode === 'edit',
      })
      return true
    } catch (e: any) {
      showToast(`分镜「${sh.no}」生成失败:${e?.message || ''}`, 'error')
      return false
    } finally {
      setShotGen((m) => ({ ...m, [sh.id]: false }))
    }
  }

  // 进入镜头编排:分镜图未生成、或上游(脚本描述/素材)已改动则自动串行逐个生成(左侧缩略图转圈)。
  // 已有分镜图且输入签名未变(草稿恢复 / 未改动)→ 不重生成;改了脚本或素材 → 输入签名变化 → 重新生成。
  useEffect(() => {
    if (step !== 2 || !shots.length || shotGenRunning) return
    if (autoGenRef.current) return
    if (shots.some((s) => s.image) && shotImageInputSig(shots, entryMeta) === shotGenSigRef.current) return
    autoGenRef.current = true
    void generateShotImages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shots])

  // ── 生成视频:整片一次生成(所有分镜图+脚本+台词+字幕+音效 → seedance)──
  const [fullVideo, setFullVideo] = useState<{ url: string; assetId: number }>({ url: '', assetId: 0 })
  const [videoVersions, setVideoVersions] = useState<{ url: string; assetId: number }[]>([])
  const [vidGenRunning, setVidGenRunning] = useState(false)
  const autoVidRef = useRef(false)
  // 人脸脱敏:正式出视频前对每张进入视频的分镜图脱敏。阶段提示 + 每镜调试信息(开发可见)
  const [blurPhase, setBlurPhase] = useState('')
  const [blurDebug, setBlurDebug] = useState<any[]>([])
  // 人脸脱敏开关(默认开,保护隐私;关闭后出片用原图,成片人脸清晰)。ref 供异步流程读最新值
  const [faceBlurEnabled, setFaceBlurEnabled] = useState(true)
  const faceBlurEnabledRef = useRef(true)
  useEffect(() => {
    faceBlurEnabledRef.current = faceBlurEnabled
  }, [faceBlurEnabled])

  // 生成/重生成整片;note=修改意见。opts.edit=true(「确认修改」)且已有整片时:
  // 走视频编辑(video.edit,模型 happyhorse-1.0-video-edit):原视频 role:video + 修改提示,
  // 不复用爆款复制(video.replicate)逻辑,也不从分镜图重出整片。
  const runFullVideo = async (note?: string, opts?: { edit?: boolean }) => {
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

    // 「确认修改」:把上次整片当 video 输入,按修改提示在原视频基础上改(片段时间段写进提示)
    if (opts?.edit && fullVideo.assetId) {
      setVidGenRunning(true)
      try {
        const plans = await resolvePlanCandidates()
        const editPrompt = [
          '请在保留原视频镜头内容、顺序与节奏的前提下,按以下修改要求调整画面(只改提到的部分,其余保持不变):',
          note || '',
        ]
          .filter(Boolean)
          .join('\n')
        const { url, assetId } = await editFullVideo({
          workspaceId: ws,
          videoAssetId: fullVideo.assetId,
          prompt: editPrompt,
          ratio: entryMeta?.ratio,
          durationSec: totalDurationSec(shots) || 10,
          modelPlanCandidates: plans,
        })
        setFullVideo({ url, assetId })
        setVideoVersions((prev) => [...prev, { url, assetId }])
      } catch (e: any) {
        showToast(`视频修改失败:${e?.message || ''}`, 'error')
      } finally {
        setVidGenRunning(false)
      }
      return
    }

    // 仅勾选「参与视频生成」的分镜进入视频(未勾选的跳过)
    const activeShots = shots.filter((s) => s.includeInVideo !== false)
    if (!activeShots.length) {
      showToast('请至少勾选一个分镜参与视频生成', 'error')
      return
    }
    setVidGenRunning(true)
    // 记录本次出片所依据的分镜签名(供「下次进生成视频时分镜未变则不重生成」判断)
    videoGenSigRef.current = videoInputSig(shots, entryMeta, reqSummary || requirement)
    try {
      const plans = await resolvePlanCandidates()
      const cache: Record<string, number> = {}
      // ① 先确定每镜「原始分镜图」asset_id(按镜头顺序):优先已有 imageAssetId,缺则现传一次
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
      // ② 正式生成前:对每张进入视频的分镜图做人脸脱敏,用脱敏版喂 seedance(失败回退原图)。
      // 脱敏开关关闭 → 跳过脱敏,直接用原图,成片人脸清晰。
      const imageAssetIds: number[] = []
      if (faceBlurEnabledRef.current) {
        const dbg: any[] = []
        const blurPatch: Record<string, Partial<Shot>> = {}
        for (let i = 0; i < srcIds.length; i++) {
          const { shotId, id } = srcIds[i]
          const sh = shots.find((s) => s.id === shotId)
          setBlurPhase(`人脸脱敏 ${i + 1}/${srcIds.length}…`)
          // 缓存命中(同一原图已脱敏过)→ 直接复用,不重复调用
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
            blurPatch[String(shotId)] = {
              blurredImageUrl: r.url,
              blurredImageAssetId: r.assetId,
              blurredFromAssetId: id,
            }
          } else {
            imageAssetIds.push(id) // 脱敏失败:回退原图,不阻塞出片
          }
        }
        setBlurDebug(dbg)
        // 把脱敏结果缓存回分镜(随草稿持久,重试/重进不重复脱敏)
        if (Object.keys(blurPatch).length) {
          setShots((prev) => prev.map((s) => (blurPatch[String(s.id)] ? { ...s, ...blurPatch[String(s.id)] } : s)))
        }
      } else {
        // 不脱敏:直接用原图 assetId 出片
        for (const s of srcIds) imageAssetIds.push(s.id)
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

  // 进入生成视频:整片未生成、或镜头编排已改动(分镜图/时长/文案/顺序/勾选)则自动生成一次。
  // 已有整片且分镜签名未变(草稿恢复 / 未改动)→ 不重生成;改了镜头编排 → 签名变化 → 重新出片。
  useEffect(() => {
    if (step !== 3 || !shots.length || vidGenRunning) return
    if (autoVidRef.current) return
    // 已有整片(url 或仅 assetId——可能正等签名URL刷新)且分镜未变 → 不再自动重生成,避免重复出片 / 误判「没视频」
    if (
      (fullVideo.url || fullVideo.assetId) &&
      videoInputSig(shots, entryMeta, reqSummary || requirement) === videoGenSigRef.current
    )
      return
    autoVidRef.current = true
    void runFullVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shots])

  // 同名主体素材联动 + 纳入版本库:
  // 脚本只在部分镜头(常仅镜头1)匹配到 imageIndex,这里把每个主体已有的图回填到所有同名缺图的分镜。
  useEffect(() => {
    // 1) name -> 已有图(取第一个非空){url, assetId}
    const imgByName = new Map<string, { url: string; assetId: number }>()
    shots.forEach((sh) =>
      sh.subjects.forEach((su) => {
        const n = stripAt(su.tag)
        if (su.image && !imgByName.has(n)) imgByName.set(n, { url: su.image, assetId: Number(su.assetId || 0) || 0 })
      }),
    )
    // 1b) 版本库回填:脚本重生成(如「上一步」回到入口后重新生成脚本)会清空分镜,但主体素材版本库仍在。
    //     同名主体若当前分镜里都没图,就用版本库里最后一版补回,避免准备素材已生成/上传的素材丢失。
    Object.entries(subjectAssets).forEach(([name, e]: any) => {
      if (imgByName.has(name)) return
      const vs: string[] = e?.versions || []
      const last = vs[vs.length - 1]
      if (last) imgByName.set(name, { url: last, assetId: e?.ids?.[last] || 0 })
    })
    // 2) 回填到所有同名缺图的 subject(图 + assetId)
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
      return // 本次先回填,下一轮再并入版本库(避免重复计算)
    }
    // 3) 纳入对应主体版本库
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
    // subjectAssets 入依赖:脚本重生成后由版本库回填(步骤 1b);step3 幂等(已含则不改),不会死循环
  }, [shots, subjectAssets])

  // 各修改框文本(临时本地态;后端接入后改为来自分镜数据)。
  const [fields, setFields] = useState<Record<string, string>>({})

  // ── 加载后水合签名URL(对齐 2.0):草稿里存的签名URL会过期,按 asset_id 重新取新签名URL ──
  const hydratedUrlsRef = useRef(false)
  useEffect(() => {
    if (!hydratedRef.current || hydratedUrlsRef.current) return
    const ws = Number(workspaceId || 0)
    if (!ws || !started) return
    // 收集所有 asset_id(分镜图 + 元素图 + 版本库)
    const ids = new Set<number>()
    shots.forEach((sh) => {
      if (sh.imageAssetId) ids.add(Number(sh.imageAssetId))
      ;(sh.imageVersions || []).forEach((v: any) => {
        const id = typeof v === 'string' ? 0 : Number(v?.assetId || 0)
        if (id) ids.add(id)
      })
      sh.subjects.forEach((su) => {
        if (su.assetId) ids.add(Number(su.assetId))
      })
      ;(sh.extraRefs || []).forEach((r: any) => {
        if (r?.assetId) ids.add(Number(r.assetId))
      })
      if (sh.blurredImageAssetId) ids.add(Number(sh.blurredImageAssetId))
    })
    Object.values(subjectAssets).forEach((e: any) =>
      Object.values(e?.ids || {}).forEach((id: any) => {
        if (id) ids.add(Number(id))
      }),
    )
    if (fullVideo.assetId) ids.add(Number(fullVideo.assetId))
    videoVersions.forEach((v) => {
      if (v.assetId) ids.add(Number(v.assetId))
    })
    ;((entryMeta as any)?.imageAssetIds || []).forEach((id: any) => {
      if (id) ids.add(Number(id))
    })
    if (!ids.size) return // 暂无 asset_id(数据可能还没装载完)→ 下一轮再试
    hydratedUrlsRef.current = true
    void (async () => {
      const map = new Map<number, string>()
      await Promise.all(
        [...ids].map(async (id) => {
          const u = await refreshAssetUrl(ws, id)
          if (u) map.set(id, u)
        }),
      )
      if (!map.size) return
      setShots((prev) =>
        prev.map((sh) => {
          // 该镜内 旧url→新url 映射(元素/额外参考/版本/当前图各自带 asset_id),用于刷新 selectedRefs/版本refs
          const urlRemap = new Map<string, string>()
          const note = (oldUrl: string | undefined, id: any) => {
            const nu = id && map.get(Number(id))
            if (oldUrl && nu) urlRemap.set(oldUrl, nu)
          }
          note(sh.image, sh.imageAssetId)
          sh.subjects.forEach((su) => note(su.image, su.assetId))
          ;(sh.extraRefs || []).forEach((r: any) => note(r?.url, r?.assetId))
          ;(sh.imageVersions || []).forEach((v: any) => {
            if (v && typeof v !== 'string') note(v.url, v.assetId)
          })
          const remap = (u: string) => urlRemap.get(u) || u
          return {
            ...sh,
            image: sh.imageAssetId && map.get(Number(sh.imageAssetId)) ? map.get(Number(sh.imageAssetId))! : sh.image,
            imageVersions: (sh.imageVersions || []).map((v: any) => {
              const o = typeof v === 'string' ? { url: v, assetId: 0 } : v
              const nu = o.assetId && map.get(Number(o.assetId))
              return {
                ...o,
                url: nu || o.url,
                ...(o.refs ? { refs: o.refs.map(remap) } : {}),
              }
            }),
            subjects: sh.subjects.map((su) =>
              su.assetId && map.get(Number(su.assetId)) ? { ...su, image: map.get(Number(su.assetId))! } : su,
            ),
            extraRefs: (sh.extraRefs || []).map((r: any) =>
              r?.assetId && map.get(Number(r.assetId)) ? { ...r, url: map.get(Number(r.assetId))! } : r,
            ),
            selectedRefs: sh.selectedRefs ? sh.selectedRefs.map(remap) : sh.selectedRefs,
            blurredImageUrl:
              sh.blurredImageAssetId && map.get(Number(sh.blurredImageAssetId))
                ? map.get(Number(sh.blurredImageAssetId))!
                : sh.blurredImageUrl,
          }
        }),
      )
      setSubjectAssets((prev) => {
        const next: any = { ...prev }
        for (const [name, e] of Object.entries(prev) as any) {
          const oldIds = e.ids || {}
          let changed = false
          const versions = e.versions.map((u: string) => {
            const id = oldIds[u]
            const nu = id && map.get(Number(id))
            if (nu) {
              changed = true
              return nu
            }
            return u
          })
          if (!changed) continue
          const ids2: Record<string, number> = {}
          const sources2: Record<string, any> = {}
          e.versions.forEach((u: string, i: number) => {
            const id = oldIds[u] || 0
            const nu = versions[i]
            ids2[nu] = id
            if (e.sources?.[u]) sources2[nu] = e.sources[u]
          })
          next[name] = { ...e, versions, ids: ids2, sources: sources2 }
        }
        return next
      })
      // 入口上传图:按 asset_id 刷新签名URL
      setEntryMeta((prev: any) => {
        const aids = prev?.imageAssetIds || []
        if (!Array.isArray(prev?.images) || !aids.length) return prev
        const images = prev.images.map((u: string, i: number) => {
          const nu = aids[i] && map.get(Number(aids[i]))
          return nu || u
        })
        return { ...prev, images }
      })
      // 整片视频:按 asset_id 刷新当前 + 各历史版本签名URL
      setFullVideo((prev) =>
        prev.assetId && map.get(Number(prev.assetId)) ? { ...prev, url: map.get(Number(prev.assetId))! } : prev,
      )
      setVideoVersions((prev) =>
        prev.map((v) => (v.assetId && map.get(Number(v.assetId)) ? { ...v, url: map.get(Number(v.assetId))! } : v)),
      )
    })()
  }, [workspaceId, started, shots, subjectAssets, fullVideo, videoVersions, entryMeta])

  // ── 制作图片对话:加载后按 asset_id 重换图片签名URL(草稿里存的签名URL会过期)──
  useEffect(() => {
    if (!hydratedRef.current || imgMsgHydratedRef.current) return
    const ws = Number(workspaceId || 0)
    if (!ws || !started || !isImageMode) return
    const ids = new Set<number>()
    imageMessages.forEach((m) => (m.images || []).forEach((im) => im.assetId && ids.add(Number(im.assetId))))
    if (!ids.size) return
    imgMsgHydratedRef.current = true
    void (async () => {
      const map = new Map<number, string>()
      await Promise.all(
        [...ids].map(async (id) => {
          const u = await refreshAssetUrl(ws, id)
          if (u) map.set(id, u)
        }),
      )
      if (!map.size) return
      setImageMessages((prev) =>
        prev.map((m) => ({
          ...m,
          images: (m.images || []).map((im) =>
            im.assetId && map.get(Number(im.assetId)) ? { ...im, url: map.get(Number(im.assetId))! } : im,
          ),
        })),
      )
    })()
  }, [workspaceId, started, isImageMode, imageMessages])

  // ── 草稿:本地(localStorage)+ 后端(/creative/projects/:id/draft)双层持久化 ──
  // 把当前页面状态打包成草稿对象(localStorage 与后端快照共用)
  const currentDraft = (): SmartDraft => ({
    started,
    requirement,
    reqSummary,
    entryMeta,
    projectName,
    nameTouched,
    step,
    maxReached,
    shots,
    subjectAssets,
    fields,
    projectId,
    fullVideoUrl: fullVideo.url,
    fullVideoAssetId: fullVideo.assetId,
    videoVersions,
    faceBlurEnabled,
    marketingOpen,
    marketingText,
    imageMessages,
  })
  // 把草稿回填到页面状态(本地恢复 / 后端恢复共用)
  const applyDraft = (d: SmartDraft) => {
    setStarted(true)
    setRequirement(d.requirement || '')
    setReqSummary(d.reqSummary || '')
    if (d.entryMeta) setEntryMeta(d.entryMeta)
    if (d.projectName) setProjectName(d.projectName)
    setNameTouched(!!d.nameTouched)
    setStep(Math.min(STEPS.length - 1, Math.max(0, d.step || 0)))
    setMaxReached(d.maxReached || 0)
    setShots(Array.isArray(d.shots) ? d.shots : [])
    setSubjectAssets(d.subjectAssets || {})
    setFields(d.fields || {})
    setFullVideo({ url: d.fullVideoUrl || '', assetId: d.fullVideoAssetId || 0 })
    setVideoVersions(Array.isArray(d.videoVersions) ? d.videoVersions : [])
    setFaceBlurEnabled((d as any).faceBlurEnabled !== false)
    setMarketingOpen(!!d.marketingOpen)
    setMarketingText(d.marketingText || '')
    setImageMessages(Array.isArray(d.imageMessages) ? (d.imageMessages as ChatMessage[]) : [])
    imgMsgHydratedRef.current = false // 恢复后按 asset_id 重换图片签名URL
    autoGenRef.current = true // 已有分镜图/草稿,进入镜头编排不自动重生成
    autoVidRef.current = true
    // 以恢复时的状态作为「已生成」基线签名:之后未改动就不重生成,改了上游再进下一步才重新生成
    const restoredShots = Array.isArray(d.shots) ? d.shots : []
    shotGenSigRef.current = shotImageInputSig(restoredShots, d.entryMeta || null)
    videoGenSigRef.current = videoInputSig(restoredShots, d.entryMeta || null, d.reqSummary || d.requirement || '')
  }

  // 从任意返回体里取 draft_revision(后端字段有下划线/驼峰/嵌套 data 多种写法,对齐 2.0)
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

  // 串行化所有后端草稿保存:排队执行,前一个完成(并更新 revision)再执行下一个,
  // 杜绝并发 PUT 用同一 revision 互相打架导致的 409 DRAFT_CONFLICT。
  const saveChainRef = useRef<Promise<any>>(Promise.resolve())
  const putSmartDraftToBackend = (): Promise<boolean> => {
    const run = saveChainRef.current.catch(() => {}).then(() => doPutDraft())
    saveChainRef.current = run
    return run
  }

  // 把当前草稿写到后端。对齐 2.0 putDraftSnapshot:保存前先确保有当前 revision,
  // 保存后用返回的 revision 同步;返回体没带 revision 则重新拉一次;409 冲突→拉新 revision 重试。
  const doPutDraft = async (): Promise<boolean> => {
    const id = projectIdRef.current
    const ws = Number(workspaceId || 0)
    if (!id || !ws) return false
    const snapshot = buildSmartSnapshot(currentDraft())
    // 首次/未知 revision:先拉一次,避免用错版本号导致 409 把后续(含图)的保存全部打掉
    if (!draftRevisionRef.current) await fetchRevision(id, ws)
    try {
      const payload: any = await updateCreativeProjectDraft({
        projectId: id,
        workspaceId: ws,
        draft: snapshot,
        draftRevision: draftRevisionRef.current,
      })
      const next = normRev(payload)
      if (Number.isFinite(next)) draftRevisionRef.current = next
      else await fetchRevision(id, ws) // 返回体没带 revision → 重新拉,保持同步
      return true
    } catch (e: any) {
      if (e?.status !== 409) return false
      await fetchRevision(id, ws)
      try {
        const payload: any = await updateCreativeProjectDraft({
          projectId: id,
          workspaceId: ws,
          draft: snapshot,
          draftRevision: draftRevisionRef.current,
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

  const hydratedRef = useRef(false)
  // 进入:有 /smart/:id → 从后端恢复;否则恢复 localStorage 草稿
  useEffect(() => {
    if (hydratedRef.current) return
    const rid = Number(routeId || 0)
    if (rid > 0) {
      const ws = Number(workspaceId || 0)
      if (!ws) return // 等工作空间就绪
      hydratedRef.current = true
      projectIdRef.current = rid
      setProjectId(rid)
      getCreativeProject({ projectId: rid, workspaceId: ws })
        .then((proj: any) => {
          draftRevisionRef.current = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
          const draftJson = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
          const d = parseSmartSnapshot(draftJson)
          if (d) applyDraft(d)
          // 兜底:智能成片快照里没有整片视频(上次在「生成视频」中途切走,完成结果由后端落到了项目级字段),
          // 从项目数据补出最近一版视频 + 历史版本,保证「生成视频」步骤能加载出来(URL 过期由下面的签名刷新兜底)。
          if (!d?.fullVideoUrl && !d?.fullVideoAssetId) {
            const fb = extractProjectVideoFallback(draftJson)
            if (fb.latest.url || fb.latest.assetId) {
              setFullVideo(fb.latest)
              if (fb.versions.length) setVideoVersions(fb.versions)
            }
          }
          const t = String(proj?.title || proj?.name || '').trim()
          if (t) {
            setProjectName(t)
            serverTitleRef.current = t // 既有标题已在后端,避免加载后又重复回写
          }
        })
        .catch(() => showToast('项目加载失败', 'error'))
    } else {
      // 空白 /smart:始终以最初的空输入框进入,不恢复本地草稿。
      // (同一次进入内点「上一步」回到输入框会保留历史输入——那是组件 state,不依赖这里;
      //  切换路由再回来则会重新挂载、state 清空,故得到全新空白页。)
      hydratedRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, workspaceId])

  // 自动保存:本地立即(600ms 防抖)+ 后端(1.5s 防抖,仅在已建项目时)
  useEffect(() => {
    if (!hydratedRef.current) return
    const local = window.setTimeout(() => saveSmartDraft(currentDraft()), 600)
    const remote = window.setTimeout(() => {
      if (projectIdRef.current) void putSmartDraftToBackend()
    }, 1500)
    return () => {
      window.clearTimeout(local)
      window.clearTimeout(remote)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    started,
    requirement,
    reqSummary,
    entryMeta,
    projectName,
    nameTouched,
    step,
    maxReached,
    shots,
    subjectAssets,
    fields,
    projectId,
    fullVideo,
    videoVersions,
    marketingOpen,
    marketingText,
    imageMessages,
  ])

  const goStep = (i: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i))
    setStep(next)
    setMaxReached((m) => Math.max(m, next))
  }

  const onNavigate = (key: string) => {
    const path = ROUTE_MAP[key]
    if (path) navigate(path)
  }

  // 「制作新视频」:把整个智能成片流程初始化为全新空白页(等同切换路由再切回来)。
  // 清空本地草稿 + 所有页面状态 + 项目引用,回到入口输入页;入口页 key 自增以重挂载、清空其内部输入。
  const resetToNewVideo = (entryMode?: 'video' | 'image') => {
    clearSmartDraft()
    setStarted(false)
    setShots([])
    setRequirement('')
    setReqSummary('')
    // 回到入口:默认全清(视频 tab);image=保持「制作图片」tab(供「创建新对话」)
    setEntryMeta(
      entryMode === 'image'
        ? { mode: 'image', style: '', ratio: '16:9', duration: '10s', imageCount: 0, images: [] }
        : null,
    )
    setProjectName('未命名项目')
    setNameTouched(false)
    setStep(0)
    setMaxReached(0)
    setSubjectAssets({})
    setFields({})
    setFullVideo({ url: '', assetId: 0 })
    setVideoVersions([])
    setMarketingOpen(false)
    setMarketingText('')
    setImageMessages([])
    imgMsgHydratedRef.current = false
    projectIdRef.current = 0
    setProjectId(0)
    draftRevisionRef.current = 0
    serverTitleRef.current = ''
    autoVidRef.current = false
    setEntryKey((k) => k + 1)
    navigate('/smart')
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
      setNameTouched(true) // 手动命名后,不再被自动命名覆盖
    }
    setEditingName(false)
  }

  // 入口页发送:记录需求/选项,进入流程,并据需求自动命名项目。
  // 生成分镜脚本(本地多模态模型,流式:边生成边显示);失败置错误态,可重试
  const generateScript = async (req: string, meta: EntryMeta) => {
    setScriptLoading(true)
    setScriptError('')
    setShots([])
    autoGenRef.current = false // 新脚本 → 进入镜头编排时重新自动生成分镜图
    let got = 0
    try {
      const result = await generateScriptShotsStream(
        {
          requirement: req,
          style: meta.style,
          ratio: meta.ratio,
          duration: meta.duration,
          images: meta.images,
        },
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

  // 项目名变化时回写后端标题(防抖)。对齐 Vue CreativeScriptView:
  // - title 与 name 一并回写(后端两字段都用,列表/历史才会同步)
  // - 已同步过相同标题则跳过,避免重复 PATCH
  // - 后端已有真实标题时,自动/AI 命名不覆盖;仅用户手动改名(nameTouched)才覆盖
  // best-effort:失败则清掉记录,下次名字再变时重试。
  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    if (!projectId || !wsId) return
    const t = projectName.trim()
    if (!t || isUnnamedTitle(t) || t === serverTitleRef.current) return
    if (!nameTouched && !isUnnamedTitle(serverTitleRef.current)) return
    const timer = window.setTimeout(() => {
      serverTitleRef.current = t
      patchCreativeProject({ projectId, workspaceId: wsId, title: t, name: t }).catch(() => {
        serverTitleRef.current = ''
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [projectId, projectName, nameTouched, workspaceId])

  // 选中 SKILL:把「想法 + 素材」交给技能包,自动拆解出营销思路建议(只读展示在营销思路拆解步)。
  // 此时 meta.images 多为入口刚转好的 dataURL(尚未落库),正好可直接喂多模态视觉模型。
  const runSkillBreakdown = async (req: string, meta: EntryMeta) => {
    if (!meta.skill) return
    setMarketingLoading(true)
    setMarketingError('')
    setMarketingText('')
    try {
      // 产品信息:用户文字 + 全部上传素材(最多 9 张,与入口上限一致)一并喂入(方案 A 多模态)
      const out = await skillBreakdown({ skill: meta.skill, requirement: req, images: (meta.images || []).slice(0, 9) })
      setMarketingText(out)
    } catch (e: any) {
      setMarketingError(e?.message || '营销思路拆解失败,请重试')
    } finally {
      setMarketingLoading(false)
    }
  }

  // 营销思路拆解「确认」→ 用拆解结果生成分镜脚本,进入分镜脚本步。
  const confirmMarketing = () => {
    if (marketingLoading) return
    setMarketingOpen(false)
    setStep(0)
    setMaxReached(0)
    autoGenRef.current = false
    // 拆解结果作为脚本生成输入(更完整);页面「我的描述」仍展示原始需求。
    if (entryMeta) void generateScript(marketingText || requirement, entryMeta)
  }

  // 营销思路拆解「上一步 / 取消」→ 回到最初输入框(保留上次输入,含已选 SKILL)。
  const cancelMarketing = () => {
    setMarketingOpen(false)
    setStarted(false)
  }

  // 发送一轮对话:追加 用户消息(文本 + 参考图)+ assistant 占位,后台出图后回填。
  // 有参考图(上传 / @图片N)→ image_to_image;无参考图 → text_to_image(均走 generateShotImage)。
  const sendImageChat = (text: string, refUrls: string[], ratio: string) => {
    const uid = nextMsgId()
    const aid = nextMsgId()
    setImageMessages((m) => [
      ...m,
      { id: uid, role: 'user', text, images: refUrls.map((u) => ({ url: u })) },
      { id: aid, role: 'assistant', status: 'pending' },
    ])
    const patch = (id: string, next: Partial<ChatMessage>) =>
      setImageMessages((m) => m.map((x) => (x.id === id ? { ...x, ...next } : x)))
    void (async () => {
      const ws = Number(workspaceId || 0)
      if (!ws) {
        patch(aid, { status: 'error', error: '未选择工作空间,无法生成图片' })
        return
      }
      try {
        const plans = await resolvePlanCandidates()
        // 参考图落库取 asset_id(并回填到用户消息,供刷新后按 asset_id 重换签名URL)
        const cache: Record<string, number> = {}
        const refIds: number[] = []
        const userImgs: { url: string; assetId: number }[] = []
        for (const u of refUrls) {
          let id = 0
          try {
            id = await ensureAssetId(ws, u, cache)
          } catch {
            /* 单张失败跳过 */
          }
          userImgs.push({ url: u, assetId: id })
          if (id) refIds.push(id)
        }
        if (userImgs.length) patch(uid, { images: userImgs })
        const { url, assetId } = await generateShotImage({
          workspaceId: ws,
          prompt: text || '生成一张营销广告图片',
          refAssetIds: refIds,
          modelPlanCandidates: plans,
          ratio,
        })
        patch(aid, { status: 'done', images: [{ url, assetId }] })
      } catch (e: any) {
        patch(aid, { status: 'error', error: `图片生成失败:${e?.message || '请重试'}` })
      }
    })()
  }

  const handleStart = (req: string, meta: EntryMeta) => {
    setRequirement(req)
    setEntryMeta(meta)
    setStarted(true)
    setStep(0)
    setMaxReached(0)
    setShots([])
    setScriptError('')
    const imageMode = meta.mode === 'image'
    // 制作图片:对话模式,清空旧会话,不进「营销思路拆解」步。
    if (imageMode) setImageMessages([])
    imgMsgHydratedRef.current = false
    // 选中 SKILL → 先进「营销思路拆解」步(不立即生成脚本);未选 → 走现有逻辑直接生成脚本。
    setMarketingOpen(imageMode ? false : !!meta.skill)
    setMarketingText('')
    setMarketingError('')
    if (req) void autoNameProject(req)
    // 入口上传的素材图(dataURL)落库成后端 asset,否则刷新会丢(stripHeavy 剥 dataURL)
    const wsId = Number(workspaceId || 0)
    if (wsId && meta.images?.length) {
      void (async () => {
        const cache: Record<string, number> = {}
        const urls: string[] = []
        const ids: number[] = []
        for (const u of meta.images!) {
          try {
            const out = await persistImageAsset(wsId, u, cache)
            urls.push(out.url)
            ids.push(out.assetId || 0)
          } catch {
            urls.push(u)
            ids.push(0)
          }
        }
        setEntryMeta((m: any) => (m ? { ...m, images: urls, imageAssetIds: ids } : m))
      })()
    }
    // 后端建项目(best-effort,使其出现在项目管理/历史)
    if (wsId && !projectIdRef.current) {
      draftRevisionRef.current = 0
      serverTitleRef.current = ''
      createCreativeProject({ workspace_id: wsId })
        .then((p: any) => {
          const id = resolveProjectId(p)
          projectIdRef.current = id
          setProjectId(id)
          // 对齐 2.0(CreativeEntryView router.replace /creative/:id):跳到 /smart/:id,
          // 之后刷新走「后端草稿」恢复(可靠、有 asset_id、不受 localStorage 配额限制)
          if (id) navigate(`/smart/${id}`, { replace: true })
        })
        .catch(() => {})
    }
    // 制作图片:直接以入口需求 + 上传素材发起第一轮对话出图,不走分镜/脚本/视频流程。
    if (imageMode) {
      sendImageChat(req, meta.images || [], meta.ratio)
      return
    }
    // 选中 SKILL:先做营销思路拆解,确认后再生成脚本;未选:立即生成脚本。
    if (meta.skill) void runSkillBreakdown(req, meta)
    else void generateScript(req, meta)
    // 长需求 → AI 摘要成 ≤100 字展示;短需求直接用原文
    if (req.trim().length > 90) {
      summarizeRequirement(req)
        .then((s) => setReqSummary(s || req))
        .catch(() => setReqSummary(req))
    } else {
      setReqSummary(req)
    }
  }

  // 根据需求自动命名项目(本地 Qwen)。用户已手动改名 / 正在命名 / 需求为空 则跳过。
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
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        // 命名失败不打断流程,仅静默(保留原名)
      }
    } finally {
      setNaming(false)
    }
  }

  // TODO(后续阶段): 接真实生成/保存逻辑;现仅占位提示。
  const todo = (msg: string) => () => showToast(msg, 'info')

  // 下载当前整片视频:优先按 asset_id 取新签名URL → fetch 成 blob 下载;CORS 失败则新标签打开
  // 下载视频:弹「另存为」让用户自选保存位置(不支持的浏览器回退自动下载)。
  // 解析 URL 时按 asset_id 刷新签名 URL,避免过期下载失败。
  const handleDownloadVideo = async () => {
    if (!fullVideo.url) {
      showToast('请先生成视频', 'info')
      return
    }
    const safeName = (projectName || '视频').replace(/[\\/:*?"<>|]/g, '').trim() || '视频'
    const d = new Date()
    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const fileName = `${safeName}_${dateStr}.mp4`
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
  }

  // ── 底栏导航箭头(上一步 / 下一步),与各步「主操作按钮」分离 ──
  // 上一步:step0 → 营销拆解(用了 skill)/ 入口;其余 → 上一步骤(纯导航,不重生成)。
  const goPrev = () => {
    if (step === 0) {
      if (entryMeta?.skill) setMarketingOpen(true)
      else setStarted(false)
    } else {
      goStep(step - 1)
    }
  }
  // 下一步:仅在「已生成过」的步骤之间向前导航(step < maxReached);前沿(下一步尚未生成)置灰,
  // 首次生成只走主按钮(确认脚本 / 镜头编排 / 生成视频)。
  const canGoNext = step < maxReached
  const goNext = () => {
    if (canGoNext) goStep(step + 1)
  }

  // 各步「主操作按钮」(不含上一步/下一步,导航箭头单独渲染)
  const bottomButtons: BottomButton[] = (() => {
    // 任意分镜图生成中(批量 shotGenRunning 或单张 shotGen[id])→ 禁用镜头编排步的生成类按钮
    const anyShotGenerating = shotGenRunning || Object.values(shotGen).some(Boolean)
    switch (step) {
      case 0: // 分镜脚本:重新生成在表头(见 ScriptStoryboardTable),底栏只有 确认脚本
        return [
          {
            // 确认脚本 → 进入「准备素材」,此时 AI 生成的主体素材回填到对应分镜
            label: '确认脚本',
            variant: 'primary',
            action: () => goStep(1),
            disabled: scriptLoading,
          },
        ]
      case 1: // 准备素材:底栏只有 镜头编排(镜头数在表尾「共 N 个镜头」)
        return [
          {
            label: '镜头编排',
            variant: 'primary',
            action: () => {
              autoGenRef.current = false // 允许进入镜头编排后自动生成分镜图
              goStep(2)
            },
            disabled: scriptLoading,
          },
        ]
      case 2: // 镜头编排:重新生成 + 生成视频
        return [
          {
            label: shotGenRunning ? '生成中…' : '重新生成',
            variant: 'ghost',
            action: () => generateShotImages(),
            disabled: anyShotGenerating,
          },
          {
            label: '生成视频',
            variant: 'primary',
            action: () => {
              autoVidRef.current = false
              goStep(3)
            },
            disabled: anyShotGenerating,
          },
        ]
      case 3: // 生成视频:总按钮已移到中间 VideoStage,这里不再渲染底部条
        return []
      default:
        return []
    }
  })()

  // 入口「下一步」:从入口回到已生成的流程,只往前一步(进入分镜脚本 / 用了 skill 则进营销拆解),不重生成。
  const resumeFlow = () => {
    setStarted(true)
    if (entryMeta?.skill && marketingText) setMarketingOpen(true)
  }
  // 入口是否可「恢复/下一步」:视频模式且已有生成结果(分镜脚本 或 营销拆解)
  const canResumeFlow = entryMeta?.mode !== 'image' && (shots.length > 0 || !!marketingText)

  // 营销思路拆解步(选中 SKILL 时的第 1 步):我的描述(只读,与分镜脚本步一致)+ skill 拆解建议(可编辑)+ 确认/上一步。
  const renderMarketingBody = () => {
    const promptText = requirement || '（未填写需求）'
    return (
      <div className="smart__script smart__mkt-step">
        {/* 我的描述:直接展示上一步输入框的原始需求,只读 */}
        <div className="smart__prompt-label">我的描述：</div>
        <div className="smart__prompt smart__md">
          <Streamdown>{promptText}</Streamdown>
        </div>

        {/* skill 拆解出的营销建议:可编辑;正文区填满剩余空间并内部滚动,底部按钮常驻可见 */}
        <div className="smart__marketing">
          <div className="smart__marketing-title">
            <span aria-hidden="true">💡</span>
            {entryMeta?.skill}建议：
          </div>
          <div className="smart__marketing-content">
            {marketingLoading ? (
              <div className="smart__placeholder smart__placeholder--sm">正在拆解营销思路…</div>
            ) : marketingError ? (
              <div className="smart__script-error">
                {marketingError}
                <button
                  type="button"
                  className="smart__btn smart__btn--primary"
                  onClick={() => entryMeta && runSkillBreakdown(requirement, entryMeta)}
                >
                  重新生成
                </button>
              </div>
            ) : (
              <textarea
                className="smart__marketing-edit"
                value={marketingText}
                onChange={(e) => setMarketingText(e.target.value)}
                placeholder="营销思路拆解建议…"
              />
            )}
          </div>
          <div className="smart__marketing-foot">
            <button type="button" className="smart__btn smart__btn--ghost" onClick={cancelMarketing}>
              上一步
            </button>
            <button
              type="button"
              className="smart__btn smart__btn--primary"
              onClick={confirmMarketing}
              disabled={marketingLoading || !marketingText.trim()}
            >
              确认
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 各步骤内容。0/1 暂为占位(等 Figma/后端);2/3 已接入「修改框 + AI 润色(本地模型)」。
  const renderStepBody = () => {
    // 分镜脚本(step0)/ 准备素材(step1):共用「需求摘要 + 用户上传素材 + 分镜表」。
    // step0 隐藏「准备素材」列;确认脚本后进入 step1,才把 AI 生成的主体素材回填、按图二样式展示。
    if (step === 0 || step === 1) {
      const materialMode = step === 1
      const promptText = requirement || '（未填写需求）'
      return (
        <div className="smart__script">
          {/* 我的描述:直接展示上一步输入框的原始需求(markdown 渲染),只读 */}
          <div className="smart__prompt-label">我的描述：</div>
          <div className="smart__prompt smart__md">
            <Streamdown>{promptText}</Streamdown>
          </div>

          {/* 素材:只展示用户上传的素材(AI 生成的主体不在此展示,见准备素材列)+ 添加 */}
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

          {/* 生成状态 + 分镜表 */}
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
                showSubjects={materialMode}
                onAddMaterial={addShotMaterial}
                onOpenSubject={openSubject}
                /* AI自动生成:不后台直生,改为唤起素材弹窗并在弹窗内自动生成(autoGen),与「上传图片」一致 */
                onShotsChange={setShots}
                onRegenerate={materialMode ? undefined : () => entryMeta && generateScript(requirement, entryMeta)}
                regenerating={scriptLoading}
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
            <div className="smart__placeholder smart__placeholder--sm">暂无分镜,点击下方「重新生成」</div>
          )}
        </div>
      )
    }
    if (step === 2) {
      // 镜头编排:左 分镜列表 + 右 素材修改(元素/分镜图版本/描述修改/台词/字幕/音效)
      return (
        <ShotArrange
          shots={shots}
          generating={shotGen}
          onShotsChange={setShots}
          onUploadRef={uploadRef}
          onGenerateShot={generateShotFromDialog}
          onPolishPrompt={(text) =>
            refineShotPrompt({
              desc: text,
              outline: reqSummary || requirement, // 整体大纲(仅调性参考)
              materials: [],
              style: entryMeta?.style,
              ratio: entryMeta?.ratio,
            }).then((r: any) => r?.prompt || text)
          }
          onPolishText={(kind, text) => polishText(text, { kind })}
        />
      )
    }
    // step === 3 生成视频(第四步):整片视频 + 时间轴选片段 + 片段/整段修改框 + 总按钮(本步不再改分镜)
    return (
      <VideoStage
        shots={shots}
        videoUrl={fullVideo.url}
        videoGenerating={vidGenRunning}
        videoStatusText={blurPhase || undefined}
        faceBlurDebug={blurDebug}
        videoVersions={videoVersions}
        onSwitchVideo={(v) => setFullVideo({ url: v.url, assetId: v.assetId })}
        onRegenerateVideo={runFullVideo}
        faceBlur={faceBlurEnabled}
        onFaceBlurChange={setFaceBlurEnabled}
        onDownloadVideo={handleDownloadVideo}
        onPrev={() => goStep(2)}
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

  // 是否使用了营销 SKILL(决定流程是否多出「营销思路拆解」步、进度条是否整体后移)
  const usedSkill = !!entryMeta?.skill

  return (
    <div className="smart">
      <AppSidebar
        activeKey="creative"
        onNavigate={onNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="smart__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />

        {!started ? (
          // 「上一步」返回输入框时回填上次输入(数据存在本视图 state,路由切换卸载即清空)
          <SmartEntry
            key={entryKey}
            onSubmit={handleStart}
            onNewVideo={resetToNewVideo}
            canResume={canResumeFlow}
            onResume={resumeFlow}
            initial={{
              mode: entryMeta?.mode,
              text: requirement,
              ratio: entryMeta?.ratio,
              duration: entryMeta?.duration,
              images: entryMeta?.images,
              skill: entryMeta?.skill,
            }}
          />
        ) : isImageMode ? (
          // 制作图片:chat 对话视图(消息流 + 沉底输入框,工具栏仅比例 + @)
          <ImageChat
            messages={imageMessages}
            initialRatio={entryMeta?.ratio || '16:9'}
            busy={imageBusy}
            onSend={(text, imgs, r) => sendImageChat(text, imgs, r)}
            onNewChat={() => resetToNewVideo('image')}
          />
        ) : (
          <>
            {/* 进度条:用了 SKILL 时在最前面加一步「营销思路拆解」,索引整体后移 1 */}
            <div className="smart__progress">
              <StepProgress
                steps={usedSkill ? [MARKETING_STEP, ...STEPS] : STEPS}
                current={usedSkill ? (marketingOpen ? 0 : step + 1) : step}
                statuses={(() => {
                  // 4 个流程步的子状态:脚本有分镜 / 已进入镜头编排(素材就绪) / 有任一分镜图 / 有整片视频
                  const done = [shots.length > 0, maxReached >= 2, shots.some((s) => s.image), !!fullVideo.url]
                  const running = [scriptLoading, false, shotGenRunning, vidGenRunning]
                  const flow = STEPS.map((_, i) =>
                    running[i]
                      ? ACTIVE_STATUS[i]
                      : done[i]
                        ? '已完成'
                        : !marketingOpen && i === step
                          ? ACTIVE_STATUS[i]
                          : '待生成',
                  )
                  if (!usedSkill) return flow
                  const mkt = marketingLoading ? '思路拆解中' : marketingText ? '已完成' : '待生成'
                  return [mkt, ...flow]
                })()}
                maxReached={usedSkill ? (marketingOpen ? 0 : maxReached + 1) : maxReached}
                onStepClick={(i) => {
                  if (!usedSkill) return goStep(i)
                  if (i === 0) setMarketingOpen(true)
                  else {
                    setMarketingOpen(false)
                    goStep(i - 1)
                  }
                }}
              />
            </div>

            {/* 项目名 + 改名 */}
            <div className="smart__projbar">
              {/* <button type="button" className="smart__home-link" onClick={() => navigate('/home')}>
                ← 首页
              </button>
              <button
                type="button"
                className="smart__home-link"
                onClick={() => {
                  clearSmartDraft()
                  setStarted(false)
                  setShots([])
                  setRequirement('')
                  setReqSummary('')
                  setEntryMeta(null)
                  setProjectName('未命名项目')
                  setNameTouched(false)
                  setStep(0)
                  setMaxReached(0)
                  setSubjectAssets({})
                  setFields({})
                  setFullVideo({ url: '', assetId: 0 })
                  setVideoVersions([])
                  projectIdRef.current = 0
                  setProjectId(0)
                  draftRevisionRef.current = 0
                  serverTitleRef.current = ''
                  navigate('/smart')
                }}
              >
                ＋ 新建
              </button> */}
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

            {/* 步骤内容:营销思路拆解步 / 现有流程步 */}
            <div className="smart__body">{marketingOpen ? renderMarketingBody() : renderStepBody()}</div>

            {/* 底栏:上一步/下一步 导航箭头 + 各步主操作按钮(整组居中)。
                视频生成步(step3)总按钮在中间 VideoStage 内,这里不渲染。 */}
            {!marketingOpen && step !== 3 && (
              <footer className="smart__footer smart__footer--center">
                <div className="smart__footer-inner">
                  {/* 上一步(悬停 tooltip:上一步) */}
                  <button
                    type="button"
                    className="smart__nav-btn"
                    onClick={goPrev}
                    aria-label="上一步"
                    data-tip="上一步"
                  >
                    <svg width="26" height="21" viewBox="0 0 29 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M27.8881 22.0104L28.1187 21.8116C28.3625 21.6053 28.5088 21.4777 27.5336 17.4193C25.8513 10.3938 19.1616 5.85705 11.6728 5.18001V0L0 9.06596L11.6728 18.1319V12.95C16.5247 12.5824 20.7876 13.0063 23.6458 16.0708C25.0542 17.588 26.7515 20.585 27.1585 21.4684C27.2166 21.594 27.3217 21.8247 27.5786 21.911L27.8881 22.0104Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                  {/* 下一步:仅在已生成的步骤间导航;前沿置灰(悬停 tooltip:下一步) */}
                  <button
                    type="button"
                    className="smart__nav-btn"
                    onClick={goNext}
                    disabled={!canGoNext}
                    aria-label="下一步"
                    data-tip="下一步"
                  >
                    <svg width="27" height="27" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M2.11194 25.7576L1.88126 25.5588C1.63745 25.3525 1.49117 25.2249 2.4664 21.1664C4.14869 14.141 10.8384 9.60425 18.3272 8.92721V3.74719L30 12.8132L18.3272 21.8791V16.6972C13.4753 16.3296 9.21243 16.7535 6.35423 19.818C4.94576 21.3352 3.24847 24.3322 2.8415 25.2156C2.78336 25.3412 2.67833 25.5719 2.42139 25.6582L2.11194 25.7576Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                  {/* 各步主操作按钮 */}
                  {bottomButtons.map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      className={`smart__btn smart__btn--${b.variant}`}
                      onClick={b.action}
                      disabled={b.disabled}
                    >
                      {b.icon}
                      {b.label}
                    </button>
                  ))}
                </div>
              </footer>
            )}
          </>
        )}
      </div>

      <SubjectAssetDialog
        /* 按主体名隔离实例:某主体生成/优化中,切到别的主体不会串状态(各自独立) */
        key={subjectDlg.name}
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
            ? undefined // 已有润色过/编辑过的提示词,直接显示,不再润色
            : (intent: string) =>
                refineElementPrompt(intent, {
                  name: subjectDlg.name,
                  kind: subjectDlg.kind,
                  style: entryMeta?.style,
                })
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
