/**
 * 把上传的图片文件转成「缩放后的 dataURL」。
 * 用 dataURL(而非 objectURL)才能随 localStorage 草稿持久化、刷新后不丢;缩放控制体积。
 */
export function fileToDataUrl(file: File, max = 1280, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) {
        reject(new Error('无法处理图片'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      try {
        resolve(c.toDataURL('image/jpeg', quality))
      } catch (e) {
        reject(e as Error)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

/** 后端人脸检测(image.face_detect)送阿里云的硬限制:≤3MB、边长 ≤4096、仅 JPEG/PNG。 */
export const FACE_DETECT_IMAGE_MAX_BYTES = 3 * 1024 * 1024
export const FACE_DETECT_IMAGE_MAX_DIM = 4096
const FACE_DETECT_IMAGE_MIMES = new Set(['image/jpeg', 'image/png'])
/** 压缩重试上限:先降 JPEG 质量到 0.7，再逐轮缩边长，超过轮数就放弃、交给后端给出明确错误。 */
const FACE_DETECT_COMPRESS_MAX_ATTEMPTS = 8

/** 仅凭文件元信息判断是否必须压缩：体积超限或格式不是 JPEG/PNG。边长超限需解码后才知道。 */
export function needsFaceDetectImageCompression(file: Pick<File, 'size' | 'type'>): boolean {
  return file.size > FACE_DETECT_IMAGE_MAX_BYTES || !FACE_DETECT_IMAGE_MIMES.has(file.type)
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/**
 * 把替换素材图压到人脸检测接口的限制以内（≤3MB、≤4096px、JPEG）。
 * 手机原图常在 5~12MB，不压直接提交会被后端 INVALID_MODEL_PARAMS「素材文件过大」拒绝。
 * 已在限制内的 JPEG/PNG 原样返回；浏览器无法处理（无 canvas / 解码失败）时也原样返回，
 * 让后端给出明确错误而不是在这里静默失败。
 */
export async function compressImageFileForFaceDetect(file: File): Promise<File> {
  let img: HTMLImageElement
  try {
    img = await loadImageElement(file)
  } catch {
    return file
  }
  const longest = Math.max(img.width, img.height)
  if (!needsFaceDetectImageCompression(file) && longest <= FACE_DETECT_IMAGE_MAX_DIM) return file
  if (!longest) return file

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return file

  let scale = Math.min(1, FACE_DETECT_IMAGE_MAX_DIM / longest)
  // 用整数百分比步进，避免 0.9-0.1-0.1 的浮点误差让「降到 0.7 为止」多降一档。
  let qualityPercent = 90
  for (let attempt = 0; attempt < FACE_DETECT_COMPRESS_MAX_ATTEMPTS; attempt += 1) {
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    canvas.width = w
    canvas.height = h
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await canvasToBlob(canvas, qualityPercent / 100)
    if (!blob) return file
    if (blob.size <= FACE_DETECT_IMAGE_MAX_BYTES) {
      const name = file.name.replace(/\.[a-z0-9]+$/i, '') || 'image'
      return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
    }
    if (qualityPercent > 70) qualityPercent -= 10
    else scale *= 0.8
  }
  return file
}
