/** 图片超分的输入限制；保留原图，副本使用 PNG 避免丢失透明度。 */
export function fitUpscaleInput(width: number, height: number) {
  const scale = Math.min(1, 4096 / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function createUpscaleInputFile(url: string, name: string, signal: AbortSignal): Promise<File> {
  const response = await fetch(url, { signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error('原图读取失败，请重试')
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('原图解码失败，请更换图片'))
      image.src = objectUrl
    })
    signal.throwIfAborted()
    if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error('原图尺寸无效')
    const size = fitUpscaleInput(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法缩小图片，请更换浏览器重试')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, size.width, size.height)
    const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    signal.throwIfAborted()
    if (!output) throw new Error('缩小图片失败，请重试')
    return new File([output], `${(name || '图片').replace(/\.[^.]+$/, '')}-超分输入.png`, { type: 'image/png' })
  } finally {
    image.src = ''
    URL.revokeObjectURL(objectUrl)
  }
}
