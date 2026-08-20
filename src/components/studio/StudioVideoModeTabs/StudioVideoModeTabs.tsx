/**
 * 视频生成模式切换（文生视频 / 首尾帧 / 参考生视频）。
 *
 * 可选模式由父级依据所选模型推导后传入（见 utils/studioVideoMode.resolveAvailableVideoModes），
 * 本组件只负责渲染与回调。只有一种可用模式时不渲染，避免出现无意义的单选控件。
 */
import { getVideoModeSpec, type StudioVideoMode } from '@/utils/studioVideoMode'
import styles from './StudioVideoModeTabs.module.less'

/** 模式切换的受控数据与回调。 */
export interface StudioVideoModeTabsProps {
  modes: StudioVideoMode[]
  value: StudioVideoMode
  onChange: (mode: StudioVideoMode) => void
  disabled?: boolean
}

/** 渲染视频生成模式分段控件。 */
export default function StudioVideoModeTabs({ modes, value, onChange, disabled }: StudioVideoModeTabsProps) {
  if (modes.length <= 1) return null

  const activeSpec = getVideoModeSpec(value)

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs} role="tablist" aria-label="视频生成模式">
        {modes.map((mode) => {
          const spec = getVideoModeSpec(mode)
          return (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={`${styles.tab}${mode === value ? ` ${styles.isActive}` : ''}`}
              disabled={disabled}
              onClick={() => onChange(mode)}
            >
              {spec.label}
            </button>
          )
        })}
      </div>
      <p className={styles.description}>{activeSpec.description}</p>
    </div>
  )
}
