/**
 * 无限画布 · 本地图片导入的纯逻辑层
 *
 * 供三个入口共用：左侧工具栏「本地图片」、剪贴板粘贴（Ctrl+V）、文件拖拽到画布。
 * 负责从 FileList / DataTransfer 中挑出图片文件，并把原图长宽比就近吸附到图片节点可选比例。
 */

/** 图片节点可选比例（与 CanvasNodePanel 的 aspectRatios 保持一致） */
export const IMAGE_NODE_RATIOS = ['2:3', '1:1', '4:3', '16:9', '9:16'] as const

/** 一次导入（选择/粘贴/拖拽）最多创建的图片节点数，避免误操作触发大量上传 */
export const LOCAL_IMAGE_IMPORT_LIMIT = 9

/** 从文件列表中挑出图片文件（忽略视频/文档等非图片文件） */
export function pickImageFiles(files: ArrayLike<File | null> | null | undefined): File[] {
  return Array.from(files || []).filter(
    (file): file is File => Boolean(file) && String(file!.type || '').startsWith('image/'),
  )
}

/**
 * 从拖拽 / 剪贴板的 DataTransfer 中提取图片文件。
 *
 * 粘贴截图时 files 可能为空、只有 items（kind='file'），两条路径都要覆盖。
 */
export function extractImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const fromFiles = pickImageFiles(data.files)
  if (fromFiles.length > 0) return fromFiles
  const items = Array.from(data.items || [])
  return pickImageFiles(items.filter((item) => item && item.kind === 'file').map((item) => item.getAsFile()))
}

/** DataTransfer 中是否携带文件（拖拽画布节点、选中文本时不应触发导入提示） */
export function hasFileDrag(data: DataTransfer | null | undefined): boolean {
  if (!data) return false
  return Array.from(data.types || []).includes('Files')
}

/** 把原图长宽比就近吸附到图片节点可选比例；尺寸非法时退回 1:1 */
export function snapImageRatio(width: number, height: number): string {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '1:1'
  const target = w / h
  let best = '1:1'
  let bestDiff = Number.POSITIVE_INFINITY
  for (const candidate of IMAGE_NODE_RATIOS) {
    const [cw, ch] = candidate.split(':').map(Number)
    if (!cw || !ch) continue
    // 用对数距离比较，保证 16:9 与 9:16 这类互为倒数的比例被同等对待
    const diff = Math.abs(Math.log(target / (cw / ch)))
    if (diff < bestDiff) {
      bestDiff = diff
      best = candidate
    }
  }
  return best
}

/** 读取本地图片的原始宽高；解码失败返回 null（调用方退回默认比例） */
export function readImageNaturalSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Image === 'undefined') {
      resolve(null)
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    const done = (size: { width: number; height: number } | null) => {
      URL.revokeObjectURL(url)
      resolve(size)
    }
    image.onload = () =>
      done(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null,
      )
    image.onerror = () => done(null)
    image.src = url
  })
}
