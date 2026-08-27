/**
 * 模型选择器：展示后端返回的模型 logo、名称、描述与供应商/版本标签。
 *
 * 受控组件：可选模型与当前选择由父级持有。logo 取自模型记录（见 utils/studioModelPresentation），
 * 后端没给 logo 时用名称首字母占位，不做任何本地图标兜底。
 */
import { useDismissablePopover } from '@/composables/useDismissablePopover'
import { modelInitial, type StudioModelChoice } from '@/utils/studioModelPresentation'
import styles from './StudioModelPicker.module.less'

/** 模型选择器的受控数据与回调。 */
export interface StudioModelPickerProps {
  models: StudioModelChoice[]
  value: number
  onChange: (modelVersionId: number) => void
  loading?: boolean
  disabled?: boolean
  /** 没有可选模型时展示的兜底描述。 */
  placeholderDescription?: string
  /**
   * 紧凑态：logo 与内边距各收一档。
   * 侧边控制台有整列宽度可用，入口底栏的弹层没有——同一份信息层级，换一个尺寸。
   */
  compact?: boolean
}

/** 渲染带 logo 的模型下拉选择器。 */
export default function StudioModelPicker({
  models,
  value,
  onChange,
  loading,
  disabled,
  placeholderDescription,
  compact = false,
}: StudioModelPickerProps) {
  const { open, setOpen, toggle, wrapRef } = useDismissablePopover<HTMLDivElement>()

  const selected = models.find((model) => model.id === value)
  const title = selected?.name || (loading ? '模型加载中…' : '暂无可用模型')

  return (
    <div className={`${styles.wrap}${compact ? ` ${styles.isCompact}` : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger}${open ? ` ${styles.isOpen}` : ''}`}
        disabled={disabled || !models.length}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择生成模型"
        onClick={toggle}
      >
        <span className={styles.logo} aria-hidden="true">
          {selected?.logo ? (
            <img className={styles.logoImg} src={selected.logo} alt="" loading="lazy" />
          ) : (
            modelInitial(selected?.name || 'AI')
          )}
        </span>
        <span className={styles.body}>
          <span className={styles.name}>{title}</span>
          <span className={styles.desc}>{selected?.description || placeholderDescription || ''}</span>
        </span>
        <span className={styles.caret} aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className={styles.menu} role="listbox" aria-label="可用模型">
          {models.length === 0 ? (
            <p className={styles.empty}>当前工作空间暂无可用模型</p>
          ) : (
            models.map((model) => {
              const active = model.id === value
              const tags = [model.provider, model.version].filter(Boolean)
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`${styles.option}${active ? ` ${styles.isActive}` : ''}`}
                  onClick={() => {
                    onChange(model.id)
                    setOpen(false)
                  }}
                >
                  <span className={styles.optionLogo} aria-hidden="true">
                    {model.logo ? (
                      <img className={styles.logoImg} src={model.logo} alt="" loading="lazy" />
                    ) : (
                      modelInitial(model.name)
                    )}
                  </span>
                  <span className={styles.optionBody}>
                    <span className={styles.optionName}>{model.name}</span>
                    {model.description && <span className={styles.optionDesc}>{model.description}</span>}
                    {(tags.length > 0 || model.restrictions.length > 0) && (
                      <span className={styles.tags}>
                        {tags.map((tag) => (
                          <span key={tag} className={styles.tag}>
                            {tag}
                          </span>
                        ))}
                        {model.restrictions.slice(0, 2).map((text) => (
                          <span key={text} className={styles.tag}>
                            {text}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  {active && (
                    <span className={styles.check} aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
