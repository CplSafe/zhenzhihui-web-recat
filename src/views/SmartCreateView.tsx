/**
 * 智能成片 2.1 流程壳子（P0）。
 * 提供:左侧导航 + 顶栏 + 新进度条 + 项目名(可改名) + 各步占位内容 + 各步底部总按钮。
 * 流程:分镜脚本 → 准备素材 → 镜头编排 → 视频生成。
 * 各步具体内容(脚本编辑/素材匹配/镜头编排/视频生成)在后续阶段填充,
 * 大量编排逻辑可复用现有 useCreativeWorkflow / useStoryboard* / useVideoGeneration。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import StepProgress, { type StepItem } from '@/components/smart/StepProgress'
import SmartEntry, { type EntryMeta } from '@/components/smart/SmartEntry'
import ScriptStoryboardTable, { type Shot } from '@/components/smart/ScriptStoryboardTable'
import SubjectAssetDialog from '@/components/smart/SubjectAssetDialog'
import SubjectMaterialBoard, { type BoardSubject } from '@/components/smart/SubjectMaterialBoard'
import ShotArrange from '@/components/smart/ShotArrange'
import { Streamdown } from 'streamdown'
import { generateProjectName, summarizeRequirement, refineElementPrompt } from '@/api/aiPolish'
import { generateScriptShotsStream } from '@/api/smartScript'
import { generateImage, sizeForRatio } from '@/api/smartImage'
import { generateShotImage, ensureAssetId, persistImageAsset, refreshAssetUrl } from '@/api/smartShotImage'
import { generateFullVideo } from '@/api/smartVideo'
import { fileToDataUrl } from '@/utils/imageFile'
import VideoStage from '@/components/smart/VideoStage'
import {
  createCreativeProject,
  patchCreativeProject,
  getCreativeProject,
  updateCreativeProjectDraft,
  createCreativeProjectVersion,
} from '@/api/business'
import {
  useWorkspaceId,
  useModelPlanCandidates,
  useWorkspaceSessionStore,
  deriveModelPlanCandidates,
} from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import {
  loadSmartDraft,
  saveSmartDraft,
  clearSmartDraft,
  buildSmartSnapshot,
  parseSmartSnapshot,
  type SmartDraft,
} from '@/utils/smartDraft'
import './SmartCreateView.css'

// 素材在分镜脚本步已准备,去掉「准备素材」步,流程:分镜脚本 → 镜头编排 → 生成视频
const STEPS: StepItem[] = [
  { key: 'script', label: '分镜脚本' },
  { key: 'shots', label: '镜头编排' },
  { key: 'video', label: '生成视频' },
]
// 各步「当前进行中」时的子状态文案(进度条展示)
const ACTIVE_STATUS = ['脚本生成中', '镜头编排中', '视频生成中']

// 从 createCreativeProject 返回里取项目 id(字段名后端不统一,做兜底)
function resolveProjectId(payload: any): number {
  const id = Number([payload?.id, payload?.project?.id, payload?.data?.id].find((v) => Number(v) > 0) || 0)
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
}

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  projects: '/projects',
  resources: '/resources',
}

interface BottomButton {
  label: string
  variant: 'ghost' | 'primary'
  action: () => void
}

const stripAt = (t: string) => String(t || '').replace(/^@/, '').trim()

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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [entryMeta, setEntryMeta] = useState<EntryMeta | null>(null)
  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const [projectName, setProjectName] = useState('未命名项目')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [nameTouched, setNameTouched] = useState(false) // 用户手动改过名后不再自动覆盖
  const [naming, setNaming] = useState(false)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  // 第一步:用户输入的创作需求(后续用于生成分镜脚本 + 自动命名项目)
  const [requirement, setRequirement] = useState('')
  const [reqSummary, setReqSummary] = useState('') // ≤100字核心摘要,用于页面展示
  const [summarizing, setSummarizing] = useState(false)
  const [showFullReq, setShowFullReq] = useState(false)
  const nameAbortRef = useRef<AbortController | null>(null)

  // 分镜脚本(后端 /ai/responses 生成)
  const [shots, setShots] = useState<Shot[]>([])
  const [scriptLoading, setScriptLoading] = useState(false)
  const [scriptError, setScriptError] = useState('')
  const [projectId, setProjectId] = useState(0)
  const projectIdRef = useRef(0)
  const titlePatchedRef = useRef(false)
  const draftRevisionRef = useRef(0) // 后端草稿版本号(乐观并发)
  const [savingVideo, setSavingVideo] = useState(false)

  // ── 主体素材统一管理:同名主体(@闺蜜A)共享素材,选定后所有同名处联动 ──
  // 版本/提示词存 registry;选定的图写回所有同名 subject(供表格 + 镜头编排一致展示)
  // 版本图 url + 其 asset_id(ids[url]=assetId,用于刷新签名URL/持久化,见 hydrate)
  const [subjectAssets, setSubjectAssets] = useState<
    Record<string, { versions: string[]; prompt?: string; sources?: Record<string, 'ai' | 'upload'>; ids?: Record<string, number> }>
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
  const genForSubject = async (name: string, prompt: string) => {
    // prompt 已是弹窗里(经 Qwen 润色或用户编辑过的)干净画面提示词,直接出图;不再二次润色
    const raw = await generateImage({ prompt, size: sizeForRatio(entryMeta?.ratio) })
    // 落库:dataURL → 后端 asset,刷新后不丢图
    const { url, assetId } = await persistImageAsset(Number(workspaceId || 0), raw)
    addSubjectVersion(name, url, assetId, 'ai', prompt)
  }
  const uploadForSubject = async (name: string, url: string) => {
    const out = await persistImageAsset(Number(workspaceId || 0), url)
    addSubjectVersion(name, out.url, out.assetId, 'upload')
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

  // 去重后的主体素材(脚本步 / 镜头编排顶部共用)
  const boardSubjects: BoardSubject[] = (() => {
    const m = new Map<string, BoardSubject>()
    shots.forEach((sh) =>
      sh.subjects.forEach((su) => {
        const n = stripAt(su.tag)
        const cur = m.get(n) || { name: n, kind: su.kind || '', image: '', source: null }
        if (!cur.image && su.image) cur.image = su.image
        if (!cur.kind && su.kind) cur.kind = su.kind
        m.set(n, cur)
      }),
    )
    return [...m.values()].map((s) => ({
      ...s,
      source: s.image ? subjectAssets[s.name]?.sources?.[s.image] || 'upload' : null,
    }))
  })()

  // ── 镜头编排:按 画面描述 + 该镜头素材 + 上一张分镜图(连贯)+ 项目摘要 生成分镜图(后端文/图生图) ──
  const [shotGen, setShotGen] = useState<Record<string, boolean>>({})
  const [shotGenRunning, setShotGenRunning] = useState(false)
  const autoGenRef = useRef(false)

  // 生成单个分镜图:画面描述 + 该镜头素材(多参考图)+ 上一张分镜图(连贯);返回新图 url
  const genShotFrame = async (
    ws: number,
    sh: Shot,
    prevUrl: string,
    cache: Record<string, number>,
    theme: string,
    plans: string[],
    feedback?: string,
    opts: { editPrompt?: string; extraRefUrls?: string[] } = {},
  ) => {
    const isEdit = !!(feedback || opts.editPrompt)
    // 元素(素材)组合:把该镜各元素图作参考,保证同一元素跨镜一致
    const subjUrls = Array.from(new Set(sh.subjects.map((s) => s.image).filter(Boolean))) as string[]
    const refIds: number[] = []
    for (const u of subjUrls) {
      try {
        const id = await ensureAssetId(ws, u, cache)
        if (id) refIds.push(id)
      } catch {
        /* 单张参考上传失败则跳过 */
      }
    }
    // 改图:以当前分镜图为底图(img2img);否则用上一张做连贯参考
    const baseUrl = isEdit ? sh.image || '' : prevUrl
    if (baseUrl) {
      try {
        const id = await ensureAssetId(ws, baseUrl, cache)
        if (id) refIds.push(id)
      } catch {
        /* ignore */
      }
    }
    // 方式2:用户额外上传的参考图(文字+图改图)
    for (const u of opts.extraRefUrls || []) {
      try {
        const id = await ensureAssetId(ws, u, cache)
        if (id) refIds.push(id)
      } catch {
        /* ignore */
      }
    }
    // 提示词:① 用户编辑过的 imagePrompt 直接用;② 否则按 画面描述+主题+风格 组合
    const prompt = opts.editPrompt
      ? [opts.editPrompt, feedback && `修改要求:${feedback}`].filter(Boolean).join(';')
      : [
          sh.desc,
          feedback && `修改要求:${feedback}`,
          theme && `整体广告主题:${theme}`,
          entryMeta?.style && `${entryMeta.style}风格`,
          isEdit
            ? '在当前画面基础上按修改要求调整,保持其余部分一致'
            : prevUrl && '与上一镜头保持人物形象、场景、配色、画风一致',
          '画面比例 ' + (entryMeta?.ratio || '16:9'),
        ]
          .filter(Boolean)
          .join(';')
    let url = ''
    let assetId = 0
    try {
      // 优先后端文/图生图(带素材组合 + 连贯)
      const r = await generateShotImage({ workspaceId: ws, prompt, refAssetIds: refIds, modelPlanCandidates: plans })
      url = r.url
      assetId = Number(r.assetId || 0) || 0
    } catch {
      // 后端未启用图像模型等失败 → 退化本地 Qwen-Image(文生图,暂无参考/连贯)
      url = await generateImage({ prompt, size: sizeForRatio(entryMeta?.ratio) })
    }
    // 落库:本地兜底的 dataURL → 后端 asset(刷新不丢图);后端图已是 http,保留其 assetId
    const persisted = await persistImageAsset(ws, url, cache)
    url = persisted.url
    if (persisted.assetId) assetId = persisted.assetId
    setShots((prev) =>
      prev.map((x) =>
        x.id === sh.id
          ? { ...x, image: url, imageAssetId: assetId, imagePrompt: prompt, imageVersions: [...(x.imageVersions || []), url] }
          : x,
      ),
    )
    return url
  }

  // 串行生成全部分镜图
  const generateShotImages = async () => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成分镜图', 'error')
      return
    }
    if (shotGenRunning) return
    setShotGenRunning(true)
    const cache: Record<string, number> = {}
    const theme = (reqSummary || '').slice(0, 60)
    const plans = await resolvePlanCandidates()
    let prevUrl = ''
    try {
      for (const sh of shots) {
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

  // 单镜分镜图重生成:
  //  - 方式1:editPrompt(用户编辑过的"生成提示词")→ 直接按它重生成
  //  - 方式2:feedback(文字修改意见)+ extraRefUrls(额外参考图)→ 以当前图 img2img
  const regenerateShotImage = async (
    sh: Shot,
    opts: { feedback?: string; editPrompt?: string; extraRefUrls?: string[] } = {},
  ) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成', 'error')
      return
    }
    if (shotGen[sh.id]) return
    setShotGen((m) => ({ ...m, [sh.id]: true }))
    try {
      const plans = await resolvePlanCandidates()
      await genShotFrame(ws, sh, '', {}, (reqSummary || '').slice(0, 60), plans, opts.feedback || undefined, {
        editPrompt: opts.editPrompt,
        extraRefUrls: opts.extraRefUrls,
      })
    } catch (e: any) {
      showToast(`分镜「${sh.no}」生成失败:${e?.message || ''}`, 'error')
    } finally {
      setShotGen((m) => ({ ...m, [sh.id]: false }))
    }
  }

  // 上传替换某元素(素材),写回所有同名 subject
  const uploadElement = async (name: string, file: File) => {
    const url = await fileToDataUrl(file).catch(() => '')
    if (url) uploadForSubject(name, url)
  }

  // 进入镜头编排:若分镜图尚未生成,则自动串行逐个生成(左侧缩略图转圈)
  useEffect(() => {
    if (step !== 1 || !shots.length || shotGenRunning) return
    if (autoGenRef.current) return
    if (shots.some((s) => s.image)) return // 已有分镜图(含草稿恢复)→ 不自动重生成
    autoGenRef.current = true
    void generateShotImages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shots])

  // ── 生成视频:整片一次生成(所有分镜图+脚本+台词+字幕+音效 → seedance)──
  const [fullVideo, setFullVideo] = useState<{ url: string; assetId: number }>({ url: '', assetId: 0 })
  const [vidGenRunning, setVidGenRunning] = useState(false)
  const autoVidRef = useRef(false)

  // 生成/重生成整片;note=对整片的修改意见(有意见且已有整片时,用上次整片作 video 输入)
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
    setVidGenRunning(true)
    try {
      const plans = await resolvePlanCandidates()
      const cache: Record<string, number> = {}
      // 取第一张分镜图作参考(seedance 只收一张)
      const firstImg = shots.find((s) => s.image)?.image || ''
      let imageAssetId = 0
      if (firstImg) {
        try {
          imageAssetId = await ensureAssetId(ws, firstImg, cache)
        } catch {
          /* 无参考图则纯文生视频 */
        }
      }
      const { url, assetId } = await generateFullVideo({
        workspaceId: ws,
        shots,
        basePrompt: reqSummary || requirement,
        ratio: entryMeta?.ratio,
        style: entryMeta?.style,
        imageAssetId,
        prevVideoAssetId: fullVideo.assetId,
        note,
        modelPlanCandidates: plans,
      })
      setFullVideo({ url, assetId })
    } catch (e: any) {
      showToast(`视频生成失败:${e?.message || ''}`, 'error')
    } finally {
      setVidGenRunning(false)
    }
  }

  // 进入生成视频:若整片尚未生成,则自动生成一次
  useEffect(() => {
    if (step !== 2 || !shots.length || vidGenRunning) return
    if (autoVidRef.current) return
    if (fullVideo.url) return
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
  }, [shots])

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
      sh.subjects.forEach((su) => {
        if (su.assetId) ids.add(Number(su.assetId))
      })
    })
    Object.values(subjectAssets).forEach((e: any) =>
      Object.values(e?.ids || {}).forEach((id: any) => {
        if (id) ids.add(Number(id))
      }),
    )
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
        prev.map((sh) => ({
          ...sh,
          image: sh.imageAssetId && map.get(Number(sh.imageAssetId)) ? map.get(Number(sh.imageAssetId))! : sh.image,
          subjects: sh.subjects.map((su) =>
            su.assetId && map.get(Number(su.assetId)) ? { ...su, image: map.get(Number(su.assetId))! } : su,
          ),
        })),
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
    })()
  }, [workspaceId, started, shots, subjectAssets])

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
    autoGenRef.current = true // 已有分镜图/草稿,进入镜头编排不自动重生成
    autoVidRef.current = true
  }

  // 把当前草稿写到后端(带 draft_revision 乐观并发;409 冲突拉新版本号重试一次)。返回是否成功。
  const putSmartDraftToBackend = async (): Promise<boolean> => {
    const id = projectIdRef.current
    const ws = Number(workspaceId || 0)
    if (!id || !ws) return false
    const snapshot = buildSmartSnapshot(currentDraft())
    const apply = (payload: any) => {
      const next = Number(payload?.draft_revision ?? payload?.data?.draft_revision)
      if (Number.isFinite(next)) draftRevisionRef.current = next
    }
    try {
      apply(await updateCreativeProjectDraft({ projectId: id, workspaceId: ws, draft: snapshot, draftRevision: draftRevisionRef.current }))
      return true
    } catch (e: any) {
      if (e?.status !== 409) return false
      // 草稿在别处更新:重新拉版本号后重试一次
      try {
        const proj: any = await getCreativeProject({ projectId: id, workspaceId: ws })
        draftRevisionRef.current = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
        apply(await updateCreativeProjectDraft({ projectId: id, workspaceId: ws, draft: snapshot, draftRevision: draftRevisionRef.current }))
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
      titlePatchedRef.current = true // 既有项目,标题不自动回写
      getCreativeProject({ projectId: rid, workspaceId: ws })
        .then((proj: any) => {
          draftRevisionRef.current = Number(proj?.draft_revision ?? proj?.data?.draft_revision ?? 0) || 0
          const draftJson = proj?.draft_json ?? proj?.data?.draft_json ?? proj?.draft
          const d = parseSmartSnapshot(draftJson)
          if (d) applyDraft(d)
          const t = String(proj?.title || proj?.name || '').trim()
          if (t) setProjectName(t)
        })
        .catch(() => showToast('项目加载失败', 'error'))
    } else {
      hydratedRef.current = true
      const d = loadSmartDraft()
      if (d && d.started) {
        applyDraft(d)
        if (d.projectId) {
          setProjectId(d.projectId)
          projectIdRef.current = d.projectId
        }
      }
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
  }, [started, requirement, reqSummary, entryMeta, projectName, nameTouched, step, maxReached, shots, subjectAssets, fields, projectId, fullVideo])

  const goStep = (i: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i))
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

  // 项目名就绪后回写后端标题(best-effort,一次)
  useEffect(() => {
    const wsId = Number(workspaceId || 0)
    if (!projectId || !wsId || titlePatchedRef.current) return
    const t = projectName.trim()
    if (!t || t === '未命名项目') return
    titlePatchedRef.current = true
    patchCreativeProject({ projectId, workspaceId: wsId, title: t }).catch(() => {})
  }, [projectId, projectName, workspaceId])

  const handleStart = (req: string, meta: EntryMeta) => {
    setRequirement(req)
    setEntryMeta(meta)
    setStarted(true)
    setStep(0)
    setMaxReached(0)
    setShowFullReq(false)
    setShots([])
    setScriptError('')
    if (req) void autoNameProject(req)
    // 后端建项目(best-effort,使其出现在项目管理/历史)
    const wsId = Number(workspaceId || 0)
    if (wsId && !projectIdRef.current) {
      draftRevisionRef.current = 0
      titlePatchedRef.current = false
      createCreativeProject({ workspace_id: wsId })
        .then((p: any) => {
          const id = resolveProjectId(p)
          projectIdRef.current = id
          setProjectId(id)
        })
        .catch(() => {})
    }
    void generateScript(req, meta)
    // 长需求 → AI 摘要成 ≤100 字展示;短需求直接用原文
    if (req.trim().length > 90) {
      setSummarizing(true)
      summarizeRequirement(req)
        .then((s) => setReqSummary(s || req))
        .catch(() => setReqSummary(req))
        .finally(() => setSummarizing(false))
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

  // 保存视频:先把草稿写后端,再建「视频保存 …」版本(项目管理页据此展示成片,见 ProjectManagementView)
  const handleSaveVideo = async () => {
    const ws = Number(workspaceId || 0)
    const id = projectIdRef.current
    if (!ws || !id) {
      showToast('项目尚未建立,无法保存', 'error')
      return
    }
    if (!fullVideo.url) {
      showToast('请先生成视频再保存', 'info')
      return
    }
    if (savingVideo) return
    setSavingVideo(true)
    try {
      const ok = await putSmartDraftToBackend()
      if (!ok) throw new Error('草稿保存失败')
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
      await createCreativeProjectVersion({ projectId: id, workspaceId: ws, label: `视频保存 ${stamp}` })
      showToast('已保存到 项目管理', 'success')
    } catch (e: any) {
      showToast(e?.message || '保存失败,请重试', 'error')
    } finally {
      setSavingVideo(false)
    }
  }

  const bottomButtons: BottomButton[] = (() => {
    switch (step) {
      case 0: // 分镜脚本
        return [
          { label: '上一步', variant: 'ghost', action: () => setStarted(false) },
          {
            label: scriptLoading ? '生成中…' : '重新生成',
            variant: 'ghost',
            action: () => entryMeta && generateScript(requirement, entryMeta),
          },
          {
            label: '生成镜头编排',
            variant: 'primary',
            action: () => {
              autoGenRef.current = false // 允许进入后自动生成
              goStep(1)
            },
          },
        ]
      case 1: // 镜头编排
        return [
          { label: '上一步', variant: 'ghost', action: () => goStep(0) },
          {
            label: shotGenRunning ? '生成中…' : '重新生成镜头编排',
            variant: 'ghost',
            action: () => generateShotImages(),
          },
          {
            label: '生成视频',
            variant: 'primary',
            action: () => {
              autoVidRef.current = false
              goStep(2)
            },
          },
        ]
      case 2: // 生成视频:总按钮已移到中间 VideoStage,这里不再渲染底部条
        return []
      default:
        return []
    }
  })()

  // 各步骤内容。0/1 暂为占位(等 Figma/后端);2/3 已接入「修改框 + AI 润色(本地模型)」。
  const renderStepBody = () => {
    if (step === 0) {
      const promptText = reqSummary || requirement || '（未填写需求）'
      return (
        <div className="smart__script">
          {/* 需求摘要(markdown 渲染) */}
          <div className="smart__prompt smart__md">
            {summarizing ? '生成摘要中…' : <Streamdown>{promptText}</Streamdown>}
          </div>
          {requirement && requirement !== reqSummary && (
            <button type="button" className="smart__req-toggle" onClick={() => setShowFullReq((v) => !v)}>
              {showFullReq ? '收起完整需求' : '展开完整需求'}
            </button>
          )}
          {showFullReq && (
            <div className="smart__req-full smart__md">
              <Streamdown>{requirement}</Streamdown>
            </div>
          )}

          {/* 素材缩略图 + 继续添加 */}
          <div className="smart__mats">
            {(entryMeta?.images || []).map((url, i) => (
              <div className="smart__mat" key={i}>
                <img src={url} alt="" />
              </div>
            ))}
            <button type="button" className="smart__mat-add" onClick={todo('添加素材(待接入)')} aria-label="添加素材">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          {/* 顶部素材主体总览(左用户上传 / 右 AI 生成,点开统一管理) */}
          <SubjectMaterialBoard subjects={boardSubjects} onOpen={(name) => openSubject(name)} />

          {/* 生成状态 + 分镜表 */}
          <div className="smart__script-done">
            <span className="smart__script-done-icon" aria-hidden="true">💡</span>
            {scriptLoading ? '分镜脚本生成中…' : scriptError ? '分镜脚本生成失败' : '分镜脚本生成完成'}
          </div>
          {shots.length ? (
            <>
              <ScriptStoryboardTable shots={shots} onOpenSubject={openSubject} />
              {scriptLoading && (
                <div className="smart__placeholder smart__placeholder--xs">分镜持续生成中…</div>
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
    if (step === 1) {
      // 镜头编排:左 分镜列表 + 右 素材修改(元素/分镜图版本/描述修改/台词/字幕/音效)
      return (
        <ShotArrange
          shots={shots}
          generating={shotGen}
          onShotsChange={setShots}
          onOpenElement={openSubject}
          onUploadElement={uploadElement}
          onRegenerateImage={regenerateShotImage}
        />
      )
    }
    // step === 2 生成视频:左 分镜列表 + 中 整片视频 + 右 素材修改;总按钮在中间
    return (
      <VideoStage
        shots={shots}
        generating={shotGen}
        videoUrl={fullVideo.url}
        videoGenerating={vidGenRunning}
        onShotsChange={setShots}
        onOpenElement={openSubject}
        onUploadElement={uploadElement}
        onRegenerateImage={regenerateShotImage}
        onRegenerateVideo={runFullVideo}
        onSaveVideo={handleSaveVideo}
        savingVideo={savingVideo}
        onPrev={() => goStep(1)}
      />
    )
  }

  return (
    <div className="smart">
      <AppSidebar
        activeKey="creative"
        onNavigate={onNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="smart__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} onMember={() => showToast('会员中心待开放', 'info')} />

        {!started ? (
          <SmartEntry onSubmit={handleStart} />
        ) : (
          <>
            {/* 进度条 */}
            <div className="smart__progress">
              <StepProgress
                steps={STEPS}
                current={step}
                statuses={STEPS.map((_, i) => (i < step ? '已完成' : i === step ? ACTIVE_STATUS[i] : '待生成'))}
                maxReached={maxReached}
                onStepClick={goStep}
              />
            </div>

            {/* 项目名 + 改名 */}
            <div className="smart__projbar">
          <button type="button" className="smart__home-link" onClick={() => navigate('/home')}>
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
              projectIdRef.current = 0
              setProjectId(0)
              draftRevisionRef.current = 0
              titlePatchedRef.current = false
              navigate('/smart')
            }}
          >
            ＋ 新建
          </button>
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
              <span>{projectName}</span>
              {naming && <span className="smart__name-naming">AI 命名中…</span>}
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17v3z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>

            {/* 步骤内容 */}
            <div className="smart__body">{renderStepBody()}</div>

            {/* 底部总按钮(视频生成步的总按钮在中间 VideoStage 内) */}
            {bottomButtons.length > 0 && (
              <footer className="smart__footer">
                {bottomButtons.map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    className={`smart__btn smart__btn--${b.variant}`}
                    onClick={b.action}
                  >
                    {b.label}
                  </button>
                ))}
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
            ? undefined // 已有润色过/编辑过的提示词,直接显示,不再润色
            : (intent: string) =>
                refineElementPrompt(intent, {
                  name: subjectDlg.name,
                  kind: subjectDlg.kind,
                  style: entryMeta?.style,
                })
        }
        onClose={() => setSubjectDlg((d) => ({ ...d, open: false }))}
        onGenerate={(p) => genForSubject(subjectDlg.name, p)}
        onSelect={(url) => applySubjectImage(subjectDlg.name, url, subjectAssets[subjectDlg.name]?.ids?.[url] || 0)}
        onUpload={(url) => uploadForSubject(subjectDlg.name, url)}
      />
    </div>
  )
}
