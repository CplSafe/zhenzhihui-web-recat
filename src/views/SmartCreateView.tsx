/**
 * 智能成片 2.1 流程壳子（P0）。
 * 提供:左侧导航 + 顶栏 + 新进度条 + 项目名(可改名) + 各步占位内容 + 各步底部总按钮。
 * 流程:分镜脚本 → 准备素材 → 镜头编排 → 视频生成。
 * 各步具体内容(脚本编辑/素材匹配/镜头编排/视频生成)在后续阶段填充,
 * 大量编排逻辑可复用现有 useCreativeWorkflow / useStoryboard* / useVideoGeneration。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import StepProgress, { type StepItem } from '@/components/smart/StepProgress'
import EditField from '@/components/smart/EditField'
import SmartEntry, { type EntryMeta } from '@/components/smart/SmartEntry'
import ScriptStoryboardTable, { type Shot } from '@/components/smart/ScriptStoryboardTable'
import SubjectAssetDialog from '@/components/smart/SubjectAssetDialog'
import SubjectMaterialBoard, { type BoardSubject } from '@/components/smart/SubjectMaterialBoard'
import ShotArrange from '@/components/smart/ShotArrange'
import { Streamdown } from 'streamdown'
import { generateProjectName, summarizeRequirement } from '@/api/aiPolish'
import { generateScriptShotsStream } from '@/api/smartScript'
import { generateImage, sizeForRatio } from '@/api/smartImage'
import { generateShotImage, ensureAssetId } from '@/api/smartShotImage'
import { createCreativeProject, patchCreativeProject } from '@/api/business'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { useToast } from '@/composables/useToast'
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

// 准备素材:每个主体只出「单一独立元素」(供镜头编排时再组合),简洁背景、便于抠图合成
function subjectPrompt(name: string, kind: string, style?: string) {
  const probe = name + kind
  const frame = /人物|角色|人|男|女|主角|闺蜜|宝妈|宝爸|学生|白领|model|girl|boy/i.test(probe)
    ? '只有一个人物,单人,全身或半身,正面清晰,纯色简洁背景,不要其他人物、不要文字'
    : /场景|街道|背景|环境|室内|室外|校园|店|路|空间|夜景|门口|广场/i.test(probe)
      ? '空场景/空镜,只有环境与背景,无任何人物、无产品,干净简洁'
      : '只有这一个物体,单个产品特写,白色/纯色背景,不要其他物体、不要文字'
  return [name, frame, style && `${style}视觉风格`, '高清,单一主体,主体居中,便于后续合成']
    .filter(Boolean)
    .join(',')
}

export default function SmartCreateView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const workspaceId = useWorkspaceId()

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

  // ── 主体素材统一管理:同名主体(@闺蜜A)共享素材,选定后所有同名处联动 ──
  // 版本/提示词存 registry;选定的图写回所有同名 subject(供表格 + 镜头编排一致展示)
  const [subjectAssets, setSubjectAssets] = useState<
    Record<string, { versions: string[]; prompt?: string; sources?: Record<string, 'ai' | 'upload'> }>
  >({})
  const [subjectDlg, setSubjectDlg] = useState<{ open: boolean; name: string; kind: string; autoGen: boolean }>({
    open: false,
    name: '',
    kind: '',
    autoGen: false,
  })

  const applySubjectImage = (name: string, url: string) =>
    setShots((prev) =>
      prev.map((sh) => ({
        ...sh,
        subjects: sh.subjects.map((su) => (stripAt(su.tag) === name ? { ...su, image: url } : su)),
      })),
    )
  const subjectKindOf = (name: string) => {
    for (const sh of shots) for (const su of sh.subjects) if (stripAt(su.tag) === name && su.kind) return su.kind
    return ''
  }
  const subjectImageOf = (name: string) => {
    for (const sh of shots) for (const su of sh.subjects) if (stripAt(su.tag) === name && su.image) return su.image
    return ''
  }
  const genForSubject = async (name: string, prompt: string) => {
    const url = await generateImage({ prompt, size: sizeForRatio(entryMeta?.ratio) })
    setSubjectAssets((a) => {
      const e = a[name] || { versions: [] }
      return { ...a, [name]: { versions: [...e.versions, url], prompt, sources: { ...(e.sources || {}), [url]: 'ai' } } }
    })
    applySubjectImage(name, url)
  }
  const uploadForSubject = (name: string, url: string) => {
    setSubjectAssets((a) => {
      const e = a[name] || { versions: [] }
      return {
        ...a,
        [name]: { versions: [...e.versions, url], prompt: e.prompt, sources: { ...(e.sources || {}), [url]: 'upload' } },
      }
    })
    applySubjectImage(name, url)
  }
  const openSubject = (name: string, autoGen = false) =>
    setSubjectDlg({ open: true, name, kind: subjectKindOf(name), autoGen })

  // ── 镜头编排:按 画面描述 + 该镜头素材 + 上一张分镜图(连贯)+ 项目摘要 生成分镜图(后端文/图生图) ──
  const [shotGen, setShotGen] = useState<Record<string, boolean>>({})
  const [shotGenRunning, setShotGenRunning] = useState(false)
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
    let prevAssetId = 0
    try {
      for (const sh of shots) {
        setShotGen((m) => ({ ...m, [sh.id]: true }))
        try {
          // 该镜头素材(去重)→ 参考图
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
          if (prevAssetId) refIds.push(prevAssetId) // 连贯:带上一张分镜图
          const prompt = [
            sh.desc,
            theme && `整体广告主题:${theme}`,
            entryMeta?.style && `${entryMeta.style}风格`,
            prevAssetId && '与上一镜头保持人物形象、场景、配色、画风一致',
            '画面比例 ' + (entryMeta?.ratio || '16:9'),
          ]
            .filter(Boolean)
            .join(';')
          const { url, assetId } = await generateShotImage({ workspaceId: ws, prompt, refAssetIds: refIds })
          setShots((prev) => prev.map((x) => (x.id === sh.id ? { ...x, image: url } : x)))
          // 下一镜头的连贯参考:优先用输出 asset_id,否则回传上传
          prevAssetId = assetId || (await ensureAssetId(ws, url, cache).catch(() => 0)) || prevAssetId
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

  // 把分镜里已有的素材图(AI 匹配/已选)纳入对应主体的版本库
  useEffect(() => {
    setSubjectAssets((prev) => {
      let changed = false
      const next = { ...prev }
      shots.forEach((sh) =>
        sh.subjects.forEach((su) => {
          if (!su.image) return
          const n = stripAt(su.tag)
          const e = next[n] || { versions: [] }
          if (!e.versions.includes(su.image)) {
            // 分镜里已有/匹配的素材默认视为「用户上传」(入口素材匹配而来)
            next[n] = {
              versions: [...e.versions, su.image],
              prompt: e.prompt,
              sources: { ...(e.sources || {}), [su.image]: e.sources?.[su.image] || 'upload' },
            }
            changed = true
          }
        }),
      )
      return changed ? next : prev
    })
  }, [shots])

  // 各修改框文本(临时本地态;后端接入后改为来自分镜数据)。
  const [fields, setFields] = useState<Record<string, string>>({})
  const setField = (key: string) => (v: string) => setFields((f) => ({ ...f, [key]: v }))

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
              goStep(1)
              void generateShotImages()
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
          { label: '生成视频', variant: 'primary', action: () => goStep(2) },
        ]
      case 2: // 生成视频
        return [
          { label: '上一步', variant: 'ghost', action: () => goStep(1) },
          { label: '保存视频', variant: 'ghost', action: todo('保存视频至 项目管理-待归类(待接入)') },
          { label: '重新生成视频', variant: 'primary', action: todo('重新生成视频(待接入)') },
        ]
      default:
        return []
    }
  })()

  // 各步骤内容。0/1 暂为占位(等 Figma/后端);2/3 已接入「修改框 + AI 润色(本地模型)」。
  const renderStepBody = () => {
    if (step === 0) {
      const promptText = reqSummary || requirement || '（未填写需求）'
      // 汇总去重后的主体素材(供顶部总览)
      const subjMap = new Map<string, BoardSubject>()
      shots.forEach((sh) =>
        sh.subjects.forEach((su) => {
          const n = stripAt(su.tag)
          const cur = subjMap.get(n) || { name: n, kind: su.kind || '', image: '', source: null }
          if (!cur.image && su.image) cur.image = su.image
          if (!cur.kind && su.kind) cur.kind = su.kind
          subjMap.set(n, cur)
        }),
      )
      const boardSubjects = [...subjMap.values()].map((s) => ({
        ...s,
        source: s.image ? subjectAssets[s.name]?.sources?.[s.image] || 'upload' : null,
      }))
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
      // 镜头编排:分镜列表(选中/插入/复制/删除/…菜单)+ 素材修改(素材/历史/描述/台词/字幕/音效)
      return (
        <ShotArrange
          shots={shots}
          materials={entryMeta?.images || []}
          generating={shotGen}
          onShotsChange={setShots}
        />
      )
    }
    // step === 3 视频生成:左分镜列表 + 中视频(占位),右素材修改(已接 AI 润色)
    return (
      <div className="smart__cols">
        <div className="smart__col smart__col--list">
          <div className="smart__panel-title">分镜列表</div>
          <div className="smart__placeholder smart__placeholder--sm">分镜列表。建设中</div>
        </div>
        <div className="smart__col smart__col--video">
          <div className="smart__panel-title">视频内容修改</div>
          <div className="smart__video-ph">视频播放 + 帧选择 / 片段编辑。建设中</div>
          <EditField
            label="对整段视频提出修改意见"
            value={fields.videoAll || ''}
            onChange={setField('videoAll')}
            kind="segment"
            placeholder="对整段视频的修改诉求…"
            rows={3}
          />
        </div>
        <div className="smart__col smart__col--edit">
          <div className="smart__panel-title">
            素材修改 <span className="smart__panel-hint">（分镜 1）</span>
          </div>
          <div className="smart__placeholder smart__placeholder--xs">素材 + 上传 + 素材历史。建设中</div>
          {/* 规范第 4 条:素材下方补回缺失的「素材描述」修改框 */}
          <EditField
            label="素材描述"
            value={fields.matDesc || ''}
            onChange={setField('matDesc')}
            kind="generic"
            placeholder="这张素材的核心信息 / 描述…"
            rows={2}
          />
          <EditField
            label="台词"
            value={fields.line || ''}
            onChange={setField('line')}
            kind="line"
            placeholder="分镜中识别到的台词文本…"
          />
          <EditField
            label="字幕"
            value={fields.subtitle || ''}
            onChange={setField('subtitle')}
            kind="subtitle"
            placeholder="分镜中识别到的字幕文本…"
          />
          <EditField
            label="音效"
            value={fields.sound || ''}
            onChange={setField('sound')}
            kind="sound"
            placeholder="分镜中识别到的音效文本…"
          />
        </div>
      </div>
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

            {/* 底部总按钮 */}
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
          subjectPrompt(subjectDlg.name, subjectDlg.kind, entryMeta?.style)
        }
        autoGen={subjectDlg.autoGen}
        onClose={() => setSubjectDlg((d) => ({ ...d, open: false }))}
        onGenerate={(p) => genForSubject(subjectDlg.name, p)}
        onSelect={(url) => applySubjectImage(subjectDlg.name, url)}
        onUpload={(url) => uploadForSubject(subjectDlg.name, url)}
      />
    </div>
  )
}
