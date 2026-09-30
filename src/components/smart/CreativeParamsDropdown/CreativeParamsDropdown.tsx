/**
 * 创作参数（画面比例 / 视频时长 / 分辨率 / 出图数量）的弹层选择器。
 *
 * 与 AI 创作台的 StudioParamsBar 共用同一套 UI：折叠态是一枚摘要胶囊，
 * 点开后每个参数一行——比例是「图标 + 文案」的格子，其余是等分档位条，
 * 选中项高亮。两处是同一件事（挑这次生成的画面规格），不该长成两个样子，
 * 所以直接复用它的样式表与时长档位条，而不是另画一套。
 *
 * 档位由调用方按所选模型的 schema 推导后传入，本组件只负责渲染与回调。
 */
import RatioIcon from '@/components/common/RatioIcon'
import StudioDurationPicker from '@/components/studio/StudioDurationPicker/StudioDurationPicker'
import { useDismissablePopover } from '@/composables/useDismissablePopover'
import { isInputDerivedRatioValue } from '@/utils/canvasModelParams'
import { useEffect, useId, useRef } from 'react'
import barStyles from '@/components/studio/StudioParamsBar/StudioParamsBar.module.less'
import styles from './CreativeParamsDropdown.module.less'

export interface CreativeParamsValue {
  ratio: string
  /** 视频时长（秒）；0 表示尚未选择。 */
  durationSec: number
  resolution: string
  /** 图片模式的单轮出图数量；视频模式忽略。 */
  count: number
  /** 是否让模型自动生成背景音；仅在模型 schema 声明了该能力时有意义。 */
  generateAudio: boolean
}

export interface CreativeParamsOptions {
  ratios: readonly string[]
  /** 可选时长档位（秒，升序）；空数组表示当前模式不需要时长。 */
  durations: readonly number[]
  resolutions: readonly string[]
  /** 图片模式的出图数量档位；空数组表示不展示该行。 */
  counts: readonly number[]
  /**
   * 所选模型是否支持自动生成背景音（schema 声明了 generate_audio）。
   *
   * 由调用方读模型 schema 得出：模型没声明这个字段时后端不会接收它，
   * 摆一个点了不生效的开关只会误导用户，所以此时整行不渲染。
   */
  supportsAudio: boolean
}

export interface CreativeParamsDropdownProps {
  value: CreativeParamsValue
  options: CreativeParamsOptions
  onChange: (next: CreativeParamsValue) => void
  disabled?: boolean
  /**
   * 前置条件未满足时的原因。
   *
   * 给了它就不再真的 disabled：原生 disabled 按钮连 click 都不会触发，
   * 用户点上去毫无反应，只能靠悬停看 title——移动端连悬停都没有。
   * 改为照常可点，点击时把原因交给 onBlocked 说出来。
   */
  blockedReason?: string
  /** 前置条件未满足时点击的回调，通常用来 toast 出 blockedReason。 */
  onBlocked?: (reason: string) => void
  /** 变化时自动展开当前模型支持的规格选项。 */
  openSignal?: number
}

/** 时长未选时摘要里的占位。 */
const DURATION_PLACEHOLDER = '选择时长'
const ratioLabel = (ratio: string) => (isInputDerivedRatioValue(ratio) ? '自适应' : ratio)

/** 折叠态摘要：只列当前模式真正在用的几项。 */
function formatSummary(value: CreativeParamsValue, options: CreativeParamsOptions): string {
  const parts: string[] = []
  if (options.ratios.length) parts.push(ratioLabel(value.ratio))
  if (options.durations.length) parts.push(value.durationSec > 0 ? `${value.durationSec}s` : DURATION_PLACEHOLDER)
  if (options.resolutions.length) parts.push(value.resolution)
  if (options.counts.length) parts.push(`${value.count}张`)
  // 关闭态也要出现在摘要里：背景音会实际改变成片内容，
  // 只在开启时显示的话，用户折叠后无从确认自己刚刚关掉了它。
  if (options.supportsAudio) parts.push(value.generateAudio ? '有背景音' : '无背景音')
  return parts.filter(Boolean).join(' · ') || '创作参数'
}

/** 渲染创作参数摘要胶囊及其档位弹层。 */
export default function CreativeParamsDropdown({
  value,
  options,
  onChange,
  disabled = false,
  blockedReason,
  onBlocked,
  openSignal = 0,
}: CreativeParamsDropdownProps) {
  const { open, setOpen, wrapRef } = useDismissablePopover<HTMLDivElement>()
  const adaptiveHintId = useId()
  const previousOpenSignalRef = useRef(openSignal)
  const hoverCloseTimerRef = useRef<number | null>(null)
  const patch = (next: Partial<CreativeParamsValue>) => onChange({ ...value, ...next })

  const openOnHover = () => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current)
      hoverCloseTimerRef.current = null
    }
    if (!blockedReason && !disabled) setOpen(true)
  }

  const scheduleHoverClose = () => {
    if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      hoverCloseTimerRef.current = null
    }, 80)
  }

  useEffect(
    () => () => {
      if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (openSignal === previousOpenSignalRef.current) return
    previousOpenSignalRef.current = openSignal
    if (!blockedReason && !disabled) setOpen(true)
  }, [openSignal, blockedReason, disabled, setOpen])

  return (
    <div className={barStyles.wrap} ref={wrapRef} onMouseEnter={openOnHover} onMouseLeave={scheduleHoverClose}>
      <button
        type="button"
        className={`${barStyles.trigger}${open ? ` ${barStyles.isOpen}` : ''}`}
        onClick={() => {
          if (blockedReason) {
            onBlocked?.(blockedReason)
            return
          }
          // 点击仍作为触屏与键盘的后备操作；鼠标场景由容器悬停展开。
          setOpen(true)
        }}
        disabled={disabled && !blockedReason}
        title={blockedReason || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`创作参数，当前 ${formatSummary(value, options)}`}
      >
        <span aria-hidden="true">⚙</span>
        <span className={barStyles.summary}>{formatSummary(value, options)}</span>
        <span className={barStyles.caret} aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className={`${barStyles.popover} ${styles.popover}`} role="dialog" aria-label="创作参数">
          {options.ratios.length > 0 && (
            <div className={`${barStyles.field} ${styles.field}`}>
              <span className={barStyles.label}>画面比例</span>
              <div className={styles.ratios}>
                {options.ratios.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`${barStyles.ratio}${value.ratio === item ? ` ${barStyles.isActive}` : ''}`}
                    onClick={() => patch({ ratio: item })}
                    aria-pressed={value.ratio === item}
                    aria-describedby={isInputDerivedRatioValue(item) ? adaptiveHintId : undefined}
                  >
                    {/* 与全站其他入口共用同一枚比例图标，保证视觉一致 */}
                    <RatioIcon ratio={item} />
                    {ratioLabel(item)}
                  </button>
                ))}
              </div>
              {options.ratios.some(isInputDerivedRatioValue) && (
                <p className={styles.ratioHint} id={adaptiveHintId}>
                  自适应会根据上传的参考素材确定画面比例；未上传素材时请选择固定比例。
                </p>
              )}
            </div>
          )}

          {options.resolutions.length > 0 && (
            <div className={`${barStyles.field} ${styles.field}`}>
              <span className={barStyles.label}>分辨率</span>
              <div className={barStyles.segments}>
                {options.resolutions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`${barStyles.segment}${value.resolution === item ? ` ${barStyles.isActive}` : ''}`}
                    onClick={() => patch({ resolution: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}

          {options.durations.length > 0 && (
            <div className={`${barStyles.field} ${styles.field}`}>
              <span className={barStyles.label}>
                视频时长{' '}
                <span className={barStyles.labelValue}>
                  {value.durationSec > 0 ? `${value.durationSec}s` : DURATION_PLACEHOLDER}
                </span>
              </span>
              {/* 只列模型枚举出的档位；档位多时横向滚动，不产生非法秒数 */}
              <StudioDurationPicker
                options={[...options.durations]}
                value={value.durationSec}
                onChange={(durationSec) => patch({ durationSec })}
              />
            </div>
          )}

          {options.supportsAudio && (
            <div className={`${barStyles.field} ${styles.field}`}>
              <span className={barStyles.label}>背景音</span>
              <div className={barStyles.segments}>
                {/* 两档而非勾选框：与同弹层里的分辨率/数量档位条同构，读起来是同一类选择 */}
                <button
                  type="button"
                  className={`${barStyles.segment}${value.generateAudio ? ` ${barStyles.isActive}` : ''}`}
                  onClick={() => patch({ generateAudio: true })}
                  aria-pressed={value.generateAudio}
                >
                  生成
                </button>
                <button
                  type="button"
                  className={`${barStyles.segment}${!value.generateAudio ? ` ${barStyles.isActive}` : ''}`}
                  onClick={() => patch({ generateAudio: false })}
                  aria-pressed={!value.generateAudio}
                >
                  不生成
                </button>
              </div>
            </div>
          )}

          {options.counts.length > 0 && (
            <div className={`${barStyles.field} ${styles.field}`}>
              <span className={barStyles.label}>生成数量</span>
              <div className={barStyles.segments}>
                {options.counts.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`${barStyles.segment}${value.count === item ? ` ${barStyles.isActive}` : ''}`}
                    onClick={() => patch({ count: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
