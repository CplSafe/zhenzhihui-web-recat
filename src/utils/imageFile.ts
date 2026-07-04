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
