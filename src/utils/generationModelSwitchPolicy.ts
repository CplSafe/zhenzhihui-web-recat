import type { GenerationOperationCode } from './generationModelCatalog'

/** 智能成片五类操作，加上爆款复制的参考生视频操作。 */
export type SwitchableGenerationOperationCode = GenerationOperationCode | 'video.replicate'

export type GenerationModelSwitchArtifactKind =
  | 'script'
  | 'text-shot-images'
  | 'reference-shot-images'
  | 'generated-video'
  | 'edited-video'
  | 'replicated-video'

export interface GenerationModelSwitchArtifactSnapshot {
  hasScript?: boolean
  textShotImageCount?: number
  referenceShotImageCount?: number
  hasGeneratedVideo?: boolean
  hasEditedVideo?: boolean
  hasReplicatedVideo?: boolean
}

export interface GenerationModelSwitchPlanInput {
  operationCode: SwitchableGenerationOperationCode
  currentModelId?: unknown
  nextModelId: unknown
  artifacts?: GenerationModelSwitchArtifactSnapshot | null
  /** 任意付费生成仍在运行时，页面应禁止开始新的模型切换。 */
  runningOperations?: readonly SwitchableGenerationOperationCode[]
}

export type GenerationModelSwitchPlanAction = 'noop' | 'switch-directly' | 'confirm' | 'blocked'

export interface GenerationModelSwitchPlan {
  action: GenerationModelSwitchPlanAction
  operationCode: SwitchableGenerationOperationCode
  operationLabel: string
  currentModelId: number | null
  nextModelId: number | null
  /** 选择新模型后需要重新生成的当前操作产物。 */
  regenerateArtifacts: GenerationModelSwitchArtifactKind[]
  /** 新产物成功后才应标记为需要更新的下游产物。 */
  staleAfterSuccess: GenerationModelSwitchArtifactKind[]
  affectedArtifactLabels: string[]
  requiresConfirmation: boolean
  requiresRegeneration: boolean
  /** 切换期间始终保留现有产物，只有新产物成功后才原子提交。 */
  preserveCurrentUntilSuccess: true
  message: string
}

const OPERATION_LABELS: Record<SwitchableGenerationOperationCode, string> = {
  'responses.multimodal': '生成脚本',
  'image.text_to_image': '文生图',
  'image.image_to_image': '图生图',
  'video.generate': '生成视频',
  'video.edit': '修改视频',
  'video.replicate': '爆款复制',
}

const ARTIFACT_LABELS: Record<GenerationModelSwitchArtifactKind, string> = {
  script: '分镜脚本',
  'text-shot-images': '文生图镜头图片',
  'reference-shot-images': '图生图镜头图片',
  'generated-video': '生成视频',
  'edited-video': '视频修改结果',
  'replicated-video': '爆款复制视频',
}

const positiveModelId = (value: unknown): number | null => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

const positiveCount = (value: unknown): number => {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

function artifactImpact(
  operationCode: SwitchableGenerationOperationCode,
  snapshot: GenerationModelSwitchArtifactSnapshot,
): {
  regenerateArtifacts: GenerationModelSwitchArtifactKind[]
  staleAfterSuccess: GenerationModelSwitchArtifactKind[]
} {
  const hasGeneratedVideo = snapshot.hasGeneratedVideo === true
  const hasEditedVideo = snapshot.hasEditedVideo === true

  switch (operationCode) {
    case 'responses.multimodal':
      if (snapshot.hasScript !== true) return { regenerateArtifacts: [], staleAfterSuccess: [] }
      return {
        regenerateArtifacts: ['script'],
        staleAfterSuccess: [
          ...(positiveCount(snapshot.textShotImageCount) ? (['text-shot-images'] as const) : []),
          ...(positiveCount(snapshot.referenceShotImageCount) ? (['reference-shot-images'] as const) : []),
          ...(hasGeneratedVideo ? (['generated-video'] as const) : []),
          ...(hasEditedVideo ? (['edited-video'] as const) : []),
        ],
      }
    case 'image.text_to_image':
      if (!positiveCount(snapshot.textShotImageCount)) return { regenerateArtifacts: [], staleAfterSuccess: [] }
      return {
        regenerateArtifacts: ['text-shot-images'],
        staleAfterSuccess: [
          ...(hasGeneratedVideo ? (['generated-video'] as const) : []),
          ...(hasEditedVideo ? (['edited-video'] as const) : []),
        ],
      }
    case 'image.image_to_image':
      if (!positiveCount(snapshot.referenceShotImageCount)) return { regenerateArtifacts: [], staleAfterSuccess: [] }
      return {
        regenerateArtifacts: ['reference-shot-images'],
        staleAfterSuccess: [
          ...(hasGeneratedVideo ? (['generated-video'] as const) : []),
          ...(hasEditedVideo ? (['edited-video'] as const) : []),
        ],
      }
    case 'video.generate':
      if (!hasGeneratedVideo) return { regenerateArtifacts: [], staleAfterSuccess: [] }
      return {
        regenerateArtifacts: ['generated-video'],
        staleAfterSuccess: hasEditedVideo ? ['edited-video'] : [],
      }
    case 'video.edit':
      return snapshot.hasEditedVideo === true
        ? { regenerateArtifacts: ['edited-video'], staleAfterSuccess: [] }
        : { regenerateArtifacts: [], staleAfterSuccess: [] }
    case 'video.replicate':
      return snapshot.hasReplicatedVideo === true
        ? { regenerateArtifacts: ['replicated-video'], staleAfterSuccess: [] }
        : { regenerateArtifacts: [], staleAfterSuccess: [] }
  }
}

function confirmationMessage(
  operationLabel: string,
  regenerateArtifacts: GenerationModelSwitchArtifactKind[],
  staleAfterSuccess: GenerationModelSwitchArtifactKind[],
): string {
  const regenerateLabels = regenerateArtifacts.map((artifact) => ARTIFACT_LABELS[artifact]).join('、')
  const staleLabels = staleAfterSuccess.map((artifact) => ARTIFACT_LABELS[artifact]).join('、')
  const staleMessage = staleLabels ? `；成功后还会将${staleLabels}标记为需要更新` : ''
  return `切换${operationLabel}模型将重生成${regenerateLabels}${staleMessage}。现有产物会保留到新产物生成成功。`
}

/**
 * 纯计算一次模型选择应直接应用、弹确认、忽略还是拦截。
 * 页面只需传入当前产物快照与运行状态，不在事件处理中复制依赖判断。
 */
export function planGenerationModelSwitch(input: GenerationModelSwitchPlanInput): GenerationModelSwitchPlan {
  const operationLabel = OPERATION_LABELS[input.operationCode]
  const currentModelId = positiveModelId(input.currentModelId)
  const nextModelId = positiveModelId(input.nextModelId)
  const base = {
    operationCode: input.operationCode,
    operationLabel,
    currentModelId,
    nextModelId,
    preserveCurrentUntilSuccess: true as const,
  }

  if (nextModelId === null) {
    return {
      ...base,
      action: 'blocked',
      regenerateArtifacts: [],
      staleAfterSuccess: [],
      affectedArtifactLabels: [],
      requiresConfirmation: false,
      requiresRegeneration: false,
      message: `目标${operationLabel}模型版本无效，无法切换。`,
    }
  }
  if (currentModelId === nextModelId) {
    return {
      ...base,
      action: 'noop',
      regenerateArtifacts: [],
      staleAfterSuccess: [],
      affectedArtifactLabels: [],
      requiresConfirmation: false,
      requiresRegeneration: false,
      message: `当前已是所选${operationLabel}模型，无需切换。`,
    }
  }
  if ((input.runningOperations || []).length > 0) {
    return {
      ...base,
      action: 'blocked',
      regenerateArtifacts: [],
      staleAfterSuccess: [],
      affectedArtifactLabels: [],
      requiresConfirmation: false,
      requiresRegeneration: false,
      message: `当前有生成任务运行中，暂不能切换${operationLabel}模型。`,
    }
  }

  const { regenerateArtifacts, staleAfterSuccess } = artifactImpact(input.operationCode, input.artifacts || {})
  const affectedArtifacts = [...regenerateArtifacts, ...staleAfterSuccess]
  const affectedArtifactLabels = affectedArtifacts.map((artifact) => ARTIFACT_LABELS[artifact])
  if (!regenerateArtifacts.length) {
    return {
      ...base,
      action: 'switch-directly',
      regenerateArtifacts,
      staleAfterSuccess,
      affectedArtifactLabels,
      requiresConfirmation: false,
      requiresRegeneration: false,
      message: `当前没有需要由${operationLabel}模型重生成的产物，将直接切换模型。`,
    }
  }

  return {
    ...base,
    action: 'confirm',
    regenerateArtifacts,
    staleAfterSuccess,
    affectedArtifactLabels,
    requiresConfirmation: true,
    requiresRegeneration: true,
    message: confirmationMessage(operationLabel, regenerateArtifacts, staleAfterSuccess),
  }
}

export interface GenerationModelSwitchAttemptOwner {
  /** 页面或生成会话的稳定所有者标识。 */
  ownerId: string
  epoch: number
  workspaceId: number
  projectId: number
}

export interface GenerationModelSwitchAttempt {
  attemptId: string
  owner: GenerationModelSwitchAttemptOwner
  operationCode: SwitchableGenerationOperationCode
  fromModelId: number
  toModelId: number
  artifactFingerprint: string
  paramsFingerprint: string
}

export interface CurrentGenerationModelSwitchSnapshot {
  attemptId: string
  owner: GenerationModelSwitchAttemptOwner
  operationCode: SwitchableGenerationOperationCode
  currentModelId: number
  pendingModelId: number
  artifactFingerprint: string
  paramsFingerprint: string
}

/** 返回空字符串表示异步核价/生成结果仍属于当前切换尝试。 */
export function getGenerationModelSwitchAttemptMismatchReason(
  attempt: GenerationModelSwitchAttempt,
  current: CurrentGenerationModelSwitchSnapshot,
): string {
  if (!attempt.attemptId || attempt.attemptId !== current.attemptId) return '模型切换请求已被新的请求替代'
  if (!attempt.owner.ownerId || attempt.owner.ownerId !== current.owner.ownerId) return '模型切换请求所有者已变化'
  if (attempt.owner.epoch !== current.owner.epoch) return '模型切换页面会话已变化'
  if (attempt.owner.workspaceId !== current.owner.workspaceId) return '模型切换工作空间已变化'
  if (attempt.owner.projectId !== current.owner.projectId) return '模型切换项目已变化'
  if (attempt.operationCode !== current.operationCode) return '模型切换操作类型已变化'
  const fromModelId = positiveModelId(attempt.fromModelId)
  const toModelId = positiveModelId(attempt.toModelId)
  const currentModelId = positiveModelId(current.currentModelId)
  const pendingModelId = positiveModelId(current.pendingModelId)
  if (
    fromModelId === null ||
    toModelId === null ||
    currentModelId === null ||
    pendingModelId === null ||
    fromModelId !== currentModelId ||
    toModelId !== pendingModelId
  ) {
    return '模型切换的原模型或目标模型已变化'
  }
  if (!attempt.artifactFingerprint || attempt.artifactFingerprint !== current.artifactFingerprint) {
    return '模型切换依赖的产物已变化'
  }
  if (!attempt.paramsFingerprint || attempt.paramsFingerprint !== current.paramsFingerprint) {
    return '模型切换使用的生成参数已变化'
  }
  return ''
}

/** 异步结果提交前的便捷布尔守卫；false 时调用方必须忽略旧结果。 */
export function isCurrentGenerationModelSwitchAttempt(
  attempt: GenerationModelSwitchAttempt,
  current: CurrentGenerationModelSwitchSnapshot,
): boolean {
  return getGenerationModelSwitchAttemptMismatchReason(attempt, current) === ''
}
