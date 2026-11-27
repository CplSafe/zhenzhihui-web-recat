import {
  VIDEO_REFERENCE_IMAGE_MAX_ASPECT_RATIO,
  VIDEO_REFERENCE_IMAGE_MIN_ASPECT_RATIO,
  type ImageDimensions,
} from './imageFile'

const MAX_PIXEL_BUFFER_BYTES = 256 * 1024 * 1024

export interface CanvasImagePaddingLayout extends ImageDimensions {
  left: number
  right: number
  top: number
  bottom: number
}

export function getCanvasImagePadding({ width, height }: ImageDimensions): CanvasImagePaddingLayout {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('原图尺寸无效，无法补边')
  }

  const paddedWidth = Math.max(width, Math.ceil(height * VIDEO_REFERENCE_IMAGE_MIN_ASPECT_RATIO))
  const paddedHeight = Math.max(height, Math.ceil(width / VIDEO_REFERENCE_IMAGE_MAX_ASPECT_RATIO))
  const extraWidth = paddedWidth - width
  const extraHeight = paddedHeight - height
  const left = Math.floor(extraWidth / 2)
  const top = Math.floor(extraHeight / 2)

  return {
    width: paddedWidth,
    height: paddedHeight,
    left,
    right: extraWidth - left,
    top,
    bottom: extraHeight - top,
  }
}

export interface CanvasPaddedImage {
  file: File
  originalSize: ImageDimensions
  layout: CanvasImagePaddingLayout
}

/** 按原尺寸绘入原图，只在新增的边带填白，保留原图的透明区域。 */
export async function createPaddedCanvasImageFile(
  source: Blob,
  title: string,
  signal: AbortSignal,
): Promise<CanvasPaddedImage> {
  signal.throwIfAborted()
  const image = await createImageBitmap(source, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('无法读取原图，请关闭窗口后重试')
  })
  const canvas = document.createElement('canvas')
  try {
    signal.throwIfAborted()
    const originalSize = { width: image.width, height: image.height }
    const layout = getCanvasImagePadding(originalSize)
    const { width, height, left, right, top, bottom } = layout
    if (4 * (image.width * image.height + width * height) > MAX_PIXEL_BUFFER_BYTES) {
      throw new Error('原图分辨率过大，当前浏览器无法补边')
    }

    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法补边')
    context.fillStyle = '#fff'
    if (left || right) {
      context.fillRect(0, 0, left, height)
      context.fillRect(width - right, 0, right, height)
    } else {
      context.fillRect(0, 0, width, top)
      context.fillRect(0, height - bottom, width, bottom)
    }
    context.drawImage(image, left, top)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    signal.throwIfAborted()
    if (!blob) throw new Error('无法导出补边图，请重试')
    const name = title.trim().replace(/\.[a-z0-9]+$/i, '') || '图片'
    return { file: new File([blob], `${name}-补边.png`, { type: 'image/png' }), originalSize, layout }
  } finally {
    image.close()
    canvas.width = 0
    canvas.height = 0
  }
}
