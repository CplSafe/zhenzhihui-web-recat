/** Only presentation-safe, durable values from the submitted request are retained. */
export interface CanvasImageInfo {
  modelName?: string
  modelVersionId?: number
  operationCode?: string
  toolCode?: string
  prompt?: string
  createdAt?: string
  rows: Array<{ label: string; value: string }>
}

export interface CanvasImageOrigin {
  assetId: number
  info?: CanvasImageInfo
  kind: 'upload' | 'materials' | 'real_person' | 'capture' | 'panorama' | 'upscale'
}

/** Resolve the displayed asset, never the node's mutable model selection or task status. */
export function canvasImageDetails(data: Record<string, unknown>, assetId: number) {
  const history = Array.isArray(data.resultHistory) ? data.resultHistory : []
  const entry = history.find((item) => Number(item?.assetId) === assetId && assetId > 0)
  const current = assetId === Number(data.assetId || 0)
  const origin = data.imageOrigin as CanvasImageOrigin | undefined
  const labels: Record<CanvasImageOrigin['kind'], string> = {
    upload: '本地添加',
    materials: '素材库添加',
    real_person: '真人素材库',
    capture: '视频截帧',
    panorama: '全景取景',
    upscale: '高清处理',
  }
  const explicit = current && origin?.assetId === assetId && assetId > 0 ? labels[origin.kind] : ''
  const batch = Array.isArray(data.imageResultAssetIds) && data.imageResultAssetIds.includes(assetId) && assetId > 0
  const hd = data.hd as { sourceAssetId?: number; taskId?: string } | undefined
  // Old HD nodes did not persist an output ID. Only use their lineage when no later acquisition replaced it.
  const legacyHd =
    current &&
    !origin &&
    !data.assetSource &&
    !entry &&
    !batch &&
    Boolean(hd?.taskId) &&
    Number(hd?.sourceAssetId) > 0 &&
    Number(hd?.sourceAssetId) !== assetId
  const upscale = (explicit && origin?.kind === 'upscale') || legacyHd
  const generated = Boolean(upscale || entry || batch || (current && data.assetSource === 'generated'))
  const fallback = current ? labels[data.assetSource as CanvasImageOrigin['kind']] : ''
  return {
    sourceLabel: upscale ? '模型生成' : explicit || (generated ? '模型生成' : fallback) || '来源未记录',
    generated: upscale ? true : explicit ? false : generated,
    info: (upscale
      ? (explicit && origin?.kind === 'upscale' ? origin.info : undefined) || {
          operationCode: 'image.upscale',
          rows: [],
        }
      : entry?.imageInfo) as CanvasImageInfo | undefined,
  }
}

export function imageGenerationInfo(
  request: {
    prompt?: string
    ratio?: string
    params?: Record<string, unknown>
    operationCode?: string
    modelVersionId?: number
  },
  modelName: string,
  createdAt: string,
): CanvasImageInfo {
  const params = request.params || {}
  const fields: Array<[string, unknown]> = [
    ['生成比例', params.aspect_ratio ?? params.ratio ?? request.ratio],
    ['生成规格', params.resolution ?? params.image_size ?? params.size],
    ['质量', params.quality],
    ['风格', params.style],
    ['随机种子', params.seed],
    ['采样步数', params.steps ?? params.num_inference_steps],
    ['提示词引导', params.guidance_scale ?? params.cfg_scale],
    ['反向提示词', params.negative_prompt],
  ]
  return {
    modelName,
    ...(request.operationCode ? { operationCode: request.operationCode } : {}),
    ...(request.modelVersionId ? { modelVersionId: request.modelVersionId } : {}),
    ...(typeof params.tool === 'string' ? { toolCode: params.tool } : {}),
    prompt: request.prompt,
    createdAt,
    rows: fields.flatMap(([label, value]) =>
      (typeof value === 'string' && value.trim() && value !== 'auto') ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      typeof value === 'boolean'
        ? [{ label, value: typeof value === 'boolean' ? (value ? '是' : '否') : String(value) }]
        : [],
    ),
  }
}

export function imagePixelRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const divisor = gcd(width, height)
  if (!divisor) return ''
  const exact = `${width / divisor}:${height / divisor}`
  const common = [
    [1, 1],
    [4, 3],
    [3, 4],
    [16, 9],
    [9, 16],
    [3, 2],
    [2, 3],
    [21, 9],
    [9, 21],
  ].find(([w, h]) => Math.abs(width / height / (w / h) - 1) < 0.01)
  return common ? `${width * common[1] === height * common[0] ? '' : '约 '}${common[0]}:${common[1]}` : exact
}

export function imageFunctionLabel(info?: CanvasImageInfo): string {
  const tools: Record<string, string> = {
    'image.multi_angle': '多角度生成',
    'image.relight': '图片打光',
    'image.panorama': '全景生成',
  }
  const operations: Record<string, string> = {
    'image.text_to_image': '文生图',
    'image.image_to_image': '图生图',
    'image.generate': '图片生成',
    'image.edit': '图片编辑',
    'image.upscale': '图片超分',
  }
  return tools[info?.toolCode || ''] || operations[info?.operationCode || ''] || ''
}
