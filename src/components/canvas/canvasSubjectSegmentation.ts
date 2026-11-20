import type { InteractiveSegmenter } from '@mediapipe/tasks-vision'

const MODEL_PATH = `${import.meta.env.BASE_URL}models/mediapipe-magic-touch/magic_touch.tflite`
const WASM_LOADER_PATH = new URL(
  '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js',
  import.meta.url,
).href
const WASM_BINARY_PATH = new URL(
  '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm',
  import.meta.url,
).href
const MODEL_TIMEOUT_MS = 20_000
const MAX_IMAGE_EDGE = 768

type Point = { x: number; y: number }
type Bounds = Point & { width: number; height: number }

let segmenterPromise: Promise<InteractiveSegmenter> | undefined

function loadSegmenter() {
  if (segmenterPromise) return segmenterPromise

  const controller = new AbortController()
  const initialization = (async () => {
    const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision')
    if (!(await FilesetResolver.isSimdSupported())) throw new Error('当前浏览器暂不支持自动抠图，请使用画笔或框选')

    const response = await fetch(MODEL_PATH, { signal: controller.signal })
    if (!response.ok) throw new Error(`模型下载失败 (${response.status})`)
    const modelAssetPath = URL.createObjectURL(await response.blob())
    try {
      const segmenter = await InteractiveSegmenter.createFromOptions(
        { wasmLoaderPath: WASM_LOADER_PATH, wasmBinaryPath: WASM_BINARY_PATH },
        { baseOptions: { modelAssetPath }, outputConfidenceMasks: false, outputCategoryMask: true },
      )
      if (controller.signal.aborted) {
        segmenter.close()
        throw controller.signal.reason
      }
      return segmenter
    } finally {
      URL.revokeObjectURL(modelAssetPath)
    }
  })()
  const timer = window.setTimeout(() => controller.abort(new Error('自动抠图模型加载超时，请重试')), MODEL_TIMEOUT_MS)
  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  })
  segmenterPromise = Promise.race([initialization, deadline])
    .catch((error: unknown) => {
      segmenterPromise = undefined
      throw error
    })
    .finally(() => window.clearTimeout(timer))
  return segmenterPromise
}

function drawingContext(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建抠图画布')
  return context
}

function cropForPoint(width: number, height: number, point: Point, bounds?: Bounds) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    return { x: 0, y: 0, width, height }
  }

  const padding = 0.15
  const left = Math.max(0, Math.floor(Math.min(point.x, bounds.x - padding * bounds.width) * width))
  const top = Math.max(0, Math.floor(Math.min(point.y, bounds.y - padding * bounds.height) * height))
  const right = Math.min(width, Math.ceil(Math.max(point.x, bounds.x + bounds.width * (1 + padding)) * width))
  const bottom = Math.min(height, Math.ceil(Math.max(point.y, bounds.y + bounds.height * (1 + padding)) * height))
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : { x: 0, y: 0, width, height }
}

/** 在浏览器本地识别点中的主体，输出与原图对齐的透明蒙版。 */
export async function segmentCanvasSubject(
  image: HTMLImageElement,
  point: Point,
  bounds?: Bounds,
  signal?: AbortSignal,
): Promise<ImageData> {
  signal?.throwIfAborted()
  const { naturalWidth, naturalHeight } = image
  if (!naturalWidth || !naturalHeight || ![point.x, point.y].every((value) => value >= 0 && value <= 1)) {
    throw new Error('请点击有效的图像区域')
  }
  const segmenter = await loadSegmenter()
  signal?.throwIfAborted()

  // 给编辑器一次渲染等待状态的机会，再运行同步推理。
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)))
  signal?.throwIfAborted()

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(naturalWidth, naturalHeight))
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))
  const crop = cropForPoint(width, height, point, bounds)
  const input = drawingContext(crop.width, crop.height)
  input.drawImage(image, -crop.x, -crop.y, width, height)
  const keypoint = {
    x: (point.x * width - crop.x) / crop.width,
    y: (point.y * height - crop.y) / crop.height,
  }

  let output: ImageData | undefined
  segmenter.segment(input.canvas, { keypoint }, ({ categoryMask }) => {
    if (!categoryMask) return
    const mask = drawingContext(categoryMask.width, categoryMask.height)
    const pixels = mask.createImageData(categoryMask.width, categoryMask.height)
    const categories = categoryMask.getAsUint8Array()
    // The mask has two categories. Read the one at the positive click, as the SDK can
    // encode the categories differently when it reads a mask back from WebGL.
    const clickedX = Math.min(categoryMask.width - 1, Math.floor(keypoint.x * categoryMask.width))
    const clickedY = Math.min(categoryMask.height - 1, Math.floor(keypoint.y * categoryMask.height))
    const clickedCategory = categories[clickedY * categoryMask.width + clickedX]
    let selected = 0
    for (let index = 0; index < categories.length; index += 1) {
      if (categories[index] !== clickedCategory) continue
      const offset = index * 4
      pixels.data[offset + 1] = 229
      pixels.data[offset + 2] = 190
      pixels.data[offset + 3] = 255
      selected += 1
    }
    if (selected === 0 || selected === categories.length) return
    mask.putImageData(pixels, 0, 0)

    const canvas = drawingContext(width, height)
    canvas.drawImage(mask.canvas, crop.x, crop.y, crop.width, crop.height)
    output = canvas.getImageData(0, 0, width, height)
  })
  if (!output) throw new Error('没有识别出清晰主体，请换一个位置点选或用画笔修正')
  return output
}
