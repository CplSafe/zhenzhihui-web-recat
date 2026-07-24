/**
 * 下载文件到本地,并尽量让用户自选保存位置。全站唯一下载入口
 * (项目管理 / 智能成片 / 爆款复制 / 历史项目 / 模板库 都走这里,取代此前 4 套各异实现)。
 *
 * 四步:
 *  ① 先在用户手势内弹 showSaveFilePicker「另存为」拿文件句柄(必须在任何耗时 await 之前调用,
 *     以保留瞬时激活;用户取消则直接结束)。浏览器不支持(非 Chromium / 非安全上下文)则无句柄。
 *  ② resolveUrl()(可在此刷新签名 URL)。
 *  ③ 尝试 fetch 成 blob 并校验内容(任何源都试:同源 /download 必成,跨域资源域名若放行 CORS 也成):
 *     - 有文件句柄 → 写入句柄;
 *     - 无句柄 → a[download] 触发下载(blob 同源,download 必生效,文件名可控)。
 *  ④ fetch 失败(跨域未放行 CORS / 网络)→ 隐藏 iframe 触发浏览器下载(靠 Content-Disposition,不跳转页面)。
 */
import { resolveSafeDownloadUrl } from '@/utils/downloadUrlSafety'

/** 下载动作的最终结果，用于区分已完成、用户取消与浏览器接管。 */
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
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer())
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
    if (asciiAt(bytes, 4, 'ftyp')) {
      if (asciiAt(bytes, 8, 'avif') || asciiAt(bytes, 8, 'avis')) return 'image/avif'
      return 'video/mp4'
    }
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return 'video/webm'
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
  const mimeType =
    (await sniffMediaMime(blob)) ||
    normalizeMediaMime(responseContentType) ||
    normalizeMediaMime(blob.type) ||
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
 * 安全地把远程资源保存到本地；优先使用文件选择器，失败时降级为浏览器下载。
 * URL 会在实际请求前重新解析和校验，避免过期签名及危险协议被直接打开。
 */
export async function downloadToDisk(opts: {
  /** 建议文件名(含扩展名,如 我的视频_20260624.mp4) */
  fileName: string
  /** 解析最终可下载 URL(可在此刷新签名 URL);在选好保存位置后才调用 */
  resolveUrl: () => Promise<string> | string
  /** MIME(写入文件句柄时用,默认 video/mp4) */
  mimeType?: string
  /** 按响应头与文件头保留真实媒体格式；适用于可能返回 PNG/JPEG/WebP 的图片生成接口。 */
  preserveResponseMediaType?: boolean
}): Promise<DownloadResult> {
  const mime = opts.mimeType || 'video/mp4'
  const ext = (opts.fileName.split('.').pop() || '').toLowerCase()
  const weChatBrowser = isWeChatBrowser()

  // ① 先弹「另存为」(用户手势内)
  const picker = (window as { showSaveFilePicker?: any }).showSaveFilePicker
  let fileHandle: any = null
  if (typeof picker === 'function' && !weChatBrowser && !opts.preserveResponseMediaType) {
    try {
      fileHandle = await picker({
        suggestedName: opts.fileName,
        ...(ext ? { types: [{ description: '文件', accept: { [mime]: [`.${ext}`] } }] } : {}),
      })
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled' // 用户取消
      fileHandle = null // 不支持/权限失败 → 后续仍可 a[download] / iframe
    }
  }

  // ② 解析并校验视频数据 URL。必须在 fetch / iframe 之前完成，避免危险协议或
  // 协议相对/反斜杠地址被浏览器重新解释成可执行或非预期的外部地址。
  const safeUrl = resolveSafeDownloadUrl(await opts.resolveUrl(), globalThis.location?.origin || '')
  if (!safeUrl) {
    const unsafe = new Error('下载地址不安全，已停止下载')
    unsafe.name = 'UnsafeDownloadUrlError'
    throw unsafe
  }
  const url = safeUrl.href

  // 微信 WebView 对 blob: + a[download] 的支持不稳定，可能创建空文件或在异步读取前丢失 Blob。
  // HTTP(S) 资源直接交给微信/后端响应处理：支持附件下载的环境会下载，其余环境会打开原图/视频供长按保存。
  if (weChatBrowser && safeUrl.kind === 'http') {
    openWechatMediaUrl(url)
    return 'started'
  }

  // ③ 尝试 fetch + 内容校验(任何源都试一次)
  let blob: Blob | null = null
  let resolvedFileName = opts.fileName
  let useIframeFallback = false
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
    if (err?.name === 'EmptyContentError') throw err // 空内容:别静默回退到 iframe(同样是空),交给调用方提示
    const isNetworkTypeError = err instanceof TypeError || err?.name === 'TypeError'
    // 同源地址不存在 CORS 兜底价值；blob:、HTTP 错误及其他真实失败也绝不进入 iframe。
    // 只有跨域 http(s) 的网络 TypeError 才可能是“资源可下载但 fetch 被 CORS 拦截”。
    if (!safeUrl.isCrossOrigin || safeUrl.kind !== 'http' || !isNetworkTypeError) {
      const failure = new Error('视频下载失败，请稍后重试')
      failure.name = 'DownloadFetchError'
      throw failure
    }
    useIframeFallback = true
  }

  if (!useIframeFallback && blob) {
    // 写盘与 fetch 分开处理：文件系统写入或 a.click() 失败不能被误判成 CORS 再走 iframe。
    if (fileHandle) {
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'done'
    }
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = resolvedFileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 微信 HTTP 下载不会走 Blob；其余浏览器仍留足时间让下载器异步读取大文件。
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
    return 'done'
  }

  // ④ 隐藏 iframe 触发下载(跨域未放行 CORS 的 CDN 走这条路,不跳转页面)
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

/** 生成「安全文件名_YYYYMMDD.ext」。title 去掉非法字符;date 由调用方传入(模块内不可用 Date.now)。 */
export function buildDownloadName(title: string, date: Date, ext = 'mp4'): string {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const safe =
    String(title || '视频')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim() || '视频'
  return `${safe}_${dateStr}.${ext}`
}
