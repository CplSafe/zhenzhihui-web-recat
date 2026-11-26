/**
 * 全站共用的下载入口。验证 URL 和响应后，将 Blob 交给浏览器下载。
 * 保存位置、重名处理和取消由浏览器管理，应用不创建、覆盖或清理本地文件句柄。
 * 微信 HTTP 媒体与不允许跨域读取的附件走浏览器导航下载。
 */
import { assetAttachmentUrl, resolveSafeDownloadUrl } from '@/utils/downloadUrlSafety'

/** 保留既有返回类型。浏览器接管下载后返回 started。 */
export type DownloadResult = 'done' | 'cancelled' | 'started'

/** 下载完成后识别出的真实媒体类型与推荐扩展名。 */
export interface DownloadedMediaType {
  mimeType: string
  extension: string
}

const MEDIA_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'video/mpeg': 'mpeg',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'video/x-m4v': 'm4v',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
}

/** 微信内置 WebView 不可靠支持 blob URL 与 a[download]，需要改走原始 HTTP 媒体地址。 */
export function isWeChatBrowser(userAgent = globalThis.navigator?.userAgent || ''): boolean {
  return /MicroMessenger/i.test(String(userAgent || ''))
}

function normalizeMediaMime(value: unknown): string {
  const mime = String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  return MEDIA_EXTENSION_BY_MIME[mime] ? mime : ''
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false
  }
  return true
}

/** 从文件头识别常见图片与视频，避免错误响应头把 JPEG/WebP 保存成 PNG。 */
async function sniffMediaMime(blob: Blob): Promise<string> {
  try {
    const bytes = new Uint8Array(await blob.slice(0, 128).arrayBuffer())
    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return 'image/png'
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'image/gif'
    if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'image/webp'
    if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WAVE')) return 'audio/wav'
    if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'AVI ')) return 'video/x-msvideo'
    if (asciiAt(bytes, 0, 'ID3')) return 'audio/mpeg'
    if (asciiAt(bytes, 4, 'ftyp')) {
      if (asciiAt(bytes, 8, 'avif') || asciiAt(bytes, 8, 'avis')) return 'image/avif'
      if (asciiAt(bytes, 8, 'M4A ') || asciiAt(bytes, 8, 'M4B ')) return 'audio/mp4'
      if (asciiAt(bytes, 8, 'qt  ')) return 'video/quicktime'
      if (asciiAt(bytes, 8, '3gp')) return 'video/3gpp'
      if (asciiAt(bytes, 8, '3g2')) return 'video/3gpp2'
      if (asciiAt(bytes, 8, 'M4V ')) return 'video/x-m4v'
      return 'video/mp4'
    }
    if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && (bytes[3] === 0xba || bytes[3] === 0xb3)) {
      return 'video/mpeg'
    }
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      for (let index = 4; index < bytes.length - 4; index++) {
        if (asciiAt(bytes, index, 'matroska')) return 'video/x-matroska'
        if (asciiAt(bytes, index, 'webm')) return 'video/webm'
      }
      // 未确认的 EBML 容器由声明类型判定，避免把 MKV 当作 WebM。
      return ''
    }
  } catch {
    // 极旧 WebView 不支持 Blob.arrayBuffer 时，继续使用响应头和调用方的后备 MIME。
  }
  return ''
}

/** 优先相信文件头，其次使用响应头/Blob 类型，最后才使用调用方后备类型。 */
export async function detectDownloadedMediaType(
  blob: Blob,
  responseContentType = '',
  fallbackMimeType = '',
): Promise<DownloadedMediaType> {
  const sniffed = await sniffMediaMime(blob)
  const declared = normalizeMediaMime(responseContentType) || normalizeMediaMime(blob.type)
  const mimeType =
    (sniffed === 'video/mp4' && declared === 'audio/mp4' ? declared : sniffed) ||
    declared ||
    normalizeMediaMime(fallbackMimeType) ||
    'application/octet-stream'
  return {
    mimeType,
    extension: MEDIA_EXTENSION_BY_MIME[mimeType] || '',
  }
}

/** 根据真实媒体格式替换建议文件名扩展名；未知格式保留调用方原文件名。 */
export function alignDownloadFileName(fileName: string, mediaType: DownloadedMediaType): string {
  if (!mediaType.extension) return fileName
  const baseName = String(fileName || '下载文件').replace(/\.[a-z0-9]{1,8}$/i, '')
  return `${baseName}.${mediaType.extension}`
}

function openWechatMediaUrl(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.referrerPolicy = 'no-referrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * 安全地把已校验的远程资源交给浏览器下载。
 * URL 会在实际请求前重新解析和校验，避免过期签名及危险协议被直接打开。
 */
export async function downloadToDisk(opts: {
  /** 建议文件名(含扩展名,如 我的视频_20260624.mp4) */
  fileName: string
  /** 解析最终可下载 URL，可在此刷新签名 URL */
  resolveUrl: () => Promise<string> | string
  /** 默认保存的 MIME 类型，缺省为 video/mp4 */
  mimeType?: string
  /** 按响应头与文件头保留真实媒体格式；适用于可能返回 PNG/JPEG/WebP 的图片生成接口。 */
  preserveResponseMediaType?: boolean
}): Promise<DownloadResult> {
  const mime = opts.mimeType || 'video/mp4'
  const weChatBrowser = isWeChatBrowser()

  let resolvedUrl: string
  try {
    resolvedUrl = await opts.resolveUrl()
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'cancelled'
    throw err
  }
  // 在 fetch / iframe 之前校验地址，避免危险协议或
  // 协议相对/反斜杠地址被浏览器重新解释成可执行或非预期的外部地址。
  const safeUrl = resolveSafeDownloadUrl(resolvedUrl, globalThis.location?.origin || '')
  if (!safeUrl) {
    const unsafe = new Error('下载地址不安全，已停止下载')
    unsafe.name = 'UnsafeDownloadUrlError'
    throw unsafe
  }
  const url = mime.startsWith('video/') ? assetAttachmentUrl(safeUrl, globalThis.location.origin) : safeUrl.href

  // 微信 WebView 对 blob: + a[download] 的支持不稳定，可能创建空文件或在异步读取前丢失 Blob。
  // HTTP(S) 资源直接交给微信/后端响应处理：支持附件下载的环境会下载，其余环境会打开原图/视频供长按保存。
  if (weChatBrowser && safeUrl.kind === 'http') {
    openWechatMediaUrl(url)
    return 'started'
  }

  let blob: Blob | null = null
  let resolvedFileName = opts.fileName
  try {
    // 内容校验:视频流不应是 0 字节(资源尚未写完),也不应是 JSON/HTML/纯文本(被包成 200 的错误体)。
    // 「刚生成还没落库」是时序竞态 → 命中空内容时自动等待重试几次,多数能自愈,避免存出空 mp4。
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ct = res.headers.get('content-type') || ''
      const raw = await res.blob()
      if (raw.size > 0 && !/application\/json|text\/html|text\/plain/i.test(ct)) {
        if (opts.preserveResponseMediaType) {
          const mediaType = await detectDownloadedMediaType(raw, ct, mime)
          resolvedFileName = alignDownloadFileName(opts.fileName, mediaType)
          blob = mediaType.mimeType === raw.type ? raw : new Blob([raw], { type: mediaType.mimeType })
        } else {
          blob = new Blob([raw], { type: mime })
        }
        break
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500)) // 等待后端写完再重试
    }
    if (!blob) {
      const empty = new Error('视频内容为空或尚未就绪,请稍后重试')
      empty.name = 'EmptyContentError'
      throw empty
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'cancelled'
    if (err?.name === 'EmptyContentError') {
      // 空内容交给调用方提示。
      throw err
    }
    const isNetworkTypeError = err instanceof TypeError || err?.name === 'TypeError'
    // 同源地址不存在 CORS 兜底价值；blob:、HTTP 错误及其他真实失败也绝不进入 iframe。
    // 只有跨域 http(s) 的网络 TypeError 才可能是“资源可下载但 fetch 被 CORS 拦截”。
    if (!safeUrl.isCrossOrigin || safeUrl.kind !== 'http' || !isNetworkTypeError) {
      const failure = new Error('视频下载失败，请稍后重试')
      failure.name = 'DownloadFetchError'
      throw failure
    }
  }

  if (blob) {
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = resolvedFileName
    try {
      document.body.appendChild(a)
      a.click()
    } finally {
      a.remove()
      // 留足时间让下载器异步读取文件。
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
    }
    return 'started'
  }

  // 跨域 CDN 不允许读取资源时，用 iframe 触发附件下载，当前页面保持打开。
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.tabIndex = -1
  iframe.setAttribute('aria-hidden', 'true')
  iframe.referrerPolicy = 'no-referrer'
  iframe.src = url
  document.body.appendChild(iframe)
  let removed = false
  const removeIframe = () => {
    if (removed) return
    removed = true
    try {
      document.body.removeChild(iframe)
    } catch {
      /* 已移除 */
    }
  }
  iframe.addEventListener('load', () => window.setTimeout(removeIframe, 1000), { once: true })
  iframe.addEventListener('error', removeIframe, { once: true })
  window.setTimeout(removeIframe, 60_000)
  // 浏览器不会向页面暴露 Content-Disposition 下载是否真正落盘；这里只能确认已发起，
  // 不能继续向用户误报“视频已保存”。
  return 'started'
}

/**
 * 生成「安全文件名_YYYYMMDD_HHmmss.ext」。title 去掉非法字符;date 由调用方传入(模块内不可用 Date.now)。
 *
 * 精确到秒而不是只到天：同一天里对同一个素材反复导出（改一版、下一版）是常态，
 * 只带年月日会得到完全相同的文件名，浏览器只能追加「(1)」「(2)」——
 * 落到磁盘上就分不清哪个是哪一版了。带上时分秒既天然唯一，也能按文件名直接排序。
 * 用下划线分隔日期与时间，而不是连成 14 位数字，肉眼更容易读出时间。
 */
export function buildDownloadName(title: string, date: Date, ext = 'mp4'): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const dateStr = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  // 冒号是 Windows 的非法文件名字符，时分秒只能连写
  const timeStr = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const safe =
    String(title || '视频')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim() || '视频'
  return `${safe}_${dateStr}_${timeStr}.${ext}`
}
