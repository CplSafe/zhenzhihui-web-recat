/**
 * 入口的模型选择：一枚窄胶囊，点开后每个槽位一行，行内是 AI 创作台同款的模型选择器
 *（logo + 名称 + 描述的卡片列表，选中打勾）。
 *
 * 智能成片一次要定两个模型（生成脚本、生成视频）。两枚创作台胶囊平铺会占掉底栏大半宽度，
 * 所以外层收成一枚摘要胶囊，展开后才铺开——胶囊形态与「创作参数」一致，
 * 内部的选择器则与创作台一致。
 */
import StudioModelPicker from '@/components/studio/StudioModelPicker/StudioModelPicker'
import { useDismissablePopover } from '@/composables/useDismissablePopover'
import type { StudioModelChoice } from '@/utils/studioModelPresentation'
import type {
  GenerationModelGroup,
  GenerationModelOption,
  GenerationModelSelection,
} from '@/components/smart/GenerationModelPicker/GenerationModelPicker'
import barStyles from '@/components/studio/StudioParamsBar/StudioParamsBar.module.less'
import styles from './CreativeModelSlots.module.less'

export interface CreativeModelSlotsProps {
  /** 已按本次创作实际用到的 operation 过滤过的分组。 */
  groups: GenerationModelGroup[]
  selected: GenerationModelSelection
  /** 与旧选择器保持同一签名，便于沿用入口既有的写回逻辑。 */
  onChange: (groupKey: string, modelVersionId: number, subgroupKey?: string) => void
  loading?: boolean
  /** 游客态：胶囊照常展示但点击交由调用方引导登录。 */
  authRequired?: boolean
  onAuthRequired?: () => void
}

/**
 * 把入口的模型选项适配成创作台胶囊需要的形状。
 *
 * 入口这层选项已经是展示态（名称/描述/logo/限制都算好了），不带后端原始记录；
 * provider / version 只用于卡片上的小标签，取不到就留空，不去猜。
 */
function toChoice(option: GenerationModelOption): StudioModelChoice {
  return {
    id: Number(option.id),
    name: option.name,
    description: option.description || '',
    logo: option.logo || '',
    provider: '',
    version: '',
    constraints: option.constraints || {},
    restrictions: option.restrictions || [],
    source: undefined,
  }
}

/** 渲染模型摘要胶囊及其槽位弹层。 */
export default function CreativeModelSlots({
  groups,
  selected,
  onChange,
  loading,
  authRequired = false,
  onAuthRequired,
}: CreativeModelSlotsProps) {
  const { open, toggle, wrapRef } = useDismissablePopover<HTMLDivElement>()

  // 一个 operation 一个槽位；无子分组的分组本身就是槽位。
  const slots = groups.flatMap((group) => {
    const own = group.models?.length
      ? [{ key: group.key, groupKey: group.key, subgroupKey: undefined, label: group.label, models: group.models }]
      : []
    const subs = (group.subgroups ?? [])
      .filter((subgroup) => subgroup.models.length > 0)
      .map((subgroup) => ({
        key: subgroup.key,
        groupKey: group.key,
        subgroupKey: subgroup.key,
        label: subgroup.label,
        models: subgroup.models,
      }))
    return [...own, ...subs]
  })

  const chosenCount = slots.filter((slot) => Number(selected[slot.key] || 0) > 0).length
  const summary = authRequired
    ? '登录后选择模型'
    : !slots.length
      ? loading
        ? '模型加载中…'
        : '暂无可用模型'
      : chosenCount === slots.length
        ? slots
            .map((slot) => slot.models.find((model) => String(model.id) === String(selected[slot.key]))?.name)
            .filter(Boolean)
            .join(' · ')
        : `选择模型 ${chosenCount}/${slots.length}`

  return (
    <div className={barStyles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${barStyles.trigger}${open ? ` ${barStyles.isOpen}` : ''}`}
        onClick={() => {
          if (authRequired) {
            onAuthRequired?.()
            return
          }
          toggle()
        }}
        disabled={!authRequired && !slots.length}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`生成模型，${summary}`}
      >
        <span aria-hidden="true">◇</span>
        <span className={`${barStyles.summary} ${styles.summaryText}`}>{summary}</span>
        <span className={barStyles.caret} aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && slots.length > 0 && (
        <div className={`${barStyles.popover} ${styles.popover}`} role="dialog" aria-label="生成模型">
          {slots.map((slot) => (
            <div className={barStyles.field} key={slot.key}>
              <span className={barStyles.label}>{slot.label}</span>
              <StudioModelPicker
                models={slot.models.filter((model) => !model.disabled).map(toChoice)}
                value={Number(selected[slot.key] || 0)}
                onChange={(modelVersionId) => onChange(slot.groupKey, modelVersionId, slot.subgroupKey)}
                loading={loading}
                placeholderDescription="选择本次创作使用的模型"
                compact
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
