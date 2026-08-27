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
import styles from '@/components/studio/StudioParamsBar/StudioParamsBar.module.less'

export interface CreativeParamsValue {
  ratio: string
  /** 视频时长（秒）；0 表示尚未选择。 */
  durationSec: number
  resolution: string
  /** 图片模式的单轮出图数量；视频模式忽略。 */
  count: number
}

export interface CreativeParamsOptions {
  ratios: readonly string[]
  /** 可选时长档位（秒，升序）；空数组表示当前模式不需要时长。 */
  durations: readonly number[]
  resolutions: readonly string[]
  /** 图片模式的出图数量档位；空数组表示不展示该行。 */
  counts: readonly number[]
}

export interface CreativeParamsDropdownProps {
  value: CreativeParamsValue
  options: CreativeParamsOptions
  onChange: (next: CreativeParamsValue) => void
  disabled?: boolean
  /** 禁用原因；作为 title 提示，让「点不动」有解释。 */
  disabledHint?: string
}

/** 时长未选时摘要里的占位。 */
const DURATION_PLACEHOLDER = '选择时长'

/** 折叠态摘要：只列当前模式真正在用的几项。 */
function formatSummary(value: CreativeParamsValue, options: CreativeParamsOptions): string {
  const parts: string[] = []
  if (options.ratios.length) parts.push(value.ratio)
  if (options.durations.length) parts.push(value.durationSec > 0 ? `${value.durationSec}s` : DURATION_PLACEHOLDER)
  if (options.resolutions.length) parts.push(value.resolution)
  if (options.counts.length) parts.push(`${value.count}张`)
  return parts.filter(Boolean).join(' · ') || '创作参数'
}

/** 渲染创作参数摘要胶囊及其档位弹层。 */
export default function CreativeParamsDropdown({
  value,
  options,
  onChange,
  disabled = false,
  disabledHint,
}: CreativeParamsDropdownProps) {
  const { open, toggle, wrapRef } = useDismissablePopover<HTMLDivElement>()
  const patch = (next: Partial<CreativeParamsValue>) => onChange({ ...value, ...next })

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger}${open ? ` ${styles.isOpen}` : ''}`}
        onClick={toggle}
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`创作参数，当前 ${formatSummary(value, options)}`}
      >
        <span aria-hidden="true">⚙</span>
        <span className={styles.summary}>{formatSummary(value, options)}</span>
        <span className={styles.caret} aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="创作参数">
          {options.ratios.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>画面比例</span>
              <div className={styles.ratios}>
                {options.ratios.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`${styles.ratio}${value.ratio === item ? ` ${styles.isActive}` : ''}`}
                    onClick={() => patch({ ratio: item })}
                  >
                    {/* 与全站其他入口共用同一枚比例图标，保证视觉一致 */}
                    <RatioIcon ratio={item} />
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}

          {options.resolutions.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>分辨率</span>
              <div className={styles.segments}>
                {options.resolutions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`${styles.segment}${value.resolution === item ? ` ${styles.isActive}` : ''}`}
                    onClick={() => patch({ resolution: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}

          {options.durations.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>
                视频时长{' '}
                <span className={styles.labelValue}>
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

          {options.counts.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>生成数量</span>
              <div className={styles.segments}>
                {options.counts.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`${styles.segment}${value.count === item ? ` ${styles.isActive}` : ''}`}
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
