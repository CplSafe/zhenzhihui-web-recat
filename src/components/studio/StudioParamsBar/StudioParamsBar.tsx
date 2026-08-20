/**
 * 生成参数条：折叠态显示「分辨率 · 时长 · 比例 · 数量」摘要，点击浮出档位面板。
 *
 * 档位由父级依据选中模型的后端 schema 推导后传入（见 utils/studioParams.resolveParamOptions），
 * 本组件只负责渲染与回调，不自己决定有哪些档位。
 */
import RatioIcon from '@/components/common/RatioIcon'
import StudioDurationPicker from '@/components/studio/StudioDurationPicker/StudioDurationPicker'
import { useDismissablePopover } from '@/composables/useDismissablePopover'
import type { StudioMode, StudioParamOptions, StudioParams } from '@/utils/studioParams'
import { formatParamsSummary } from '@/utils/studioParams'
import styles from './StudioParamsBar.module.less'

/** 参数条的受控数据与变更回调。 */
export interface StudioParamsBarProps {
  mode: StudioMode
  params: StudioParams
  options: StudioParamOptions
  onChange: (params: StudioParams) => void
  disabled?: boolean
}

/** 渲染生成参数摘要胶囊及其档位弹层。 */
export default function StudioParamsBar({ mode, params, options, onChange, disabled }: StudioParamsBarProps) {
  // 点击弹层外部或按 Esc 关闭，避免遮挡下方的生成按钮。
  const { open, toggle, wrapRef } = useDismissablePopover<HTMLDivElement>()

  const patch = (next: Partial<StudioParams>) => onChange({ ...params, ...next })
  const showDuration = mode === 'video' && options.durations.length > 0

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger}${open ? ` ${styles.isOpen}` : ''}`}
        onClick={toggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span aria-hidden="true">⚙</span>
        <span className={styles.summary}>{formatParamsSummary(mode, params, options)}</span>
        <span className={styles.caret} aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="生成参数">
          {/* 比例：按模型声明的档位渲染，图标形状随比例变化 */}
          {options.ratios.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>{mode === 'video' ? '视频比例' : '图片比例'}</span>
              <div className={styles.ratios}>
                {options.ratios.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`${styles.ratio}${params.ratio === item.value ? ` ${styles.isActive}` : ''}`}
                    onClick={() => patch({ ratio: item.value })}
                  >
                    {/* 与全站其他入口共用同一枚比例图标，保证视觉一致 */}
                    <RatioIcon ratio={item.value} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {options.resolutions.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>分辨率</span>
              <div className={styles.segments}>
                {options.resolutions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`${styles.segment}${params.resolution === value ? ` ${styles.isActive}` : ''}`}
                    onClick={() => patch({ resolution: value })}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showDuration && (
            <div className={styles.field}>
              <span className={styles.label}>
                视频时长 <span className={styles.labelValue}>{params.durationSec}s</span>
              </span>
              {/* 只列模型枚举出的档位；档位多时横向滚动，不产生非法秒数 */}
              <StudioDurationPicker
                options={options.durations}
                value={params.durationSec}
                onChange={(durationSec) => patch({ durationSec })}
                disabled={disabled}
              />
            </div>
          )}

          {options.supportsAudio && (
            <div className={styles.field}>
              <span className={styles.label}>输出声音</span>
              <div className={styles.segments}>
                <button
                  type="button"
                  className={`${styles.segment}${params.generateAudio ? ` ${styles.isActive}` : ''}`}
                  onClick={() => patch({ generateAudio: true })}
                >
                  开
                </button>
                <button
                  type="button"
                  className={`${styles.segment}${params.generateAudio ? '' : ` ${styles.isActive}`}`}
                  onClick={() => patch({ generateAudio: false })}
                >
                  关
                </button>
              </div>
            </div>
          )}

          <div className={styles.field}>
            <span className={styles.label}>生成数量</span>
            <div className={styles.segments}>
              {options.counts.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.segment}${params.count === value ? ` ${styles.isActive}` : ''}`}
                  onClick={() => patch({ count: value })}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
