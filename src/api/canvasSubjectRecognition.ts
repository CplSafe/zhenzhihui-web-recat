import { getBackendGenerationModelVersionId } from '@/utils/generationModelCatalog'
import { MODEL_NOT_FOUND_CODE } from '@/utils/modelSelection'
import { runResponseText } from './aiResponses'
import { resolveTaskModel } from './business'

const operationCode = 'responses.multimodal'
const maxCandidates = 4
const maxEncodedFrameLength = Math.ceil((10_000_000 * 4) / 3)
const invalidResponse = '主体识别结果格式不正确，请重新点选或使用画笔'
const unavailableModel = '当前工作空间未启用视觉理解模型，可继续使用画笔或框选'

type Point = { x: number; y: number }

export interface CanvasSubjectCandidate {
  label: string
  bounds: Point & { width: number; height: number }
}

type RecognitionSource = { imageAssetId: number; frameDataUrl?: never } | { frameDataUrl: string; imageAssetId?: never }

type RecognitionArgs = RecognitionSource & {
  workspaceId: number
  canvasId?: number
  point: Point
  signal?: AbortSignal
}

const recognitionPrompt = [
  '根据点击坐标识别图片中覆盖该点的可见主体。候选可以包含局部物体和它所属的主体，例如眼镜和人物。',
  '优先列出实际覆盖点击点的小物体。只列不同的主体，避免全图或背景候选。',
  `仅返回 JSON 对象，最多 ${maxCandidates} 个候选。每个候选包含中文短名称和贴合可见主体的外接矩形。`,
  '坐标原点在图片左上角，x/width 以图宽为单位、y/height 以图高为单位，所有坐标均使用 0 至 1 的小数。',
  '返回格式为 {"candidates":[{"label":"主体名称","bounds":{"x":0.1,"y":0.2,"width":0.3,"height":0.4}}]}。识别不到时返回 {"candidates":[]}。',
].join('\n')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnitCoordinate(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1
}

function parseSubjectCandidates(response: string, point: Point): CanvasSubjectCandidate[] {
  let result: unknown
  try {
    result = JSON.parse(response.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'))
  } catch {
    throw new Error(invalidResponse)
  }
  if (!isRecord(result) || !Array.isArray(result.candidates)) throw new Error(invalidResponse)

  const candidates: CanvasSubjectCandidate[] = []
  const names = new Set<string>()
  for (const candidate of result.candidates) {
    if (!isRecord(candidate) || typeof candidate.label !== 'string' || !isRecord(candidate.bounds)) continue
    const label = candidate.label.trim().replace(/\s+/g, ' ')
    if (!label || label.length > 30 || names.has(label)) continue

    const { x, y, width, height } = candidate.bounds
    if (!isUnitCoordinate(x) || !isUnitCoordinate(y) || !isUnitCoordinate(width) || !isUnitCoordinate(height)) continue
    if (width <= 0 || height <= 0 || x + width > 1 + Number.EPSILON || y + height > 1 + Number.EPSILON) continue
    if (point.x < x || point.x > x + width || point.y < y || point.y > y + height) continue

    candidates.push({ label, bounds: { x, y, width, height } })
    names.add(label)
    if (candidates.length === maxCandidates) break
  }
  if (result.candidates.length && candidates.length === 0) throw new Error(invalidResponse)
  return candidates
}

async function resolveRecognitionModel(workspaceId: number) {
  try {
    return await resolveTaskModel({ operationCode, workspaceId })
  } catch (error) {
    if (isRecord(error) && error.code === MODEL_NOT_FOUND_CODE) throw new Error(unavailableModel)
    throw error
  }
}

/** 返回点击帧的语义候选和外接矩形，供调用方提取轮廓。 */
export async function recognizeCanvasSubjectCandidates(args: RecognitionArgs): Promise<CanvasSubjectCandidate[]> {
  const { imageAssetId, frameDataUrl, workspaceId, canvasId, point, signal } = args
  if (!Number.isSafeInteger(workspaceId) || workspaceId <= 0) throw new Error('未选择工作空间，无法识别主体')
  if (!isUnitCoordinate(point.x) || !isUnitCoordinate(point.y)) throw new Error('请在图片区域内点选主体')

  if (imageAssetId !== undefined) {
    if (!Number.isSafeInteger(imageAssetId) || imageAssetId <= 0) throw new Error('图片素材无效，请重新选择图片')
  } else {
    const headerLength = frameDataUrl?.match(/^data:image\/(?:jpeg|png|webp);base64,/i)?.[0].length ?? 0
    if (!headerLength || frameDataUrl.length === headerLength) throw new Error('当前帧无法识别，请重新截取视频帧')
    if (frameDataUrl.length - headerLength > maxEncodedFrameLength) throw new Error('当前帧超过 10 MB，请缩小后重试')
  }

  if (signal?.aborted) throw new DOMException('主体识别已取消', 'AbortError')
  const model = await resolveRecognitionModel(workspaceId)
  if (signal?.aborted) throw new DOMException('主体识别已取消', 'AbortError')
  const modelVersionId = getBackendGenerationModelVersionId(model)
  if (!modelVersionId) throw new Error(unavailableModel)

  const response = await runResponseText({
    system: recognitionPrompt,
    user: `图片点击位置（相对坐标） x=${point.x.toFixed(6)}, y=${point.y.toFixed(6)}。请按约定的 JSON 格式返回候选。`,
    ...(imageAssetId !== undefined ? { imageAssetIds: [imageAssetId] } : { images: [frameDataUrl] }),
    modelVersionId,
    requestContext: { workspaceId, canvasId, modelVersionId, modelVersion: model },
    temperature: 0.1,
    maxTokens: 500,
    signal,
  })
  return parseSubjectCandidates(response, point)
}
