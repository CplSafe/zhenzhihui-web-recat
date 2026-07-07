/**
 * AI 模型选择逻辑
 * 从可用模型列表中按 operationCode 筛选、按关键词偏好排序、支持模型降级重试。
 */
export const MODEL_NOT_FOUND_CODE = 'MODEL_NOT_FOUND'

export function chooseModelCandidate(models, { operationCode = '', preferredKeywords = [] } = {}) {
  const availableModels = Array.isArray(models) ? models : []
  const enabledModels = availableModels.filter((model) => {
    if (!model?.enabled) {
      return false
    }

    if (!operationCode) {
      return true
    }

    return Array.isArray(model.operation_codes) && model.operation_codes.includes(operationCode)
  })

  const preferredModel = findPreferredModel(enabledModels, preferredKeywords)

  if (preferredModel) {
    return preferredModel
  }

  if (preferredKeywords.length) {
    return null
  }

  if (operationCode) {
    return enabledModels[0] || null
  }

  return enabledModels[0] || availableModels.find((model) => model?.enabled) || availableModels[0] || null
}

export function isRetryableModelSelectionError(error) {
  if (!error) {
    return false
  }

  if ([MODEL_NOT_FOUND_CODE, 'MODEL_NOT_ALLOWED_BY_PLAN'].includes(error.code)) {
    return true
  }

  const message = String(error.message || '').toLowerCase()

  return /not available without an active subscription|not included in current plan/.test(message)
}

function findPreferredModel(models, preferredKeywords = []) {
  const keywords = preferredKeywords.map((keyword) => String(keyword || '').toLowerCase()).filter(Boolean)

  if (!keywords.length) {
    return null
  }

  return (
    models.find((model) => {
      const searchableText = [model.provider, model.model, model.version, model.display_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return keywords.some((keyword) => searchableText.includes(keyword))
    }) || null
  )
}
