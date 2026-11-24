import { buildDownloadName, detectDownloadedMediaType } from './downloadToDisk'
import { assetAttachmentUrl, resolveSafeDownloadUrl } from './downloadUrlSafety'

export type CanvasDownloadItem =
  | { title: string; kind: 'text'; text: string }
  | { title: string; kind: 'image' | 'video' | 'audio'; url: string }

// Blob 下载仍需保留归档数据；目录写入不受此限制。
const ARCHIVE_LIMIT_BYTES = 512 * 1024 * 1024
const ARCHIVE_CHUNK_BYTES = 1024 * 1024

function safeTitle(title: string) {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, '')
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned
}

async function readFile(item: CanvasDownloadItem): Promise<File> {
  const title = safeTitle(item.title) || '画布素材'
  if (item.kind === 'text') {
    return new File([item.text], `${title.replace(/\.txt$/i, '')}.txt`, { type: 'text/plain;charset=utf-8' })
  }
  const address = resolveSafeDownloadUrl(item.url, window.location.origin)
  if (!address) throw new Error('无效的素材地址')
  const url = item.kind === 'video' ? assetAttachmentUrl(address, window.location.origin) : address.href
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('素材读取失败')
  const contentType = response.headers.get('content-type') || ''
  const blob = await response.blob()
  if (!blob.size || /^(?:text\/html|application\/(?:[^;]*\+)?json)/i.test(contentType)) {
    throw new Error('素材为空或已失效')
  }
  const type = await detectDownloadedMediaType(blob, contentType)
  if (!type.extension || !type.mimeType.startsWith(`${item.kind}/`)) throw new Error('无法确认素材文件格式')
  const base = title.replace(
    /\.(?:jpe?g|png|webp|gif|avif|svg|mp4|mov|webm|m4v|mkv|avi|mpe?g|3gp|3g2|wav|mp3|aac|m4a)$/i,
    '',
  )
  return new File([blob], `${base || '画布素材'}.${type.extension}`, { type: type.mimeType })
}

function uniqueFileName(filename: string, used: Set<string>) {
  const dot = filename.lastIndexOf('.')
  const base = filename.slice(0, dot)
  const extension = filename.slice(dot)
  let name = filename
  for (let suffix = 2; used.has(name.toLowerCase()); suffix++) {
    name = `${base} (${suffix})${extension}`
  }
  used.add(name.toLowerCase())
  return name
}

function triggerArchiveDownload(archive: Blob, fileName: string) {
  const url = URL.createObjectURL(archive)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Write separate files into a fresh folder where supported, otherwise download one ZIP. */
export async function downloadCanvasSelection(items: readonly CanvasDownloadItem[]) {
  const picker = (
    window as Window & {
      showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker
  const archiveName = buildDownloadName('画布素材', new Date(), 'zip')
  let directory: FileSystemDirectoryHandle | undefined
  if (picker) {
    try {
      const parent = await picker.call(window, { mode: 'readwrite' })
      const suffix = crypto.randomUUID().slice(0, 8)
      directory = await parent.getDirectoryHandle(`${archiveName.slice(0, -4)}_${suffix}`, { create: true })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { mode: 'cancelled' as const, count: 0, failed: [] }
      }
      if (!(error instanceof DOMException) || !['SecurityError', 'NotAllowedError'].includes(error.name)) throw error
    }
  }

  const names = new Set<string>()
  const failed: string[] = []
  let count = 0
  const zip = directory ? null : await import('fflate')
  const chunks: BlobPart[] = []
  const archive =
    zip &&
    new zip.Zip((error, data) => {
      if (error) throw error
      chunks.push(data)
    })
  let archiveBytes = 0
  for (const item of items) {
    let file: File
    try {
      file = await readFile(item)
    } catch (error) {
      failed.push(`${item.title} · ${error instanceof Error ? error.message : '下载失败'}`)
      continue
    }
    const name = uniqueFileName(file.name, names)
    if (directory) {
      let writer: FileSystemWritableFileStream | undefined
      try {
        const handle = await directory.getFileHandle(name, { create: true })
        writer = await handle.createWritable()
        await writer.write(file)
        await writer.close()
      } catch {
        await writer?.abort().catch(() => undefined)
        await directory.removeEntry(name).catch(() => undefined)
        failed.push(`${item.title} · 无法保存到目录`)
        continue
      }
    } else if (archiveBytes + file.size > ARCHIVE_LIMIT_BYTES) {
      failed.push(`${item.title} · 压缩包超过 512 MB，请分批下载`)
      continue
    } else {
      const entry = new zip.ZipPassThrough(name)
      archive.add(entry)
      for (let offset = 0; offset < file.size; offset += ARCHIVE_CHUNK_BYTES) {
        const end = Math.min(offset + ARCHIVE_CHUNK_BYTES, file.size)
        const bytes = new Uint8Array(await new Response(file.slice(offset, end)).arrayBuffer())
        entry.push(bytes, end === file.size)
      }
      archiveBytes += file.size
    }
    count++
  }

  if (archive && count) {
    archive.end()
    triggerArchiveDownload(new Blob(chunks, { type: 'application/zip' }), archiveName)
  }
  return { mode: directory ? ('directory' as const) : ('zip' as const), count, failed }
}
