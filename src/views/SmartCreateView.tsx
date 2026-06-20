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
  const nameInputRef = useRef<HTMLInputElement | null>(null)

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
    if (v) setProjectName(v)
    setEditingName(false)
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

  const placeholder: Record<number, string> = {
    0: '分镜脚本：输入需求 → 生成分镜脚本（可编辑、拆分人物/场景主体）。建设中',
    1: '准备素材：按主体自动匹配已上传素材；缺失主体可补充上传或 AI 生成。建设中',
    2: '镜头编排：分镜列表（hover 编辑/删除、+插入、拖拽排序、… 菜单）+ 镜头内容修改。建设中',
    3: '视频生成：分镜列表 + 视频内容修改（帧选择/片段编辑/AI 润色）+ 素材修改。建设中',
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
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17v3z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>

        {/* 步骤内容（占位） */}
        <div className="smart__body">
          <div className="smart__placeholder">{placeholder[step]}</div>
        </div>

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
