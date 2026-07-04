/**
 * 工作流步骤守卫
 * 检查各步骤是否可执行（分镜生成、视频生成等），返回阻塞原因或 true。
 */
export function canStartStoryboardGeneration(state = {}) {
  return !getStoryboardGenerationBlockReason(state)
}

export function getStoryboardGenerationBlockReason({
  isSubmittingScript = false,
  generationPending = false,
  generatedScript = '',
} = {}) {
  if (isSubmittingScript || generationPending) {
    return '请等待创意脚本生成完成'
  }

  if (!String(generatedScript || '').trim()) {
    return '请先生成创意脚本'
  }

  return ''
}

export function shouldRequestAuthenticatedSession(hasSessionMarker) {
  return hasSessionMarker === true
}

export function canStartTimelineGeneration(state = {}) {
  return !getTimelineGenerationBlockReason(state)
}

export function getTimelineGenerationBlockReason({
  storyboardGenerating = false,
  storyboardItems = [],
  storyboardTotal = 0,
} = {}) {
  if (storyboardGenerating) {
    return '分镜还在生成中'
  }

  const expectedTotal = Number(storyboardTotal || 0)
  const generatedCount = Array.isArray(storyboardItems) ? storyboardItems.length : 0

  if (expectedTotal > 0 && generatedCount < expectedTotal) {
    return '请先完成全部分镜图片生成'
  }

  if (expectedTotal <= 0 && generatedCount === 0) {
    return '请先完成全部分镜图片生成'
  }

  return ''
}

export function shouldClearSessionAfterLogoutFailure(error) {
  return Number(error?.status || 0) === 401
}
