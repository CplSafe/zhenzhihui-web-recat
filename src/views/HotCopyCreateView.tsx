/**
 * HotCopyCreateView — 爆款复制 编排器(两步流程,独立于智能成片)。
 * 流程:① 上传爆款视频 + 替换素材(入口)→ ② 生成视频(video.replicate「做同款」:源视频 role:video + 替换素材 role:image)。
 *
 * 与智能成片不同:不走「脚本→分镜图→video.generate」管线,而是把上传的爆款视频 + 替换素材图
 * 直接喂后端 video.replicate 一锅出片(由后端拆解源视频后用 Seedance 重生成)。
 * 结果支持预览 / 下载 / 重新生成 / 确认修改(片段意见拼进提示词重跑 replicate)。
 * v1 仅会话态,不接后端项目 CRUD / 草稿持久化(刷新不保留)。
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import StepProgress, { type StepItem } from '@/components/smart/StepProgress'
import HotCopyEntry, { type HotCopyEntryPayload } from '@/components/hotcopy/HotCopyEntry'
import VideoStage from '@/components/smart/VideoStage'
import iconProjectEdit from '@/assets/icons/project-edit.svg'
import { replicateHotVideo, uploadHotCopyAsset } from '@/api/hotCopy'
import { editFullVideo } from '@/api/smartVideo'
import { refreshAssetUrl } from '@/api/smartShotImage'
import { generateProjectName } from '@/api/aiPolish'
import {
  useWorkspaceId,
  useModelPlanCandidates,
  useWorkspaceSessionStore,
  deriveModelPlanCandidates,
} from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { downloadToDisk } from '@/utils/downloadToDisk'
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

const DEFAULT_RATIO = '9:16'
const DEFAULT_DURATION_SEC = 15

// 据 Tab + 文案构造 replicate 提示词
function buildBasePrompt(tab: 'remake' | 'replica', text: string): string {
  const intent =
    tab === 'replica'
      ? '精准复刻:尽量 1:1 还原原视频的画面、运镜与节奏'
      : '同款翻拍:保留原视频镜头节奏与爆点结构,把主体替换为提供的替换素材产品'
  return [text.trim(), intent].filter(Boolean).join(';') || '做同款-爆款复制'
}

export default function HotCopyCreateView() {
  const navigate = useNavigate()
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)

  // 入口回填(返回上一步用)
  const [entryInitial, setEntryInitial] = useState<Partial<HotCopyEntryPayload> | undefined>(undefined)
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

  // 据需求自动命名项目(用户已手动改名 / 需求为空则跳过)
  const autoNameProject = async (req: string) => {
    if (nameTouched || !req.trim()) return
    setNaming(true)
    try {
      nameAbortRef.current?.abort()
      const ctrl = new AbortController()
      nameAbortRef.current = ctrl
      const name = await generateProjectName(req, ctrl.signal)
      if (name && !nameTouched) setProjectName(name)
    } catch {
      /* 命名失败保留原名 */
    } finally {
      setNaming(false)
    }
  }

  // 低层:调 video.replicate 出片,写回当前整片 + 版本库
  const doReplicate = async (ws: number, videoAssetId: number, productIds: number[], prompt: string) => {
    const plans = await resolvePlanCandidates()
    const { url, assetId } = await replicateHotVideo({
      workspaceId: ws,
      videoAssetId,
      productAssetIds: productIds,
      prompt,
      ratio: DEFAULT_RATIO,
      durationSec: DEFAULT_DURATION_SEC,
      modelPlanCandidates: plans,
    })
    setFullVideo({ url, assetId })
    setVideoVersions((prev) => [...prev, { url, assetId }])
  }

  // 入口提交:上传本地素材取 asset_id → 直接 video.replicate 出片
  const prepareAndGenerate = async (payload: HotCopyEntryPayload, prompt: string) => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间,无法生成视频', 'error')
      return
    }
    setVidGenRunning(true)
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
      for (const p of payload.products) {
        if (p.isVideo) continue
        if (p.assetId) {
          productIds.push(p.assetId)
          continue
        }
        if (p.file) {
          try {
            const id = await uploadHotCopyAsset(ws, p.file)
            if (id) productIds.push(id)
          } catch {
            /* 单张失败跳过 */
          }
        }
      }
      setSourceVideo({ assetId: videoAssetId, url: videoUrl })
      setProductAssetIds(productIds)

      // ③ 出片
      await doReplicate(ws, videoAssetId, productIds, prompt)
    } catch (e: any) {
      showToast(`视频生成失败:${e?.message || '请重试'}`, 'error')
    } finally {
      setVidGenRunning(false)
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
    if (vidGenRunning) return

    // 「确认修改」:把当前整片当 video 输入,按修改提示在原视频基础上改
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
          ratio: DEFAULT_RATIO,
          durationSec: DEFAULT_DURATION_SEC,
          modelPlanCandidates: plans,
        })
        setFullVideo({ url, assetId })
        setVideoVersions((prev) => [...prev, { url, assetId }])
      } catch (e: any) {
        showToast(`视频修改失败:${e?.message || '请重试'}`, 'error')
      } finally {
        setVidGenRunning(false)
      }
      return
    }

    // 「重新生成」:基于已上传的源视频 + 替换素材重跑 replicate(note=片段/整段修改意见)
    if (!sourceVideo.assetId) {
      showToast('请先上传爆款视频', 'error')
      return
    }
    setVidGenRunning(true)
    try {
      const prompt = [basePrompt, note && `修改要求:${note}`].filter(Boolean).join('\n')
      await doReplicate(ws, sourceVideo.assetId, productAssetIds, prompt)
    } catch (e: any) {
      showToast(`视频生成失败:${e?.message || '请重试'}`, 'error')
    } finally {
      setVidGenRunning(false)
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
    void requireAuth(() => startGenerate(payload))
  }
  const startGenerate = (payload: HotCopyEntryPayload) => {
    const prompt = buildBasePrompt(payload.tab, payload.text)
    setEntryInitial(payload)
    setBasePrompt(prompt)
    setStarted(true)
    setStep(1)
    setMaxReached(1)
    setFullVideo({ url: '', assetId: 0 })
    setVideoVersions([])
    setSourceVideo({ assetId: 0, url: '' })
    setProductAssetIds([])
    if (payload.text.trim()) void autoNameProject(prompt)
    void prepareAndGenerate(payload, prompt)
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
                statuses={['已完成', vidGenRunning ? '视频生成中' : fullVideo.url ? '已完成' : '待生成']}
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

            <div className="smart__body">
              <VideoStage
                shots={[]}
                videoUrl={fullVideo.url}
                videoGenerating={vidGenRunning}
                videoStatusText={vidGenRunning ? '爆款复制生成中…' : undefined}
                videoVersions={videoVersions}
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
