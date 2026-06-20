/**
 * 智能成片 2.1 流程壳子（P0）。
 * 提供:左侧导航 + 顶栏 + 新进度条 + 项目名(可改名) + 各步占位内容 + 各步底部总按钮。
 * 流程:分镜脚本 → 准备素材 → 镜头编排 → 视频生成。
 * 各步具体内容(脚本编辑/素材匹配/镜头编排/视频生成)在后续阶段填充,
 * 大量编排逻辑可复用现有 useCreativeWorkflow / useStoryboard* / useVideoGeneration。
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import StepProgress, { type StepItem } from '@/components/smart/StepProgress'
import EditField from '@/components/smart/EditField'
import { generateProjectName } from '@/api/aiPolish'
import { useToast } from '@/composables/useToast'
import './SmartCreateView.css'

const STEPS: StepItem[] = [
  { key: 'script', label: '分镜脚本' },
  { key: 'material', label: '准备素材' },
  { key: 'shots', label: '镜头编排' },
  { key: 'video', label: '视频生成' },
]

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

export default function SmartCreateView() {
  const navigate = useNavigate()
  const { showToast } = useToast()

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
  const nameAbortRef = useRef<AbortController | null>(null)

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

  // 根据需求自动命名项目(本地 Qwen)。用户已手动改名 / 正在命名 / 需求为空 则跳过。
  const autoNameProject = async () => {
    const req = requirement.trim()
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
      case 0:
        return [
          { label: '重新生成', variant: 'ghost', action: todo('重新生成脚本(待接入)') },
          { label: '确认脚本', variant: 'primary', action: () => goStep(1) },
        ]
      case 1:
        return [
          { label: '上一步', variant: 'ghost', action: () => goStep(0) },
          { label: '生成镜头编排', variant: 'primary', action: () => goStep(2) },
        ]
      case 2:
        return [
          { label: '上一步', variant: 'ghost', action: () => goStep(1) },
          { label: '重新生成镜头编排', variant: 'ghost', action: todo('重新生成镜头编排(待接入)') },
          { label: '生成视频', variant: 'primary', action: () => goStep(3) },
        ]
      case 3:
        return [
          { label: '上一步', variant: 'ghost', action: () => goStep(2) },
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
      return (
        <div className="smart__script">
          <div className="smart__panel-title">创作需求</div>
          <textarea
            className="smart__req-input"
            value={requirement}
            placeholder="描述你想要的视频:主题、风格、时长、要点…(输入后将据此生成分镜脚本,并自动命名项目)"
            onChange={(e) => setRequirement(e.target.value)}
            onBlur={autoNameProject}
          />
          <div className="smart__req-actions">
            <button
              type="button"
              className="smart__btn smart__btn--ghost"
              disabled={!requirement.trim() || naming}
              onClick={autoNameProject}
            >
              {naming ? 'AI 命名中…' : 'AI 命名项目'}
            </button>
            <button
              type="button"
              className="smart__btn smart__btn--primary"
              disabled={!requirement.trim()}
              onClick={() => {
                autoNameProject()
                showToast('分镜脚本生成(待接入后端)', 'info')
              }}
            >
              生成分镜脚本
            </button>
          </div>
          <div className="smart__script-result smart__placeholder smart__placeholder--sm">
            分镜脚本生成结果(可编辑、拆分人物/场景主体)将显示在这里。建设中
          </div>
        </div>
      )
    }
    if (step === 1) {
      return (
        <div className="smart__placeholder">
          准备素材：按主体自动匹配已上传素材；缺失主体可补充上传或 AI 生成。建设中
        </div>
      )
    }
    if (step === 2) {
      // 镜头编排:左为分镜列表(占位),右为镜头内容修改框(已接 AI 润色)
      return (
        <div className="smart__cols">
          <div className="smart__col smart__col--list">
            <div className="smart__panel-title">分镜列表</div>
            <div className="smart__placeholder smart__placeholder--sm">
              分镜列表（hover 居中放大编辑/删除、+ 插入、拖拽排序、… 菜单）。建设中
            </div>
          </div>
          <div className="smart__col smart__col--edit">
            <div className="smart__panel-title">镜头内容修改</div>
            <EditField
              label="镜头描述 / 分镜脚本"
              value={fields.shotDesc || ''}
              onChange={setField('shotDesc')}
              kind="script"
              placeholder="描述这一镜头的画面、运镜、节奏…"
              rows={5}
            />
            <EditField
              label="台词"
              value={fields.shotLine || ''}
              onChange={setField('shotLine')}
              kind="line"
              placeholder="这一镜头的台词…"
            />
          </div>
        </div>
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
      <AppSidebar activeKey="creative" onNavigate={onNavigate} />
      <div className="smart__main">
        {/* 顶栏 */}
        <header className="smart__topbar">
          <div className="smart__brand-spacer" />
          <div className="smart__top-actions">
            <button type="button" className="smart__top-link" onClick={() => navigate('/projects')}>
              会员中心
            </button>
            <span className="smart__user">张小明</span>
          </div>
        </header>

        {/* 进度条 */}
        <div className="smart__progress">
          <StepProgress steps={STEPS} current={step} maxReached={maxReached} onStepClick={goStep} />
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
      </div>
    </div>
  )
}
