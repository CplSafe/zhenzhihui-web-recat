export interface SmartMarketingRecoveryState {
  applied: boolean
  started: boolean
  marketingOpen: boolean
  marketingLoading: boolean
  hasMarketingData: boolean
  hasMarketingError: boolean
  workspaceId: number
  projectId: number
  routeSessionToken: string
  skill: string
  requirement: string
  imageCount: number
}

/**
 * 返回需要自动补发的营销拆解请求键。
 *
 * 首次创建项目会把地址从 /smart 绑定到 /smart/:id。若旧版本在绑定时中止了
 * SKILL 请求，草稿会停留在“营销步骤已打开，但没有结果、错误或加载状态”。
 * 只有这种可确认的空白状态才补发，避免正常请求或明确失败时重复调用模型。
 */
export function getSmartMarketingRecoveryKey(state: SmartMarketingRecoveryState): string {
  const workspaceId = Number(state.workspaceId || 0)
  const projectId = Number(state.projectId || 0)
  const skill = String(state.skill || '').trim()
  const requirement = String(state.requirement || '').trim()
  const hasSourceContent = Boolean(requirement || Number(state.imageCount || 0) > 0)

  if (
    !state.applied ||
    !state.started ||
    !state.marketingOpen ||
    state.marketingLoading ||
    state.hasMarketingData ||
    state.hasMarketingError ||
    !workspaceId ||
    !projectId ||
    !skill ||
    !hasSourceContent
  ) {
    return ''
  }

  return [workspaceId, projectId, state.routeSessionToken, skill, requirement, state.imageCount].join(':')
}
