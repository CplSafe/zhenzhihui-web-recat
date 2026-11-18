/** PNG is the portable image representation supported by browser clipboards. */
async function normalizeImage(blob: Blob): Promise<{ png: Blob; fingerprint: string }> {
  const bitmap = await createImageBitmap(blob)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) {
      throw new Error('图片尺寸过大，无法复制')
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取图片')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const digest = await crypto.subtle.digest('SHA-256', pixels)
    const fingerprint = `${canvas.width}x${canvas.height}:${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')}`
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('图片转换失败'))), 'image/png'),
    )
    return { png, fingerprint }
  } finally {
    bitmap.close()
  }
}

export async function fingerprintClipboardImage(blob: Blob): Promise<string> {
  return (await normalizeImage(blob)).fingerprint
}

/** Start write inside the user's gesture; the image may load asynchronously. */
export function copyImageToSystemClipboard(url: string, isCurrent: () => boolean) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined' || !crypto.subtle) {
    throw new Error('当前浏览器不支持复制图片')
  }
  const image = (async () => {
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('图片读取失败')
    const result = await normalizeImage(await response.blob())
    if (!isCurrent()) throw new Error('复制已被新的操作替代')
    return result
  })()
  const write = navigator.clipboard.write([new ClipboardItem({ 'image/png': image.then((value) => value.png) })])
  return { write, fingerprint: image.then((value) => value.fingerprint) }
}
