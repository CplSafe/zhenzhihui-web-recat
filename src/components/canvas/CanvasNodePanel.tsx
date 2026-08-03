/**
 * 节点编辑面板 — 始终显示在页面底部，内容根据选中节点类型切换
 *
 * 文本：模型 + 生成
 * 图片：模型 + 比例 + 生成
 * 视频：模型 + 集合选择器(生成方式/比例/秒数/音频) + 生成
 */
import React, { useState, useRef, useEffect, useMemo } from 'react'
import styles from './CanvasNodePanel.module.css'
import type { GenerationModelOption } from '@/utils/generationModelCatalog'

/** 连线来源引用信息 */
export interface CanvasSourceRef {
  kind: string
  edgeId: string
  slotIndex: number
  /** 来源节点的实际图片/视频地址（有素材内容时用于缩略图显示） */
  thumbnailUrl?: string
}

export interface CanvasNodeInfo {
  id: string
  kind: string
  /** 连线来源引用列表，已按 slotIndex 排序 */
  sourceRefs?: CanvasSourceRef[]
  /** 当前比例（用于回显） */
  ratio?: string
  /** 视频生成方式（用于回显） */
  videoMode?: 'first-last' | 'full-ref'
  /** 当前选中的模型版本 ID（用于回显） */
  modelVersionId?: number
}

interface CanvasNodePanelProps {
  node: CanvasNodeInfo | null
  /** slotIndex 标识槽位：0=首帧, 1=尾帧(视频)；其他节点按顺序 */
  onStartPickRef?: (slotIndex?: number) => void
  onRemoveRef?: (edgeId: string) => void
  /** 比例变更回调，用于同步更新节点宽高 */
  onRatioChange?: (ratio: string) => void
  /** 视频生成方式变更回调 */
  onVideoModeChange?: (mode: 'first-last' | 'full-ref') => void
  /** 模型变更回调 */
  onModelChange?: (modelVersionId: number) => void
  /** 各节点类型对应的可选模型（来自 /api/v1/ai/models） */
  models?: Partial<Record<'text' | 'image' | 'video', GenerationModelOption[]>>
  /** 模型列表加载中 */
  modelsLoading?: boolean
}

type VideoMode = 'first-last' | 'full-ref'

/** 根据比例字符串计算节点尺寸，baseSize 为短边基准 */
export function calcNodeSize(ratio: string, baseSize: number): { width: number; height: number } {
  if (ratio === '自适应') return { width: 444, height: 250 }
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return { width: baseSize, height: baseSize }
  if (w > h) return { width: (baseSize * w) / h, height: baseSize }
  return { width: baseSize, height: (baseSize * h) / w }
}

/** 从 sourceRefs 中找到指定 slotIndex 的引用 */
function findRefBySlot(refs: CanvasSourceRef[] | undefined, slot: number): CanvasSourceRef | undefined {
  return refs?.find((r) => r.slotIndex === slot)
}

export default function CanvasNodePanel({
  node,
  onStartPickRef,
  onRemoveRef,
  onRatioChange,
  onVideoModeChange,
  onModelChange,
  models,
  modelsLoading,
}: CanvasNodePanelProps) {
  const kind = node?.kind || 'text'
  const [prompt, setPrompt] = useState('')
  // 受控回显：优先取节点数据中的比例/模式
  const ratio = node?.ratio || (kind === 'video' ? '自适应' : '1:1')
  const videoMode = (node?.videoMode as VideoMode) || 'first-last'
  // 按 edgeId 去重，兜底防止重复连线/重复记录渲染出重复缩略图
  const sourceRefs = useMemo(() => {
    const seen = new Set<string>()
    return (node?.sourceRefs || []).filter((ref) => {
      if (seen.has(ref.edgeId)) return false
      seen.add(ref.edgeId)
      return true
    })
  }, [node?.sourceRefs])
  const maxRefs = kind === 'video' ? 2 : 3
  const kindModels = models?.[kind as 'text' | 'image' | 'video'] || []

  return (
    <div className={styles.panel}>
      {/* tags / 缩略图 */}
      <div className={styles.tags}>
        {kind === 'video' ? (
          /* 视频节点：首帧(slot=0) / 尾帧(slot=1) 双槽 */
          <div className={styles.refImages}>
            {[0, 1].map((slot) => {
              const ref = findRefBySlot(sourceRefs, slot)
              const title = slot === 0 ? '首帧' : '尾帧'
              return (
                <React.Fragment key={slot}>
                  {slot === 1 && (
                    <span className={styles.refSwapIcon}>
                      <SwapIcon />
                    </span>
                  )}
                  <div className={`${styles.refThumb} ${ref ? '' : styles.refThumbEmpty}`}>
                    {ref ? (
                      <>
                        {ref.thumbnailUrl ? (
                          <img className={styles.refThumbImg} src={ref.thumbnailUrl} alt={title} />
                        ) : ref.kind === 'image' ? (
                          <ImageRefIcon />
                        ) : ref.kind === 'text' ? (
                          <TextRefIcon />
                        ) : (
                          <VideoRefIcon />
                        )}
                        <button
                          className={styles.refDelete}
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveRef?.(ref.edgeId)
                          }}
                        >
                          &times;
                        </button>
                      </>
                    ) : (
                      <button className={styles.refAddBtn} title={title} onClick={() => onStartPickRef?.(slot)}>
                        <PlusSmIcon />
                      </button>
                    )}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        ) : sourceRefs.length > 0 ? (
          <div className={styles.refImages}>
            {sourceRefs.map((ref) => (
              <div
                key={ref.edgeId}
                className={styles.refThumb}
                title={ref.kind === 'text' ? '文本' : ref.kind === 'image' ? '图片' : '视频'}
              >
                {ref.thumbnailUrl ? (
                  <img className={styles.refThumbImg} src={ref.thumbnailUrl} alt={ref.kind} />
                ) : ref.kind === 'text' ? (
                  <TextRefIcon />
                ) : ref.kind === 'image' ? (
                  <ImageRefIcon />
                ) : (
                  <VideoRefIcon />
                )}
                <button
                  className={styles.refDelete}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveRef?.(ref.edgeId)
                  }}
                >
                  &times;
                </button>
              </div>
            ))}
            {sourceRefs.length < maxRefs && (
              <button className={styles.refAddBtn} title="添加参考" onClick={() => onStartPickRef?.(sourceRefs.length)}>
                <PlusSmIcon />
              </button>
            )}
          </div>
        ) : (
          <button className={styles.refAddBtn} title="添加参考" onClick={() => onStartPickRef?.(0)}>
            <PlusSmIcon />
          </button>
        )}
      </div>

      {/* textarea */}
      <textarea
        className={styles.textarea}
        placeholder={`描述你想要生成的${kind === 'video' ? '视频' : ''}内容...`}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {/* 底部操作栏 */}
      <div className={styles.actions}>
        <div className={styles.selectors}>
          <ModelSelector
            kind={kind}
            models={kindModels}
            value={node?.modelVersionId}
            loading={modelsLoading}
            onChange={onModelChange}
          />

          {kind === 'image' && <RatioSelector value={ratio} onRatioChange={onRatioChange} />}

          {kind === 'video' && (
            <VideoComboSelector
              mode={videoMode}
              ratio={ratio}
              onModeChange={onVideoModeChange}
              onRatioChange={onRatioChange}
            />
          )}
        </div>

        <button className={styles.generateBtn}>生成</button>
      </div>
    </div>
  )
}

/* ---------- 子组件：选择器 ---------- */

/** 通用选择器弹出层 */
function SelectorPopover({
  children,
  open,
  onClose,
}: {
  children: React.ReactNode
  open: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open, onClose])
  return open ? (
    <div className={styles.popover} ref={ref}>
      {children}
    </div>
  ) : null
}

/* ── 模型选择器（受控，数据来自 /api/v1/ai/models） ── */
function ModelSelector({
  kind,
  models,
  value,
  loading,
  onChange,
}: {
  kind: string
  models: GenerationModelOption[]
  value?: number
  loading?: boolean
  onChange?: (modelVersionId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const availableModels = models.filter((m) => !m.unavailableReason)
  const selected =
    availableModels.find((m) => m.modelVersionId === value) || (availableModels.length ? availableModels[0] : undefined)
  const display = loading ? '加载中...' : selected?.displayName || '暂无可用模型'

  return (
    <div className={styles.selectorWrap}>
      <button
        className={`${styles.selector} ${availableModels.length === 0 ? styles.selectorDisabled : ''}`}
        onClick={() => {
          if (availableModels.length === 0) return
          setOpen((v) => !v)
        }}
      >
        {display}
      </button>
      {open && availableModels.length > 0 && (
        <SelectorPopover open={open} onClose={() => setOpen(false)}>
          {availableModels.map((m) => (
            <button
              key={m.modelVersionId}
              className={`${styles.popoverItem} ${m.modelVersionId === value ? styles.popoverItemActive : ''}`}
              onClick={() => {
                onChange?.(m.modelVersionId)
                setOpen(false)
              }}
            >
              {m.displayName}
            </button>
          ))}
        </SelectorPopover>
      )}
    </div>
  )
}

/* ── 比例选择器（图片，受控） ── */
function RatioSelector({ value, onRatioChange }: { value: string; onRatioChange?: (r: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.selectorWrap}>
      <button className={styles.selector} onClick={() => setOpen((v) => !v)}>
        <span className={styles.ratioLabel}>{value}</span>
      </button>
      <SelectorPopover open={open} onClose={() => setOpen(false)}>
        {aspectRatios.map((r) => (
          <button
            key={r}
            className={`${styles.popoverItem} ${r === value ? styles.popoverItemActive : ''}`}
            onClick={() => {
              onRatioChange?.(r)
              setOpen(false)
            }}
          >
            {r}
          </button>
        ))}
      </SelectorPopover>
    </div>
  )
}

/* ── 视频集合选择器（受控 mode/ratio） ── */
function VideoComboSelector({
  mode,
  ratio,
  onModeChange,
  onRatioChange,
}: {
  mode: VideoMode
  ratio: string
  onModeChange?: (m: VideoMode) => void
  onRatioChange?: (r: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [seconds, setSeconds] = useState(5)
  const [audio, setAudio] = useState(false)

  const display = `${mode === 'first-last' ? '首尾帧' : '全能参考'} · ${ratio} · ${seconds}秒 · ${audio ? '🔊' : '🔇'}`

  return (
    <div className={styles.selectorWrap}>
      <button className={styles.selector} onClick={() => setOpen((v) => !v)}>
        {display}
      </button>
      <SelectorPopover open={open} onClose={() => setOpen(false)}>
        <div className={styles.videoMenu}>
          {/* 生成方式 */}
          <div className={styles.videoMenuGroup}>
            <div className={styles.videoMenuTitle}>生成方式</div>
            <div className={styles.videoBtnGroup}>
              {(['first-last', 'full-ref'] as VideoMode[]).map((m) => (
                <button
                  key={m}
                  className={`${styles.videoBtnGroupItem} ${mode === m ? styles.videoBtnGroupItemActive : ''}`}
                  onClick={() => onModeChange?.(m)}
                >
                  {m === 'first-last' ? '首尾帧' : '全能参考'}
                </button>
              ))}
            </div>
          </div>

          {/* 比例 */}
          <div className={styles.videoMenuGroup}>
            <div className={styles.videoMenuTitle}>比例</div>
            <div className={styles.videoBtnGroup}>
              {(mode === 'first-last' ? ['自适应'] : aspectRatios).map((r) => (
                <button
                  key={r}
                  className={`${styles.videoBtnGroupItem} ${ratio === r ? styles.videoBtnGroupItemActive : ''}`}
                  onClick={() => onRatioChange?.(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* 秒数 */}
          <div className={styles.videoMenuGroup}>
            <div className={styles.videoMenuTitle}>秒数</div>
            <div className={styles.videoBtnGroup}>
              {secondsOptions.map((s) => (
                <button
                  key={s}
                  className={`${styles.videoBtnGroupItem} ${seconds === s ? styles.videoBtnGroupItemActive : ''}`}
                  onClick={() => setSeconds(s)}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>

          {/* 音频 */}
          <div className={styles.videoMenuGroup}>
            <div className={styles.videoMenuTitle}>音频</div>
            <div className={styles.videoBtnGroup}>
              <button
                className={`${styles.videoBtnGroupItem} ${audio ? styles.videoBtnGroupItemActive : ''}`}
                onClick={() => setAudio(true)}
              >
                开
              </button>
              <button
                className={`${styles.videoBtnGroupItem} ${!audio ? styles.videoBtnGroupItemActive : ''}`}
                onClick={() => setAudio(false)}
              >
                关
              </button>
            </div>
          </div>
        </div>
      </SelectorPopover>
    </div>
  )
}

/* ── 常量 ── */
const aspectRatios = ['2:3', '1:1', '4:3', '16:9', '9:16']
const secondsOptions = [4, 5, 6, 7, 8, 9, 10]

/* ── 小图标 ── */
function PlusSmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  )
}

function TextRefIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <line x1="6" y1="8" x2="14" y2="8" />
      <line x1="6" y1="12" x2="11" y2="12" />
    </svg>
  )
}

function ImageRefIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2" width="16" height="16" rx="3" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
      <path d="M2 14l4.5-4.5 3 3 2.5-2.5 5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VideoRefIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="3" width="16" height="14" rx="2.5" />
      <polygon points="8,7 14,10 8,13" fill="currentColor" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.5 2.85L13 5.35H3M5.5 13.1L3 10.6h10" />
    </svg>
  )
}
