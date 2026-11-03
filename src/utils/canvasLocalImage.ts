/**
 * 漫剧制作 · 本地素材导入的纯逻辑层
 *
 * 供三个入口共用：左侧工具栏「本地素材」、剪贴板粘贴（Ctrl+V）、文件拖拽到画布。
 * 负责从 FileList / DataTransfer 中挑出图片、视频与音频文件，并把原图长宽比就近吸附到图片节点可选比例。
 *
 * 三个入口必须收同一套文件类型，最终走同一个导入函数。
 */

import { isAudioFile } from './canvasAudio'
import { mimeTypeFromSignature } from './fileSignature'

/** 图片节点可选比例（与 CanvasNodePanel 的 aspectRatios 保持一致） */
export const IMAGE_NODE_RATIOS = ['2:3', '1:1', '4:3', '16:9', '9:16'] as const

/** 一次导入（选择/粘贴/拖拽）最多创建的图片节点数，避免误操作触发大量上传 */
/** 单次本地素材导入上限；上传阶段会限流，避免大量文件同时占满网络和内存。 */
export const LOCAL_IMAGE_IMPORT_LIMIT = 100

/** 部分 Windows 文件来源会把 HEIC/HEIF 的 File.type 留空，按扩展名兜底。 */
export function isCanvasImageFile(file: File | null | undefined): file is File {
  if (!file) return false
  if (
    String(file.type || '')
      .toLowerCase()
      .startsWith('image/')
  )
    return true
  return /\.(?:heic|heif)$/i.test(String(file.name || ''))
}

/** HEIC/HEIF 无法在多数浏览器中直接预览；不解码时返回原文件供上传端报错处理。 */
export async function normalizeCanvasImageFile(file: File): Promise<File> {
  const signatureMime = mimeTypeFromSignature(new Uint8Array(await file.slice(0, 64).arrayBuffer()))
  const mime = signatureMime || String(file.type || '').toLowerCase()
  if (mime !== 'image/heic' && mime !== 'image/heif') return file

  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('当前浏览器无法解码 HEIC 图片，请先转成 JPG 或 PNG 后再上传'))
      image.src = url
    })
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (!(width > 0) || !(height > 0)) throw new Error('HEIC 图片无效，请检查文件后重试')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法转换 HEIC 图片，请先转成 JPG 或 PNG 后再上传')
    context.drawImage(image, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) throw new Error('HEIC 图片转换失败，请先转成 JPG 或 PNG 后再上传')
    const name = String(file.name || 'image.heic').replace(/\.(?:heic|heif)$/i, '') || 'image'
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 从文件列表中挑出图片文件（忽略视频/文档等非图片文件） */
export function pickImageFiles(files: ArrayLike<File | null> | null | undefined): File[] {
  return Array.from(files || []).filter((file): file is File => isCanvasImageFile(file))
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

/**
 * 单个本地视频的体积上限。
 *
 * 与时间线本地合成用的是同一个 512MB 口径：再大就不该走浏览器内存这条路，
 * 而且这类文件在弱网下上传几乎必然超时，提前拦下比让用户等到失败更好。
 */
export const LOCAL_VIDEO_MAX_BYTES = 512 * 1024 * 1024

/** File.type 在部分 Windows 拖放来源中为空；常见后缀用于兜底识别。 */
const VIDEO_FILE_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'm4v',
  'webm',
  'avi',
  'mkv',
  'mpeg',
  'mpg',
  '3gp',
  '3g2',
  'ogv',
  'ts',
])

/** MIME 或常见视频后缀命中即可识别本地视频。 */
export function isCanvasVideoFile(file: File | null | undefined): file is File {
  if (!file) return false
  if (
    String(file.type || '')
      .toLowerCase()
      .startsWith('video/')
  )
    return true
  const extension =
    String(file.name || '')
      .split('.')
      .pop()
      ?.toLowerCase() || ''
  return VIDEO_FILE_EXTENSIONS.has(extension)
}

/** 从文件列表中挑出视频文件 */
export function pickVideoFiles(files: ArrayLike<File | null> | null | undefined): File[] {
  return Array.from(files || []).filter(isCanvasVideoFile)
}

/** 一次导入中按类型分好的本地素材。 */
export interface LocalMediaFiles {
  images: File[]
  videos: File[]
  audios: File[]
  unsupported: File[]
}

/**
 * 从拖拽 / 剪贴板的 DataTransfer 中提取图片、视频与音频文件。
 *
 * 与 extractImageFiles 同样要兼顾 files 为空、只有 items 的情况（粘贴截图、
 * 部分浏览器复制视频文件时走的就是 items）。
 * files 包含任一支持的素材时直接使用，避免又从 items 重复导入。
 */
export function extractMediaFiles(data: DataTransfer | null | undefined): LocalMediaFiles {
  if (!data) return { images: [], videos: [], audios: [], unsupported: [] }
  const listedFiles = Array.from(data.files || [])
  const items = Array.from(data.items || [])
  const fromItems = items.filter((item) => item && item.kind === 'file').map((item) => item.getAsFile())
  // 拖放时优先使用原始 FileList，即使其中只有不支持的文件，也不要误落到重复的 items 分支。
  const files = listedFiles.length ? listedFiles : fromItems.filter((file): file is File => Boolean(file))
  const images = pickImageFiles(files)
  const videos = pickVideoFiles(files)
  const audios = files.filter(isAudioFile)
  const supported = new Set([...images, ...videos, ...audios])
  return {
    images,
    videos,
    audios,
    unsupported: files.filter((file) => !supported.has(file)),
  }
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

/** 原图真实长宽比，约分后用于画布素材节点尺寸；非法尺寸退回 1:1。 */
export function naturalImageRatio(width: number, height: number): string {
  const w = Math.round(Number(width))
  const h = Math.round(Number(height))
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w <= 0 || h <= 0) return '1:1'
  const gcd = (left: number, right: number): number => {
    let a = left
    let b = right
    while (b > 0) {
      const remainder = a % b
      a = b
      b = remainder
    }
    return a || 1
  }
  const divisor = gcd(w, h)
  return `${w / divisor}:${h / divisor}`
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
