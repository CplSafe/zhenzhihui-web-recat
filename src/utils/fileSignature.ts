/**
 * 按文件头（magic bytes）识别真实媒体格式。
 *
 * 浏览器给的 File.type 只看扩展名：把 JPEG 改名成 .png、手机导出的 HEIC 挂着 .jpg、
 * 录屏 MOV 叫 .mp4 都很常见。上传时如果照抄 File.type 声明 mime_type，后端 /complete
 * 读对象头做校验会发现不一致，直接 400「素材上传参数不合法」——而文件已经传上去了。
 * 所以申请上传凭证前先读文件头，用真实类型去声明。
 */

const SIGNATURE_BYTES = 64

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false
  }
  return true
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])
const HEIF_BRANDS = new Set(['mif1', 'msf1'])
const AVIF_BRANDS = new Set(['avif', 'avis'])

/** ISO BMFF（MP4 / MOV / HEIC / AVIF / M4A / 3GP）按 major brand 与兼容 brand 区分。 */
function isoBmffMime(bytes: Uint8Array): string {
  const major = readAscii(bytes, 8, 4)
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  const compatible: string[] = []
  const end = Math.min(boxSize || bytes.length, bytes.length)
  for (let offset = 16; offset + 4 <= end; offset += 4) compatible.push(readAscii(bytes, offset, 4))
  const brands = [major, ...compatible]

  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'image/avif'
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return 'image/heic'
  if (HEIF_BRANDS.has(major)) return 'image/heif'
  if (major === 'qt  ') return 'video/quicktime'
  if (major === 'M4A ' || major === 'M4B ' || major === 'M4P ') return 'audio/mp4'
  if (major.startsWith('3g2')) return 'video/3gpp2'
  if (major.startsWith('3gp')) return 'video/3gpp'
  return 'video/mp4'
}

/** 识别不出时返回空串，由调用方回退到声明类型。 */
export function mimeTypeFromSignature(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    asciiAt(bytes, 1, 'PNG') &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'image/gif'
  if (asciiAt(bytes, 0, 'RIFF')) {
    if (asciiAt(bytes, 8, 'WEBP')) return 'image/webp'
    if (asciiAt(bytes, 8, 'AVI ')) return 'video/x-msvideo'
    if (asciiAt(bytes, 8, 'WAVE')) return 'audio/wav'
    return ''
  }
  if (asciiAt(bytes, 0, 'BM') && bytes.length >= 14) return 'image/bmp'
  if (asciiAt(bytes, 4, 'ftyp')) return isoBmffMime(bytes)
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // EBML 头里带 DocType；只有 "webm" 才是 WebM，其余按 Matroska。
    const head = readAscii(bytes, 0, bytes.length)
    return head.includes('webm') ? 'video/webm' : 'video/x-matroska'
  }
  if (asciiAt(bytes, 0, 'FLV')) return 'video/x-flv'
  if (asciiAt(bytes, 0, 'OggS')) return 'audio/ogg'
  if (asciiAt(bytes, 0, 'fLaC')) return 'audio/flac'
  if (asciiAt(bytes, 0, 'ID3')) return 'audio/mpeg'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    // 帧同步字：layer 位为 0 的是 ADTS AAC，其余是 MPEG 音频（MP3）。
    return (bytes[1] & 0x06) === 0 ? 'audio/aac' : 'audio/mpeg'
  }
  return ''
}

export async function sniffFileMimeType(blob: Blob): Promise<string> {
  try {
    return mimeTypeFromSignature(new Uint8Array(await blob.slice(0, SIGNATURE_BYTES).arrayBuffer()))
  } catch {
    // 极旧 WebView 不支持 Blob.arrayBuffer 时，交给调用方回退到 File.type。
    return ''
  }
}

function normalizeMime(value: unknown): string {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}

/** MP4 容器的通用 brand（isom/mp42）既可能是视频也可能是 M4A 音频，声明为音频时保留声明。 */
const MP4_AUDIO_DECLARED = new Set(['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'])

/** 上传用的真实 MIME：优先文件头，其次 File.type，最后 application/octet-stream。 */
export async function resolveUploadMimeType(file: Blob): Promise<string> {
  const declared = normalizeMime(file?.type)
  const sniffed = file ? await sniffFileMimeType(file) : ''
  if (!sniffed) return declared || 'application/octet-stream'
  if (sniffed === 'video/mp4' && MP4_AUDIO_DECLARED.has(declared)) return declared
  return sniffed
}
