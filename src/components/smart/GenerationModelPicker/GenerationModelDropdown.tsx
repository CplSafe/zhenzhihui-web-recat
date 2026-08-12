import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircleFilled, CloseOutlined, ControlOutlined, DownOutlined, LoadingOutlined } from '@ant-design/icons'
import { openMemberCenter } from '@/stores/ui'
import { getModelConstraintConflicts, type GenerationModelConstraintValues } from '@/utils/modelRestrictions'
import {
  getMissingGenerationModelKeys,
  type GenerationModelErrorState,
  type GenerationModelGroup,
  type GenerationModelId,
  type GenerationModelLoadingState,
  type GenerationModelOption,
  type GenerationModelPickerProps,
  type GenerationModelSelection,
} from './GenerationModelPicker'
import styles from './GenerationModelDropdown.module.less'

interface ModelSelectionSlot {
  key: string
  groupKey: string
  groupLabel: string
  subgroupKey?: string
  label: string
  description?: string
  models: GenerationModelOption[]
}

export interface GenerationModelEstimateResult {
  estimatedCost: number
  balance?: number
  canAfford?: boolean
}

export interface GenerationModelEstimateRequest {
  operationCode: string
  modelVersionId: GenerationModelId
}

export interface GenerationModelDropdownProps {
  groups: GenerationModelGroup[]
  selected: GenerationModelSelection
  loading?: GenerationModelLoadingState
  error?: GenerationModelErrorState
  onChange: GenerationModelPickerProps['onChange']
  onRetry?: GenerationModelPickerProps['onRetry']
  /** 按当前入口参数预估单个模型执行一次所需积分。预估失败不会阻断模型选择。 */
  estimateModelCost?: (request: GenerationModelEstimateRequest) => Promise<GenerationModelEstimateResult>
  /** 用户主动打开模型面板时刷新目录，使后台新上架模型无需整页刷新即可出现。 */
  onOpen?: () => void
  /** 入口提交期间可临时锁定选择，避免同一次创建混入两个模型快照。 */
  locked?: boolean
  /** 保留兼容旧调用；产品入口统一说明“进入流程后沿用本次选择”。 */
  context?: 'entry' | 'generation'
  /** 临时禁用时展示的具体原因，例如“视频正在生成中”。 */
  lockedReason?: string
  /** 当前入口时长或比例与已选模型不兼容时展示并阻止提交。 */
  conflicts?: string[]
  /** 每次递增都会重新强调入口并展开面板，用于用户提交时提示补选模型。 */
  attentionRequest?: number
  /** 强调入口时同步播报的当前校验原因。 */
  attentionMessage?: string
  /** 面板优先与触发器左边或右边对齐；最终位置仍会按视口自动防碰撞。 */
  placement?: 'start' | 'end'
  className?: string
}

function slotsOf(groups: GenerationModelGroup[]): ModelSelectionSlot[] {
  return groups.flatMap((group) => {
    const slots: ModelSelectionSlot[] = []
    if (group.models?.length) {
      slots.push({
        key: group.key,
        groupKey: group.key,
        groupLabel: group.label,
        label: group.label,
        description: group.description,
        models: group.models,
      })
    }
    for (const subgroup of group.subgroups ?? []) {
      if (!subgroup.models.length) continue
      slots.push({
        key: subgroup.key,
        groupKey: group.key,
        groupLabel: group.label,
        subgroupKey: subgroup.key,
        label: subgroup.label,
        description: subgroup.description,
        models: subgroup.models,
      })
    }
    return slots
  })
}

function sameId(left: GenerationModelId | null | undefined, right: GenerationModelId): boolean {
  return left != null && String(left) === String(right)
}

function selectedModelOf(slot: ModelSelectionSlot, selected: GenerationModelSelection): GenerationModelOption | null {
  return slot.models.find((model) => !model.disabled && sameId(selected[slot.key], model.id)) || null
}

function readLoading(state: GenerationModelLoadingState | undefined, slot: ModelSelectionSlot): boolean {
  if (typeof state === 'boolean') return state
  return Boolean(state?.[slot.key] || state?.[slot.groupKey])
}

function readError(state: GenerationModelErrorState | undefined, slot: ModelSelectionSlot): string {
  if (typeof state === 'string') return state
  return state?.[slot.key] || state?.[slot.groupKey] || ''
}

/** 区分“目录加载失败”和“当前套餐没有可用模型”，避免把充值问题误报为系统故障。 */
function isRechargeRequiredError(message: string): boolean {
  return /套餐|会员|订阅|充值|暂无可用.*模型|没有可用.*模型/.test(message)
}

/** 返回入口当前画幅/时长与已选后端模型之间的冲突。 */
export function getGenerationModelSelectionConflicts(
  groups: GenerationModelGroup[],
  selected: GenerationModelSelection,
  values: GenerationModelConstraintValues,
): string[] {
  return slotsOf(groups).flatMap((slot) => {
    const model = selectedModelOf(slot, selected)
    if (!model) return []
    const operationUsesDuration = slot.key.startsWith('video.')
    const operationUsesRatio = slot.key.startsWith('video.') || slot.key.startsWith('image.')
    const operationUsesReferenceImages = operationUsesDuration || slot.key.startsWith('image.')
    return getModelConstraintConflicts(model.constraints, {
      ...(operationUsesDuration ? { durationSec: values.durationSec } : {}),
      ...(operationUsesRatio ? { ratio: values.ratio } : {}),
      ...(operationUsesReferenceImages && Object.prototype.hasOwnProperty.call(values, 'referenceImageCount')
        ? { referenceImageCount: values.referenceImageCount }
        : {}),
      ...(operationUsesDuration
        ? {
            ...(Object.prototype.hasOwnProperty.call(values, 'resolution') ? { resolution: values.resolution } : {}),
            ...(Object.prototype.hasOwnProperty.call(values, 'generateAudio')
              ? { generateAudio: values.generateAudio }
              : {}),
          }
        : {}),
    }).map((message) => `${slot.label}「${model.name}」：${message}`)
  })
}

/**
 * 首页输入框工具栏中的模型选择入口。
 * 一个胶囊按钮展开全部相关 operation 的下拉选择，避免模型配置占据整页高度。
 */
export default function GenerationModelDropdown({
  groups,
  selected,
  loading,
  error,
  onChange,
  onRetry,
  estimateModelCost,
  onOpen,
  locked = false,
  lockedReason = '',
  conflicts = [],
  attentionRequest = 0,
  attentionMessage = '请先完成本次创作的模型选择',
  placement = 'end',
  className = '',
}: GenerationModelDropdownProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>()
  const [estimateVersion, setEstimateVersion] = useState(0)
  const [estimates, setEstimates] = useState<
    Record<
      string,
      {
        status: 'loading' | 'success' | 'error'
        estimatedCost?: number
        balance?: number
        canAfford?: boolean
        message?: string
      }
    >
  >({})
  const estimateRequestRef = useRef(0)
  const slots = useMemo(() => slotsOf(groups), [groups])
  const missingKeys = useMemo(() => getMissingGenerationModelKeys(groups, selected), [groups, selected])
  const selectedCount = slots.filter((slot) => selectedModelOf(slot, selected)).length
  const complete = slots.length > 0 && missingKeys.length === 0
  const hasConflict = conflicts.length > 0
  const globalLoading = typeof loading === 'boolean' && loading
  const globalError = typeof error === 'string' ? error : ''
  const rechargeRequired = Boolean(globalError) && isRechargeRequiredError(globalError)
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const estimateFingerprint = slots
    .map((slot) => `${slot.key}:${String(selectedModelOf(slot, selected)?.id ?? '')}`)
    .join('|')

  useEffect(() => {
    if (!open || !estimateModelCost) return
    const selectedSlots = slots
      .map((slot) => ({ slot, model: selectedModelOf(slot, selected) }))
      .filter((item): item is { slot: ModelSelectionSlot; model: GenerationModelOption } => Boolean(item.model))
    if (!selectedSlots.length) {
      setEstimates({})
      return
    }

    const requestId = ++estimateRequestRef.current
    setEstimates(Object.fromEntries(selectedSlots.map(({ slot }) => [slot.key, { status: 'loading' as const }])))
    const timer = window.setTimeout(() => {
      void Promise.all(
        selectedSlots.map(async ({ slot, model }) => {
          try {
            const result = await estimateModelCost({ operationCode: slot.key, modelVersionId: model.id })
            return [
              slot.key,
              {
                status: 'success' as const,
                estimatedCost: Math.max(0, Number(result.estimatedCost) || 0),
                balance: Number.isFinite(Number(result.balance)) ? Number(result.balance) : undefined,
                canAfford: result.canAfford,
              },
            ] as const
          } catch (error) {
            return [
              slot.key,
              {
                status: 'error' as const,
                message: error instanceof Error ? error.message : '暂时无法预估',
              },
            ] as const
          }
        }),
      ).then((results) => {
        if (requestId !== estimateRequestRef.current) return
        setEstimates(Object.fromEntries(results))
      })
    }, 260)

    return () => {
      window.clearTimeout(timer)
      estimateRequestRef.current += 1
    }
  }, [estimateFingerprint, estimateModelCost, estimateVersion, open, selected, slots])

  const estimateItems = Object.values(estimates)
  const estimateLoading = estimateItems.some((item) => item.status === 'loading')
  const estimateFailed = estimateItems.some((item) => item.status === 'error')
  const estimateTotal = estimateItems.reduce(
    (total, item) => total + (item.status === 'success' ? Number(item.estimatedCost) || 0 : 0),
    0,
  )
  const estimateBalance = estimateItems.find(
    (item) => item.status === 'success' && Number.isFinite(item.balance),
  )?.balance
  const estimateCanAfford =
    !estimateItems.some((item) => item.status === 'success' && item.canAfford === false) &&
    (estimateBalance == null || estimateTotal <= estimateBalance)

  /** 将面板挂到 body 并限制在可视区域内，彻底绕开任务栏和入口滚动容器的 overflow 裁切。 */
  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return
    if (window.innerWidth <= 720) {
      setPanelStyle(undefined)
      return
    }

    const viewportGap = 12
    const triggerGap = 12
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const triggerRect = trigger.getBoundingClientRect()
    const width = Math.min(520, Math.max(280, viewportWidth - viewportGap * 2))
    const desiredLeft = placement === 'start' ? triggerRect.left : triggerRect.right - width
    const left = Math.min(
      Math.max(viewportGap, desiredLeft),
      Math.max(viewportGap, viewportWidth - width - viewportGap),
    )
    const belowSpace = viewportHeight - triggerRect.bottom - triggerGap - viewportGap
    const aboveSpace = triggerRect.top - triggerGap - viewportGap
    const openAbove = belowSpace < 240 && aboveSpace > belowSpace
    const availableHeight = Math.max(180, openAbove ? aboveSpace : belowSpace)
    const maxHeight = Math.min(590, Math.floor(viewportHeight * 0.64), availableHeight)
    const measuredHeight = Math.min(panelRef.current?.offsetHeight || maxHeight, maxHeight)
    const top = openAbove
      ? Math.max(viewportGap, triggerRect.top - triggerGap - measuredHeight)
      : Math.min(triggerRect.bottom + triggerGap, viewportHeight - measuredHeight - viewportGap)

    setPanelStyle({
      position: 'fixed',
      top,
      left,
      right: 'auto',
      bottom: 'auto',
      width,
      maxHeight,
    })
  }, [placement])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeAndRestoreFocus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
    let settleFrame = 0
    const frame = requestAnimationFrame(() => {
      updatePanelPosition()
      settleFrame = requestAnimationFrame(updatePanelPosition)
    })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
      cancelAnimationFrame(frame)
      cancelAnimationFrame(settleFrame)
    }
  }, [closeAndRestoreFocus, open, updatePanelPosition])

  useEffect(() => {
    if (!attentionRequest || locked) return
    updatePanelPosition()
    setOpen(true)
    const frame = requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [attentionRequest, locked, updatePanelPosition])

  if (!slots.length && !globalLoading && !globalError) return null

  const triggerText = globalLoading
    ? '模型加载中'
    : globalError
      ? rechargeRequired
        ? '需要充值'
        : '模型不可用'
      : locked
        ? `模型处理中 ${selectedCount}/${slots.length}`
        : complete
          ? `模型 ${selectedCount}/${slots.length}`
          : `选择模型 ${selectedCount}/${slots.length}`
  const contextDescription = locked
    ? lockedReason || '正在进入创作，本次模型选择已锁定'
    : '请在首页完成模型选择；进入后续步骤后将始终沿用本次选择'

  return (
    <div
      ref={rootRef}
      className={`${styles.root}${className ? ` ${className}` : ''}`}
      data-state={hasConflict ? 'conflict' : complete ? 'complete' : 'incomplete'}
      data-attention={attentionRequest > 0 ? 'true' : undefined}
    >
      <button
        key={`model-attention-${attentionRequest}`}
        ref={triggerRef}
        type="button"
        className={`${styles.trigger}${attentionRequest > 0 ? ` ${styles.triggerAttention}` : ''}`}
        aria-label={`生成模型，${selectedCount}/${slots.length} 已选择${locked ? '，处理中不可切换' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (!open) {
            updatePanelPosition()
            if (!locked) onOpen?.()
          }
          setOpen((value) => !value)
        }}
      >
        <ControlOutlined className={styles.triggerIcon} aria-hidden="true" />
        <span>{triggerText}</span>
        <DownOutlined className={`${styles.chevron}${open ? ` ${styles.chevronOpen}` : ''}`} aria-hidden="true" />
      </button>

      {attentionRequest > 0 && attentionMessage && (
        <span key={`model-attention-message-${attentionRequest}`} className={styles.visuallyHidden} role="alert">
          {attentionMessage}
        </span>
      )}

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <section
            ref={panelRef}
            id={panelId}
            className={styles.popover}
            style={panelStyle}
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${panelId}-title`}
          >
            <header className={styles.header}>
              <div>
                <h2 id={`${panelId}-title`}>本次创作使用的模型</h2>
                <p>{contextDescription}</p>
              </div>
              <div className={styles.headerActions}>
                <span className={`${styles.count}${complete ? ` ${styles.countComplete}` : ''}`}>
                  {selectedCount}/{slots.length}
                </span>
                <button type="button" className={styles.close} aria-label="关闭模型选择" onClick={closeAndRestoreFocus}>
                  <CloseOutlined aria-hidden="true" />
                </button>
              </div>
            </header>

            {globalLoading ? (
              <div className={styles.globalState} role="status" aria-live="polite">
                <LoadingOutlined className={styles.spinner} spin aria-hidden="true" />
                正在读取当前空间可用模型…
              </div>
            ) : globalError ? (
              <div className={`${styles.globalState} ${styles.error}`} role="alert">
                {rechargeRequired ? (
                  <div className={styles.rechargeState}>
                    <strong>当前套餐暂无可用模型</strong>
                    <span>充值或开通会员后，即可选择模型并开始创作。</span>
                    <div className={styles.stateActions}>
                      <button
                        type="button"
                        className={styles.primaryStateAction}
                        onClick={() => {
                          closeAndRestoreFocus()
                          openMemberCenter()
                        }}
                      >
                        去充值
                      </button>
                      {onRetry && (
                        <button type="button" onClick={() => onRetry()}>
                          我已充值，重新加载
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <span>{globalError}</span>
                    {onRetry && (
                      <button type="button" onClick={() => onRetry()}>
                        重新加载
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className={styles.slotList}>
                {slots.map((slot, index) => {
                  const currentModel = selectedModelOf(slot, selected)
                  const slotLoading = readLoading(loading, slot)
                  const slotError = readError(error, slot)
                  const unavailableReason = slot.models.every((model) => model.disabled)
                    ? slot.models.find((model) => model.unavailableReason)?.unavailableReason || ''
                    : ''
                  const effectiveSlotError = slotError || unavailableReason
                  const descriptionId = `${panelId}-slot-${index}-description`
                  return (
                    <div className={styles.slot} key={slot.key}>
                      <div className={styles.slotTop}>
                        <label htmlFor={`${panelId}-slot-${index}`}>
                          <span>{slot.label}</span>
                          <small>{slot.groupLabel}</small>
                        </label>
                        {slotLoading ? (
                          <span className={styles.inlineState} role="status">
                            加载中…
                          </span>
                        ) : (
                          <select
                            id={`${panelId}-slot-${index}`}
                            aria-label={slot.label}
                            aria-describedby={currentModel ? descriptionId : undefined}
                            value={currentModel == null ? '' : String(currentModel.id)}
                            disabled={locked || Boolean(slotError) || slot.models.every((model) => model.disabled)}
                            onChange={(event) => {
                              const model = slot.models.find((item) => String(item.id) === event.target.value)
                              if (model && !model.disabled) onChange(slot.groupKey, model.id, slot.subgroupKey)
                            }}
                          >
                            <option value="">请选择模型</option>
                            {slot.models.map((model) => (
                              <option key={String(model.id)} value={String(model.id)} disabled={model.disabled}>
                                {model.name}
                                {model.disabled ? '（不可用）' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {effectiveSlotError && (
                        <div className={styles.slotError} role="alert">
                          <span>{effectiveSlotError}</span>
                          {onRetry && (
                            <button type="button" onClick={() => onRetry(slot.groupKey, slot.subgroupKey)}>
                              重试
                            </button>
                          )}
                        </div>
                      )}

                      {currentModel && (
                        <div id={descriptionId} className={styles.modelMeta} aria-live="polite">
                          {currentModel.description && (
                            <p className={styles.modelDescription}>{currentModel.description}</p>
                          )}
                          {estimateModelCost && (
                            <span
                              className={`${styles.modelEstimate} ${
                                estimates[slot.key]?.status === 'error' ? styles.modelEstimateError : ''
                              }`}
                            >
                              {estimates[slot.key]?.status === 'loading'
                                ? '正在预估…'
                                : estimates[slot.key]?.status === 'success'
                                  ? `预计 ${estimates[slot.key]?.estimatedCost ?? 0} 积分`
                                  : estimates[slot.key]?.status === 'error'
                                    ? '预估失败'
                                    : '等待预估'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {!globalLoading && !globalError && complete && estimateModelCost && (
              <section className={styles.estimateSummary} aria-live="polite" aria-label="模型费用预估">
                <div className={styles.estimateSummaryTop}>
                  <div>
                    <strong>模型参考预估</strong>
                    <span>当前配置下，各模型分别执行 1 次</span>
                  </div>
                  <div className={styles.estimateTotal}>
                    {estimateLoading ? (
                      <span>
                        <LoadingOutlined spin aria-hidden="true" /> 正在计算
                      </span>
                    ) : (
                      <>
                        <b>{estimateTotal}</b>
                        <span>积分</span>
                      </>
                    )}
                  </div>
                </div>
                <div className={styles.estimateSummaryBottom}>
                  <span>
                    {estimateBalance == null
                      ? '实际消耗以镜头数、生成次数及最终结算为准'
                      : `当前余额 ${estimateBalance} 积分${estimateCanAfford ? '' : '，余额不足'}`}
                  </span>
                  {estimateFailed && (
                    <button type="button" onClick={() => setEstimateVersion((value) => value + 1)}>
                      重新预估
                    </button>
                  )}
                </div>
              </section>
            )}

            {!globalLoading && !globalError && (
              <footer className={styles.footer}>
                <div className={styles.footerContent}>
                  {hasConflict ? (
                    <div className={styles.conflicts} role="alert">
                      <strong>当前创作参数与所选模型不兼容</strong>
                      <ul>
                        {conflicts.map((conflict) => (
                          <li key={conflict}>{conflict}</li>
                        ))}
                      </ul>
                    </div>
                  ) : !complete ? (
                    <p role="status">请完成全部 {slots.length} 项模型选择后再确认。</p>
                  ) : (
                    <p className={styles.ready} role="status">
                      <CheckCircleFilled aria-hidden="true" />
                      {locked ? '本次模型选择已锁定' : '模型配置完成，确认后将沿用本次选择'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.confirm}
                  disabled={!complete || hasConflict}
                  aria-disabled={!complete || hasConflict}
                  onClick={closeAndRestoreFocus}
                >
                  确认
                </button>
              </footer>
            )}
          </section>,
          document.body,
        )}
    </div>
  )
}
