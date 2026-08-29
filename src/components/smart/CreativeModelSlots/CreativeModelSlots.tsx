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
  /**
   * 提交预检期间锁定选择。
   *
   * 任务的模型、估价与参数在点下「去制作」那一刻就冻结成快照了；此时还能改模型，
   * 用户会以为自己换掉了本次生成，实际提交的仍是旧模型。锁住比事后解释更诚实。
   */
  locked?: boolean
  /** 锁定时给出的原因，作为胶囊的 title 与无障碍名称后缀。 */
  lockedReason?: string
  /**
   * 展开胶囊时触发，通常用来重新拉取模型目录。
   *
   * 目录加载失败后列表会是空的，用户唯一的自救动作就是再点开看看；
   * 没有这个回调的话，只能刷新整页。
   */
  onOpen?: () => void
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
  locked = false,
  lockedReason = '处理中不可切换',
  onOpen,
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

  /**
   * 「已选」必须以「选中的 ID 在当前目录里还找得到」为准，而不是「selected 里有个非零值」。
   *
   * 模型可能在用户选完之后被下架（后台停用、换套餐、切工作空间），此时 selected 仍留着旧 ID。
   * 只数非零值会把这种情况算成已选满，摘要去查名字却查不到，最后渲染出一个空白胶囊——
   * 用户既看不出选了什么，也看不出需要重选。
   */
  const chosenNames = slots.map(
    (slot) => slot.models.find((model) => !model.disabled && String(model.id) === String(selected[slot.key]))?.name,
  )
  const chosenCount = chosenNames.filter(Boolean).length
  const summary = authRequired
    ? '登录后选择模型'
    : !slots.length
      ? loading
        ? '模型加载中…'
        : '暂无可用模型'
      : chosenCount === slots.length
        ? chosenNames.filter(Boolean).join(' · ')
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
          // 只在「即将展开」时回调：收起也触发会让每次关闭都白拉一次目录。
          if (!open) onOpen?.()
          toggle()
        }}
        disabled={!authRequired && !slots.length}
        title={locked ? lockedReason : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`生成模型，${summary}${locked ? `，${lockedReason}` : ''}`}
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
                disabled={locked}
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
