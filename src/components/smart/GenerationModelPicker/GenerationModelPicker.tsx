import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { GenerationModelConstraints } from '@/utils/modelRestrictions'
import styles from './GenerationModelPicker.module.less'

/** 后端模型版本 ID；同时兼容数字 ID 和字符串 ID。 */
export type GenerationModelId = number | string

/** 单个可选模型；名称、描述和标签均直接展示调用方传入的后端数据。 */
export interface GenerationModelOption {
  id: GenerationModelId
  name: string
  description?: string
  tags?: string[]
  /** 从后端模型限制字段与 params_schema 生成的用户提示。 */
  restrictions?: string[]
  /** 入口页用于校验时长、比例是否兼容的结构化后端约束。 */
  constraints?: GenerationModelConstraints
  disabled?: boolean
  unavailableReason?: string
}

/** 一个阶段内的细分操作，例如图片阶段可以分别传入文生图和图生图。 */
export interface GenerationModelSubgroup {
  /** 建议直接使用后端 operationCode，作为 selected 的键。 */
  key: string
  label: string
  description?: string
  models: GenerationModelOption[]
  required?: boolean
}

/** 流程中的模型阶段；没有模型及非空子操作的阶段不会渲染。 */
export interface GenerationModelGroup {
  /** 无子操作时建议直接使用后端 operationCode，作为 selected 的键。 */
  key: string
  label: string
  description?: string
  models?: GenerationModelOption[]
  subgroups?: GenerationModelSubgroup[]
  required?: boolean
}

/** 每个 operationCode/groupKey 当前选中的后端模型版本 ID。 */
export type GenerationModelSelection = Record<string, GenerationModelId | null | undefined>

/** 支持整块加载，也支持按 operationCode/groupKey 分别标记加载状态。 */
export type GenerationModelLoadingState = boolean | Record<string, boolean | undefined>

/** 支持整块错误，也支持按 operationCode/groupKey 分别提供错误信息。 */
export type GenerationModelErrorState = string | null | Record<string, string | null | undefined>

export interface GenerationModelPickerProps {
  groups: GenerationModelGroup[]
  selected: GenerationModelSelection
  loading?: GenerationModelLoadingState
  error?: GenerationModelErrorState
  /**
   * groupKey 表示所属流程阶段；存在子操作时 subgroupKey 是实际 operationCode，
   * 不存在子操作时 modelId 对应 groupKey。
   */
  onChange: (groupKey: string, modelId: GenerationModelId, subgroupKey?: string) => void
  onRetry?: (groupKey?: string, subgroupKey?: string) => void
  title?: ReactNode
  description?: ReactNode
  /** 紧凑模式保留完整轨道；传入 activeStageKey 时只展开当前阶段的配置。 */
  compact?: boolean
  activeStageKey?: string
  /** 允许用户折叠每个阶段的模型卡片。 */
  collapsible?: boolean
  className?: string
}

interface SelectionSlot {
  key: string
  groupKey: string
  subgroupKey?: string
  required: boolean
  models: GenerationModelOption[]
}

const hasModels = (models?: GenerationModelOption[]) => Boolean(models?.length)

/** 只保留真正有可选模型的阶段和子操作，防止模型接口返回空数组时出现空白卡片。 */
function normalizeGroups(groups: GenerationModelGroup[]): GenerationModelGroup[] {
  return groups.flatMap((group) => {
    const subgroups = group.subgroups?.filter((subgroup) => hasModels(subgroup.models)) ?? []
    if (!hasModels(group.models) && subgroups.length === 0) return []
    return [{ ...group, subgroups }]
  })
}

function slotsOf(groups: GenerationModelGroup[]): SelectionSlot[] {
  return groups.flatMap((group) => {
    const slots: SelectionSlot[] = []
    if (hasModels(group.models)) {
      slots.push({
        key: group.key,
        groupKey: group.key,
        required: group.required !== false,
        models: group.models!,
      })
    }
    for (const subgroup of group.subgroups ?? []) {
      slots.push({
        key: subgroup.key,
        groupKey: group.key,
        subgroupKey: subgroup.key,
        required: subgroup.required !== false,
        models: subgroup.models,
      })
    }
    return slots
  })
}

function sameId(left: GenerationModelId | null | undefined, right: GenerationModelId): boolean {
  return left != null && String(left) === String(right)
}

function hasValidSelection(slot: SelectionSlot, selected: GenerationModelSelection): boolean {
  return slot.models.some((model) => !model.disabled && sameId(selected[slot.key], model.id))
}

/** 返回当前配置仍缺少选择的必选 operationCode，可直接用于“下一步”门禁。 */
export function getMissingGenerationModelKeys(
  groups: GenerationModelGroup[],
  selected: GenerationModelSelection,
): string[] {
  return slotsOf(normalizeGroups(groups))
    .filter((slot) => slot.required && !hasValidSelection(slot, selected))
    .map((slot) => slot.key)
}

/** 判断所有非空的必选模型操作是否都已选中可用模型。 */
export function isGenerationModelSelectionComplete(
  groups: GenerationModelGroup[],
  selected: GenerationModelSelection,
): boolean {
  const normalizedGroups = normalizeGroups(groups)
  return slotsOf(normalizedGroups).length > 0 && getMissingGenerationModelKeys(normalizedGroups, selected).length === 0
}

function readLoading(state: GenerationModelLoadingState | undefined, key: string): boolean {
  if (typeof state === 'boolean') return state
  return Boolean(state?.[key])
}

function readError(state: GenerationModelErrorState | undefined, key: string): string {
  if (typeof state === 'string') return state
  return state?.[key] ?? ''
}

/** 渲染一个 operationCode 下的模型单选卡片。 */
function ModelChoiceList({
  groupKey,
  subgroupKey,
  label,
  description,
  models,
  required,
  selected,
  loading,
  error,
  onChange,
  onRetry,
}: {
  groupKey: string
  subgroupKey?: string
  label: string
  description?: string
  models: GenerationModelOption[]
  required: boolean
  selected: GenerationModelId | null | undefined
  loading: boolean
  error: string
  onChange: GenerationModelPickerProps['onChange']
  onRetry?: GenerationModelPickerProps['onRetry']
}) {
  const operationKey = subgroupKey ?? groupKey
  const hasSelectedModel = models.some((model) => !model.disabled && sameId(selected, model.id))

  return (
    <fieldset className={styles.choiceGroup}>
      <legend className={styles.choiceLegend}>
        <span>{label}</span>
        {required && <span className={styles.required}>必选</span>}
      </legend>
      {description && <p className={styles.choiceDescription}>{description}</p>}

      {loading && (
        <div className={styles.inlineState} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          正在加载可用模型…
        </div>
      )}

      {!loading && error && (
        <div className={`${styles.inlineState} ${styles.errorState}`} role="alert">
          <span>{error}</span>
          {onRetry && (
            <button type="button" className={styles.retryButton} onClick={() => onRetry(groupKey, subgroupKey)}>
              重新加载
            </button>
          )}
        </div>
      )}

      {!loading && !error && (
        <div className={styles.modelGrid} role="radiogroup" aria-label={`${label}模型选择`}>
          {models.map((model) => {
            const checked = sameId(selected, model.id)
            const disabled = Boolean(model.disabled)
            return (
              <button
                key={String(model.id)}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={disabled}
                disabled={disabled}
                className={`${styles.modelCard}${checked ? ` ${styles.selected}` : ''}`}
                onClick={() => onChange(groupKey, model.id, subgroupKey)}
              >
                <span className={styles.radioMark} aria-hidden="true">
                  <span />
                </span>
                <span className={styles.modelContent}>
                  <span className={styles.modelName}>{model.name}</span>
                  {model.description && <span className={styles.modelDescription}>{model.description}</span>}
                  {model.tags?.length ? (
                    <span className={styles.modelTags} aria-label="模型标签">
                      {model.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </span>
                  ) : null}
                  {disabled && model.unavailableReason && (
                    <span className={styles.unavailableReason}>{model.unavailableReason}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <span className={styles.selectionAnnouncement} role="status" aria-live="polite">
        {hasSelectedModel ? `${label}已选择模型` : `${label}尚未选择模型`}
      </span>
      <input type="hidden" name={`generation-model-${operationKey}`} value={selected == null ? '' : String(selected)} />
    </fieldset>
  )
}

/** 以动态流程轨道展示各生成阶段，并在每个阶段内选择后端返回的模型。 */
export default function GenerationModelPicker({
  groups,
  selected,
  loading,
  error,
  onChange,
  onRetry,
  title = '生成模型',
  description = '请为每个生成环节选择可用模型',
  compact = false,
  activeStageKey,
  collapsible = false,
  className = '',
}: GenerationModelPickerProps) {
  const normalizedGroups = useMemo(() => normalizeGroups(groups), [groups])
  const slots = useMemo(() => slotsOf(normalizedGroups), [normalizedGroups])
  const selectedCount = slots.filter((slot) => hasValidSelection(slot, selected)).length
  const missingKeys = slots
    .filter((slot) => slot.required && !hasValidSelection(slot, selected))
    .map((slot) => slot.key)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeStageKey ? [activeStageKey] : normalizedGroups[0] ? [normalizedGroups[0].key] : []),
  )

  useEffect(() => {
    const stageKey = activeStageKey || normalizedGroups[0]?.key
    if (!stageKey) return
    setExpanded((current) => {
      if (current.has(stageKey)) return current
      return new Set([...current, stageKey])
    })
  }, [activeStageKey, normalizedGroups])

  const globallyLoading = typeof loading === 'boolean' && loading
  const globalError = typeof error === 'string' ? error : ''

  if (normalizedGroups.length === 0) {
    if (!globallyLoading && !globalError) return null
    return (
      <section className={`${styles.picker} ${styles.standaloneState} ${className}`} aria-label="生成模型">
        {globallyLoading ? (
          <div className={styles.globalState} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            正在加载生成模型…
          </div>
        ) : (
          <div className={`${styles.globalState} ${styles.errorState}`} role="alert">
            <span>{globalError}</span>
            {onRetry && (
              <button type="button" className={styles.retryButton} onClick={() => onRetry()}>
                重新加载
              </button>
            )}
          </div>
        )}
      </section>
    )
  }

  const detailGroups =
    compact && activeStageKey && normalizedGroups.some((group) => group.key === activeStageKey)
      ? normalizedGroups.filter((group) => group.key === activeStageKey)
      : normalizedGroups

  return (
    <section
      className={`${styles.picker}${compact ? ` ${styles.compact}` : ''}${className ? ` ${className}` : ''}`}
      aria-label="生成模型配置"
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{title}</h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        <span
          className={`${styles.completion}${missingKeys.length === 0 ? ` ${styles.complete}` : ''}`}
          role="status"
          aria-live="polite"
        >
          {selectedCount}/{slots.length} 已选择
        </span>
      </header>

      <ol className={styles.track} aria-label="生成模型流程">
        {normalizedGroups.map((group, index) => {
          const groupSlots = slots.filter((slot) => slot.groupKey === group.key)
          const groupComplete = groupSlots.every((slot) => !slot.required || hasValidSelection(slot, selected))
          const active = group.key === activeStageKey
          return (
            <li
              key={group.key}
              className={`${styles.trackItem}${active ? ` ${styles.activeTrack}` : ''}${
                groupComplete ? ` ${styles.completeTrack}` : ''
              }`}
              aria-current={active ? 'step' : undefined}
            >
              <span className={styles.trackDot} aria-hidden="true">
                {groupComplete ? (
                  <svg viewBox="0 0 16 16">
                    <path d="m3.25 8.2 3 3.05 6.5-6.5" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className={styles.trackText}>
                <span>{group.label}</span>
                <small>{groupComplete ? '已选择' : '待选择'}</small>
              </span>
            </li>
          )
        })}
      </ol>

      <div className={styles.stageList}>
        {detailGroups.map((group) => {
          const isExpanded = !collapsible || expanded.has(group.key)
          const groupNumber = normalizedGroups.findIndex((item) => item.key === group.key) + 1
          const bodyId = `generation-model-stage-${groupNumber}`
          const groupLoading = readLoading(loading, group.key)
          const groupError = readError(error, group.key)

          return (
            <section
              key={group.key}
              className={`${styles.stage}${group.key === activeStageKey ? ` ${styles.activeStage}` : ''}`}
              aria-labelledby={`${bodyId}-title`}
            >
              <header className={styles.stageHeader}>
                <span className={styles.stageIndex} aria-hidden="true">
                  {String(groupNumber).padStart(2, '0')}
                </span>
                <div className={styles.stageHeading}>
                  <h3 id={`${bodyId}-title`}>{group.label}</h3>
                  {group.description && <p>{group.description}</p>}
                </div>
                {collapsible && (
                  <button
                    type="button"
                    className={styles.collapseButton}
                    aria-expanded={isExpanded}
                    aria-controls={bodyId}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current)
                        if (next.has(group.key)) next.delete(group.key)
                        else next.add(group.key)
                        return next
                      })
                    }
                  >
                    {isExpanded ? '收起' : '展开'}
                    <svg viewBox="0 0 12 8" aria-hidden="true">
                      <path d="m1.5 2 4.5 4 4.5-4" />
                    </svg>
                  </button>
                )}
              </header>

              {isExpanded && (
                <div className={styles.stageBody} id={bodyId}>
                  {hasModels(group.models) && (
                    <ModelChoiceList
                      groupKey={group.key}
                      label={group.label}
                      models={group.models!}
                      required={group.required !== false}
                      selected={selected[group.key]}
                      loading={groupLoading}
                      error={groupError}
                      onChange={onChange}
                      onRetry={onRetry}
                    />
                  )}
                  {group.subgroups?.map((subgroup) => (
                    <ModelChoiceList
                      key={subgroup.key}
                      groupKey={group.key}
                      subgroupKey={subgroup.key}
                      label={subgroup.label}
                      description={subgroup.description}
                      models={subgroup.models}
                      required={subgroup.required !== false}
                      selected={selected[subgroup.key]}
                      loading={groupLoading || readLoading(loading, subgroup.key)}
                      error={groupError || readError(error, subgroup.key)}
                      onChange={onChange}
                      onRetry={onRetry}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}
