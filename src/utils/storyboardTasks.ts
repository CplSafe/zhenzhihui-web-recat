/**
 * 分镜图生成参数构建
 * 根据不同 AI 模型的 schema 构建图片生成请求参数（尺寸/比例/风格等）。
 */
import { normalizeImageRatio } from './videoOptions.js'
import { getModelParamFields, findFirstField } from './modelSchema.js'

export function buildStoryboardImageParams(model, ratio) {
  const fields = getModelParamFields(model)
  const requestedRatio = String(ratio || '').trim()

  if (!fields.length) {
    // No provider schema to validate against — fall back to the safe
    // image-ratio whitelist so we never send an unsupported value.
    return {
      ratio: normalizeImageRatio(ratio),
      quality: 'standard',
      count: 1,
    }
  }

  const params: Record<string, any> = {}

  const ratioField = findFirstField(fields, ['ratio', 'aspect_ratio', 'aspectRatio'])
  if (ratioField) {
    // The model declares its own supported ratios; pickClosestRatioOption
    // validates the requested value against them (snapping to the nearest
    // when unsupported), so we must NOT pre-clamp through the video-ratio
    // whitelist here — that would drop image-only ratios like 4:5.
    const options = Array.isArray(ratioField?.options) ? ratioField.options.map(String) : []
    params[ratioField.name] = pickClosestRatioOption(requestedRatio, options)
  }

  if (hasParam(fields, 'quality')) {
    params.quality = 'standard'
  }

  if (hasParam(fields, 'size')) {
    params.size = getPreferredSize(fields, requestedRatio)
  }

  if (hasParam(fields, 'count')) {
    params.count = 1
  }

  if (hasParam(fields, 'watermark')) {
    params.watermark = false
  }

  return params
}

export function buildStoryboardEditInputAssets(item, materials = [], model = null) {
  const assetId = normalizeAssetId(item?.assetId)

  if (!assetId) {
    return []
  }

  const assetIds = [assetId]

  if (supportsMultipleReferenceImages(model)) {
    for (const material of materials) {
      if (!isImageMaterial(material)) {
        continue
      }

      const materialAssetId = normalizeAssetId(material?.assetId)

      if (materialAssetId && !assetIds.includes(materialAssetId)) {
        assetIds.push(materialAssetId)
      }

      if (assetIds.length >= 10) {
        break
      }
    }
  }

  return assetIds.map((id) => ({ asset_id: id, role: 'reference_image' }))
}

function hasParam(fields, name) {
  return fields.some((field) => field?.name === name)
}

function getPreferredSize(fields, ratio) {
  const sizeField = fields.find((field) => field?.name === 'size')
  const options = Array.isArray(sizeField?.options) ? sizeField.options.map(String) : []

  if (!options.length) {
    return '2K'
  }

  if (options.includes('2K')) {
    return '2K'
  }

  return pickClosestRatioOption(ratio, options) || options[0]
}


function parseRatioToken(value) {
  if (value === null || value === undefined) {
    return null
  }

  const text = String(value).trim().toLowerCase()
  if (!text) {
    return null
  }

  if (text.includes('square')) {
    return [1, 1]
  }

  const isPortraitHint = text.includes('portrait') && !text.includes('landscape')
  const separators = [':', 'x', '×']

  for (const sep of separators) {
    if (!text.includes(sep)) {
      continue
    }

    const parts = text
      .split(sep)
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length !== 2) {
      continue
    }

    const w = Number.parseInt(parts[0], 10)
    const h = Number.parseInt(parts[1], 10)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      continue
    }

    return isPortraitHint ? [h, w] : [w, h]
  }

  const numbers = text
    .replaceAll('-', '_')
    .split('_')
    .map((part) => Number.parseInt(part, 10))
    .filter((num) => Number.isFinite(num) && num > 0)

  if (numbers.length >= 2) {
    const w = numbers[0]
    const h = numbers[1]
    return isPortraitHint ? [h, w] : [w, h]
  }

  return null
}

function pickClosestRatioOption(requested, options) {
  const normalizedOptions = Array.isArray(options) ? options.map(String).filter(Boolean) : []
  if (!normalizedOptions.length) {
    return String(requested || '')
  }

  const requestedText = String(requested || '')
  if (normalizedOptions.includes(requestedText)) {
    return requestedText
  }

  const target = parseRatioToken(requestedText)
  if (!target) {
    return normalizedOptions[0]
  }

  const [tw, th] = target
  const targetRatio = tw / th
  let best = null
  let bestDiff = Number.POSITIVE_INFINITY

  for (const option of normalizedOptions) {
    const parsed = parseRatioToken(option)
    if (!parsed) {
      continue
    }

    const [ow, oh] = parsed
    const diff = Math.abs(ow / oh - targetRatio)
    if (diff < bestDiff) {
      bestDiff = diff
      best = option
    }
  }

  return best || normalizedOptions[0]
}

function supportsMultipleReferenceImages(model) {
  const provider = String(model?.provider || '').toLowerCase()
  const capability = String(model?.capability || '').toLowerCase()
  const searchableText = [model?.model, model?.version, model?.display_name, model?.displayName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return provider === 'volcengine' && (capability === 'image' || searchableText.includes('seedream'))
}

function isImageMaterial(material) {
  const type = String(material?.type || '').toLowerCase()
  const mimeType = String(material?.mimeType || material?.mime_type || '').toLowerCase()

  return type === 'image' || mimeType.startsWith('image/')
}

function normalizeAssetId(value) {
  const assetId = Number(value || 0)
  return Number.isFinite(assetId) && assetId > 0 ? assetId : 0
}
