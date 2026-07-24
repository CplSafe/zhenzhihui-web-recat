import { describe, expect, it } from 'vitest'
import {
  getGenerationModelSwitchAttemptMismatchReason,
  isCurrentGenerationModelSwitchAttempt,
  planGenerationModelSwitch,
  type GenerationModelSwitchArtifactKind,
  type GenerationModelSwitchAttempt,
  type SwitchableGenerationOperationCode,
} from '@/utils/generationModelSwitchPolicy'

const FULL_ARTIFACTS = {
  hasScript: true,
  textShotImageCount: 2,
  referenceShotImageCount: 1,
  hasGeneratedVideo: true,
  hasEditedVideo: true,
  hasReplicatedVideo: true,
}

const OPERATION_CASES: Array<{
  operationCode: SwitchableGenerationOperationCode
  operationLabel: string
  regenerateArtifacts: GenerationModelSwitchArtifactKind[]
  staleAfterSuccess: GenerationModelSwitchArtifactKind[]
  affectedLabels: string[]
}> = [
  {
    operationCode: 'responses.multimodal',
    operationLabel: '生成脚本',
    regenerateArtifacts: ['script'],
    staleAfterSuccess: ['text-shot-images', 'reference-shot-images', 'generated-video', 'edited-video'],
    affectedLabels: ['分镜脚本', '文生图镜头图片', '图生图镜头图片', '生成视频', '视频修改结果'],
  },
  {
    operationCode: 'image.text_to_image',
    operationLabel: '文生图',
    regenerateArtifacts: ['text-shot-images'],
    staleAfterSuccess: ['generated-video', 'edited-video'],
    affectedLabels: ['文生图镜头图片', '生成视频', '视频修改结果'],
  },
  {
    operationCode: 'image.image_to_image',
    operationLabel: '图生图',
    regenerateArtifacts: ['reference-shot-images'],
    staleAfterSuccess: ['generated-video', 'edited-video'],
    affectedLabels: ['图生图镜头图片', '生成视频', '视频修改结果'],
  },
  {
    operationCode: 'video.generate',
    operationLabel: '生成视频',
    regenerateArtifacts: ['generated-video'],
    staleAfterSuccess: ['edited-video'],
    affectedLabels: ['生成视频', '视频修改结果'],
  },
  {
    operationCode: 'video.edit',
    operationLabel: '修改视频',
    regenerateArtifacts: ['edited-video'],
    staleAfterSuccess: [],
    affectedLabels: ['视频修改结果'],
  },
  {
    operationCode: 'video.replicate',
    operationLabel: '爆款复制',
    regenerateArtifacts: ['replicated-video'],
    staleAfterSuccess: [],
    affectedLabels: ['爆款复制视频'],
  },
]

describe.each(OPERATION_CASES)('$operationCode 模型切换计划', (testCase) => {
  it('选择当前模型时返回 noop', () => {
    const plan = planGenerationModelSwitch({
      operationCode: testCase.operationCode,
      currentModelId: 101,
      nextModelId: '101',
      artifacts: FULL_ARTIFACTS,
    })

    expect(plan).toMatchObject({
      action: 'noop',
      operationLabel: testCase.operationLabel,
      currentModelId: 101,
      nextModelId: 101,
      requiresConfirmation: false,
      requiresRegeneration: false,
      message: `当前已是所选${testCase.operationLabel}模型，无需切换。`,
    })
  })

  it('没有该操作产物时直接切换', () => {
    const plan = planGenerationModelSwitch({
      operationCode: testCase.operationCode,
      currentModelId: 101,
      nextModelId: 202,
      artifacts: {},
    })

    expect(plan).toMatchObject({
      action: 'switch-directly',
      regenerateArtifacts: [],
      staleAfterSuccess: [],
      affectedArtifactLabels: [],
      requiresConfirmation: false,
      requiresRegeneration: false,
      preserveCurrentUntilSuccess: true,
      message: `当前没有需要由${testCase.operationLabel}模型重生成的产物，将直接切换模型。`,
    })
  })

  it('存在对应产物时返回带中文影响说明的确认计划', () => {
    const plan = planGenerationModelSwitch({
      operationCode: testCase.operationCode,
      currentModelId: 101,
      nextModelId: 202,
      artifacts: FULL_ARTIFACTS,
    })

    expect(plan).toMatchObject({
      action: 'confirm',
      regenerateArtifacts: testCase.regenerateArtifacts,
      staleAfterSuccess: testCase.staleAfterSuccess,
      affectedArtifactLabels: testCase.affectedLabels,
      requiresConfirmation: true,
      requiresRegeneration: true,
      preserveCurrentUntilSuccess: true,
    })
    for (const label of testCase.affectedLabels) expect(plan.message).toContain(label)
    expect(plan.message).toContain('现有产物会保留到新产物生成成功')
  })

  it('任意生成任务运行中时阻止切换', () => {
    const plan = planGenerationModelSwitch({
      operationCode: testCase.operationCode,
      currentModelId: 101,
      nextModelId: 202,
      artifacts: {},
      runningOperations: ['video.generate'],
    })

    expect(plan).toMatchObject({
      action: 'blocked',
      requiresConfirmation: false,
      requiresRegeneration: false,
      message: `当前有生成任务运行中，暂不能切换${testCase.operationLabel}模型。`,
    })
  })
})

describe('generation model switch attempt ownership', () => {
  const attempt: GenerationModelSwitchAttempt = {
    attemptId: 'switch-attempt-1',
    owner: {
      ownerId: 'smart-session-8',
      epoch: 8,
      workspaceId: 21,
      projectId: 169,
    },
    operationCode: 'video.generate',
    fromModelId: 701,
    toModelId: 702,
    artifactFingerprint: 'artifact:v4',
    paramsFingerprint: 'params:16:9:10s',
  }
  const current = {
    attemptId: 'switch-attempt-1',
    owner: {
      ownerId: 'smart-session-8',
      epoch: 8,
      workspaceId: 21,
      projectId: 169,
    },
    operationCode: 'video.generate' as const,
    currentModelId: 701,
    pendingModelId: 702,
    artifactFingerprint: 'artifact:v4',
    paramsFingerprint: 'params:16:9:10s',
  }

  it('所有身份和指纹一致时接受当前异步结果', () => {
    expect(getGenerationModelSwitchAttemptMismatchReason(attempt, current)).toBe('')
    expect(isCurrentGenerationModelSwitchAttempt(attempt, current)).toBe(true)
  })

  it.each([
    ['attempt', { attemptId: 'switch-attempt-2' }, '模型切换请求已被新的请求替代'],
    ['owner', { owner: { ...current.owner, ownerId: 'hot-copy-session-8' } }, '模型切换请求所有者已变化'],
    ['epoch', { owner: { ...current.owner, epoch: 9 } }, '模型切换页面会话已变化'],
    ['workspace', { owner: { ...current.owner, workspaceId: 22 } }, '模型切换工作空间已变化'],
    ['project', { owner: { ...current.owner, projectId: 170 } }, '模型切换项目已变化'],
    ['operation', { operationCode: 'video.edit' as const }, '模型切换操作类型已变化'],
    ['current model', { currentModelId: 700 }, '模型切换的原模型或目标模型已变化'],
    ['invalid current model', { currentModelId: 0 }, '模型切换的原模型或目标模型已变化'],
    ['pending model', { pendingModelId: 703 }, '模型切换的原模型或目标模型已变化'],
    ['artifact fingerprint', { artifactFingerprint: 'artifact:v5' }, '模型切换依赖的产物已变化'],
    ['params fingerprint', { paramsFingerprint: 'params:9:16:6s' }, '模型切换使用的生成参数已变化'],
  ])('%s 变化时拒绝旧请求结果', (_label, patch, reason) => {
    const changed = {
      ...current,
      ...patch,
    }

    expect(getGenerationModelSwitchAttemptMismatchReason(attempt, changed)).toBe(reason)
    expect(isCurrentGenerationModelSwitchAttempt(attempt, changed)).toBe(false)
  })
})
