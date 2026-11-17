export type CanvasImageCropRect = { x: number; y: number; width: number; height: number }

type Bytes = Uint8Array<ArrayBuffer>
type ImageSize = { width: number; height: number }
type PngSource = ImageSize & {
  format: 'png'
  header: Bytes
  bitsPerPixel: number
  imageData: Bytes[]
  renderingChunks: Bytes[]
}
type CropSource = PngSource | (ImageSize & { format: 'jpeg' | 'webp'; orientation: number })

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const PNG_RENDERING_CHUNKS = new Set([
  'PLTE',
  'tRNS',
  'bKGD',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'cICP',
  'mDCv',
  'cLLi',
  'pHYs',
])
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const inspectedSources = new WeakMap<Blob, Promise<CropSource>>()
// 限制浏览器需要解码和分配的字节数，避免静默降采样。
const MAX_CROP_BUFFER_BYTES = 256 * 1024 * 1024
// Chromium 以默认 sRGB 画布导出 JPEG/WebP 时附带的标准配置。
const DEFAULT_SRGB_ICC_SHA256 = '12afb4d9953adee0607d347daee5b78b18d6b3cab2d572b88970703f5edb37bc'

function readAscii(bytes: Bytes, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function brokenImage(): never {
  throw new Error('原图文件损坏或不完整，无法裁剪')
}

async function isDefaultSrgbIcc(profile: Bytes): Promise<boolean> {
  if (profile.length !== 456 || !globalThis.crypto?.subtle) return false
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', profile))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') === DEFAULT_SRGB_ICC_SHA256
}

/** EXIF 的方向决定选择框和原始像素之间的坐标关系。 */
function readExifOrientation(bytes: Bytes): number {
  const start = readAscii(bytes, 0, 6) === 'Exif\0\0' ? 6 : 0
  if (start + 8 > bytes.length) return brokenImage()
  const order = readAscii(bytes, start, 2)
  if (order !== 'II' && order !== 'MM') return brokenImage()
  const little = order === 'II'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(start + 2, little) !== 42) return brokenImage()
  const directory = start + view.getUint32(start + 4, little)
  if (directory + 2 > bytes.length) return brokenImage()
  const count = view.getUint16(directory, little)
  if (directory + 2 + count * 12 > bytes.length) return brokenImage()
  for (let index = 0; index < count; index++) {
    const entry = directory + 2 + index * 12
    if (view.getUint16(entry, little) !== 0x0112) continue
    if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) return brokenImage()
    const orientation = view.getUint16(entry + 8, little)
    if (orientation < 1 || orientation > 8) return brokenImage()
    return orientation
  }
  return 1
}

function inspectPng(bytes: Bytes): PngSource {
  if (bytes.length < 33) return brokenImage()
  const view = new DataView(bytes.buffer)
  if (view.getUint32(8) !== 13 || readAscii(bytes, 12, 4) !== 'IHDR') return brokenImage()
  const header = bytes.slice(16, 29)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const [depth, colorType, compression, filter, interlace] = header.subarray(8)
  const channels = PNG_CHANNELS[colorType]
  if (
    !width ||
    !height ||
    width > 0x7fffffff ||
    height > 0x7fffffff ||
    !channels ||
    !PNG_DEPTHS[colorType].includes(depth) ||
    compression ||
    filter
  )
    return brokenImage()
  if (interlace) throw new Error('暂不支持在保留原始像素的前提下裁剪隔行 PNG')
  const bitsPerPixel = depth * channels
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8) + 1
  if (rowBytes * height > MAX_CROP_BUFFER_BYTES) throw new Error('原图分辨率过大，无法在浏览器中以原始像素裁剪')

  const imageData: Bytes[] = []
  const renderingChunks: Bytes[] = []
  for (let start = 33; start + 12 <= bytes.length; ) {
    const length = view.getUint32(start)
    const type = readAscii(bytes, start + 4, 4)
    const end = start + 12 + length
    if (end > bytes.length) return brokenImage()
    if (type === 'IEND') {
      if (length || imageData.length === 0) return brokenImage()
      return { format: 'png', width, height, header, bitsPerPixel, imageData, renderingChunks }
    }
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('暂不支持裁剪动图，避免丢失动画帧')
    if (type === 'eXIf' && readExifOrientation(bytes.subarray(start + 8, end - 4)) !== 1)
      throw new Error('暂不支持裁剪带有特殊方向的 PNG')
    if (type === 'IDAT') imageData.push(bytes.subarray(start + 8, end - 4))
    else if (PNG_RENDERING_CHUNKS.has(type)) renderingChunks.push(bytes.subarray(start, end))
    else if ((bytes[start + 4] & 0x20) === 0) return brokenImage() // 未知关键块可能参与解码。
    start = end
  }
  return brokenImage()
}

async function inspectJpeg(bytes: Bytes): Promise<CropSource> {
  const view = new DataView(bytes.buffer)
  let size: ImageSize | undefined
  let orientation = 1
  let hasColorProfile = false
  for (let start = 2; start + 4 <= bytes.length; ) {
    if (bytes[start++] !== 0xff) return brokenImage()
    while (bytes[start] === 0xff) start++
    const marker = bytes[start++]
    if (marker === 0xda) return size ? { format: 'jpeg', ...size, orientation } : brokenImage()
    if (marker === 0xd9 || marker === 0x00 || start + 2 > bytes.length) return brokenImage()
    if (marker === 0x01) continue
    const length = view.getUint16(start)
    const end = start + length
    if (length < 2 || end > bytes.length) return brokenImage()
    const payload = bytes.subarray(start + 2, end)
    if (marker === 0xe2) {
      if (readAscii(payload, 0, 4) === 'MPF\0') throw new Error('暂不支持裁剪带有 HDR 增益图或多图的 JPEG')
      if (readAscii(payload, 0, 12) === 'ICC_PROFILE\0') {
        if (
          hasColorProfile ||
          payload[12] !== 1 ||
          payload[13] !== 1 ||
          !(await isDefaultSrgbIcc(payload.subarray(14)))
        )
          throw new Error('暂不支持裁剪带有自定义色彩配置的 JPEG')
        hasColorProfile = true
      }
    }
    if (marker === 0xe1 && readAscii(payload, 0, 6) === 'Exif\0\0') orientation = readExifOrientation(payload)
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (payload.length < 6) return brokenImage()
      const [precision, heightHigh, heightLow, widthHigh, widthLow, channels] = payload
      if (precision !== 8 || ![1, 3].includes(channels)) throw new Error('暂不支持裁剪高位深或特殊色彩空间的 JPEG')
      size = { width: widthHigh * 256 + widthLow, height: heightHigh * 256 + heightLow }
      if (!size.width || !size.height) return brokenImage()
    }
    start = end
  }
  return brokenImage()
}

async function inspectWebp(bytes: Bytes): Promise<CropSource> {
  const view = new DataView(bytes.buffer)
  const end = view.getUint32(4, true) + 8
  if (end !== bytes.length) return brokenImage()
  let size: ImageSize | undefined
  let orientation = 1
  let hasImage = false
  let expectsColorProfile = false
  let hasColorProfile = false
  for (let start = 12; start + 8 <= end; ) {
    const type = readAscii(bytes, start, 4)
    const length = view.getUint32(start + 4, true)
    const offset = start + 8
    const next = offset + length + (length % 2)
    if (next > end) return brokenImage()
    if (type === 'ANIM' || type === 'ANMF') throw new Error('暂不支持裁剪动图，避免丢失动画帧')
    if (type === 'ICCP') {
      if (hasColorProfile || !(await isDefaultSrgbIcc(bytes.subarray(offset, offset + length))))
        throw new Error('暂不支持裁剪带有自定义色彩配置的 WebP')
      hasColorProfile = true
    }
    if (type === 'ALPH') throw new Error('暂不支持裁剪透明 WebP，避免改变透明像素')
    if (type === 'EXIF') orientation = readExifOrientation(bytes.subarray(offset, offset + length))
    if (type === 'VP8X') {
      if (length !== 10) return brokenImage()
      const flags = bytes[offset]
      if (flags & 0x02) throw new Error('暂不支持裁剪动图，避免丢失动画帧')
      expectsColorProfile = (flags & 0x20) !== 0
      if (flags & 0x10) throw new Error('暂不支持裁剪透明 WebP，避免改变透明像素')
      size = {
        width: (view.getUint32(offset + 4, true) & 0xffffff) + 1,
        height: (view.getUint32(offset + 6, true) >>> 8) + 1,
      }
    }
    if (type === 'VP8L') {
      if (length < 5 || bytes[offset] !== 0x2f) return brokenImage()
      const packed = view.getUint32(offset + 1, true)
      if (packed & 0x10000000) throw new Error('暂不支持裁剪透明 WebP，避免改变透明像素')
      size ??= { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
      hasImage = true
    }
    if (type === 'VP8 ') {
      if (length < 10 || readAscii(bytes, offset + 3, 3) !== '\x9d\x01\x2a') return brokenImage()
      size ??= { width: view.getUint16(offset + 6, true) & 0x3fff, height: view.getUint16(offset + 8, true) & 0x3fff }
      hasImage = true
    }
    start = next
  }
  return size?.width && size.height && hasImage && expectsColorProfile === hasColorProfile
    ? { format: 'webp', ...size, orientation }
    : brokenImage()
}

function inspectSource(source: Blob): Promise<CropSource> {
  if (source.size > MAX_CROP_BUFFER_BYTES)
    return Promise.reject(new Error('原图文件过大，无法在浏览器中以原始像素裁剪'))
  const inspected = inspectedSources.get(source)
  if (inspected) return inspected
  const result = source.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return inspectPng(bytes)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes)
    if (readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WEBP') return inspectWebp(bytes)
    throw new Error('请选择可无损裁剪的静态 JPEG、PNG 或 WebP 图片')
  })
  inspectedSources.set(source, result)
  return result
}

export async function validateCanvasImageCropSource(source: Blob): Promise<ImageSize> {
  const { format, width, height, ...properties } = await inspectSource(source)
  if (format === 'png' && (typeof DecompressionStream !== 'function' || typeof CompressionStream !== 'function'))
    throw new Error('当前浏览器不支持原始像素 PNG 裁剪')
  if ('orientation' in properties && properties.orientation >= 5) return { width: height, height: width }
  return { width, height }
}

function validateRect(rect: CanvasImageCropRect, size: ImageSize) {
  const { x, y, width, height } = rect
  if (
    ![x, y, width, height].every(Number.isSafeInteger) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > size.width ||
    y + height > size.height
  )
    throw new Error('裁剪区域超出原图，请重新选择')
}

function validateBufferSize(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes > MAX_CROP_BUFFER_BYTES)
    throw new Error('当前图像或裁剪区域过大，请缩小选区后重试')
}

function paeth(left: number, up: number, upperLeft: number): number {
  const target = left + up - upperLeft
  const dl = Math.abs(target - left)
  const du = Math.abs(target - up)
  const dul = Math.abs(target - upperLeft)
  return dl <= du && dl <= dul ? left : du <= dul ? up : upperLeft
}

function unfilterPngRow(row: Bytes, previous: Bytes, pixelBytes: number) {
  const filter = row[0]
  if (filter > 4) return brokenImage()
  if (filter === 0) return
  for (let i = 1; i < row.length; i++) {
    const left = i > pixelBytes ? row[i - pixelBytes] : 0
    const up = previous[i]
    const upperLeft = i > pixelBytes ? previous[i - pixelBytes] : 0
    const value =
      filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >>> 1 : paeth(left, up, upperLeft)
    row[i] += value
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value
})

function makePngChunk(type: string, data: Bytes): Bytes {
  const chunk = new Uint8Array(data.length + 12)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(new TextEncoder().encode(type), 4)
  chunk.set(data, 8)
  let crc = 0xffffffff
  for (let i = 4; i < chunk.length - 4; i++) crc = crcTable[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8)
  view.setUint32(chunk.length - 4, crc ^ 0xffffffff)
  return chunk
}

/** 保留 PNG 原有样本和渲染块，避免浏览器绘图对色彩及透明像素做转换。 */
async function cropPng(image: PngSource, rect: CanvasImageCropRect): Promise<Blob> {
  validateRect(rect, image)
  const { bitsPerPixel } = image
  const pixelBytes = Math.ceil(bitsPerPixel / 8)
  const rowBytes = Math.ceil((image.width * bitsPerPixel) / 8) + 1
  const outputRowBytes = Math.ceil((rect.width * bitsPerPixel) / 8) + 1
  const outputBytes = outputRowBytes * rect.height
  validateBufferSize(outputBytes + rowBytes * 2)
  const output = new Uint8Array(outputBytes)
  const reader = new Blob(image.imageData).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  let chunk = new Uint8Array(0)
  let offset = 0
  let previous = new Uint8Array(rowBytes)
  let row = new Uint8Array(rowBytes)
  try {
    for (let y = 0; y < rect.y + rect.height; y++) {
      let cursor = 0
      while (cursor < rowBytes) {
        if (offset === chunk.length) {
          const next = await reader.read()
          if (next.done) return brokenImage()
          chunk = next.value
          offset = 0
        }
        const count = Math.min(rowBytes - cursor, chunk.length - offset)
        row.set(chunk.subarray(offset, offset + count), cursor)
        cursor += count
        offset += count
      }
      unfilterPngRow(row, previous, pixelBytes)

      if (y >= rect.y) {
        const outputStart = (y - rect.y) * outputRowBytes + 1
        if (bitsPerPixel >= 8) {
          const first = 1 + rect.x * pixelBytes
          output.set(row.subarray(first, first + rect.width * pixelBytes), outputStart)
        } else {
          const mask = (1 << bitsPerPixel) - 1
          for (let x = 0; x < rect.width; x++) {
            const sourceBit = (rect.x + x) * bitsPerPixel
            const destBit = x * bitsPerPixel
            const sample = (row[1 + (sourceBit >>> 3)] >> (8 - bitsPerPixel - (sourceBit % 8))) & mask
            output[outputStart + (destBit >>> 3)] |= sample << (8 - bitsPerPixel - (destBit % 8))
          }
        }
      }
      ;[previous, row] = [row, previous]
    }
  } finally {
    await reader.cancel()
  }
  const compressed = await new Response(
    new Blob([output]).stream().pipeThrough(new CompressionStream('deflate')),
  ).arrayBuffer()
  const header = image.header.slice()
  const view = new DataView(header.buffer)
  view.setUint32(0, rect.width)
  view.setUint32(4, rect.height)
  return new Blob(
    [
      PNG_SIGNATURE,
      makePngChunk('IHDR', header),
      ...image.renderingChunks,
      makePngChunk('IDAT', new Uint8Array(compressed)),
      makePngChunk('IEND', new Uint8Array(0)),
    ],
    { type: 'image/png' },
  )
}

async function cropOpaqueImage(
  source: Blob,
  info: Extract<CropSource, { format: 'jpeg' | 'webp' }>,
  rect: CanvasImageCropRect,
) {
  const oriented = info.orientation >= 5 ? { width: info.height, height: info.width } : info
  validateRect(rect, oriented)
  validateBufferSize(4 * (info.width * info.height + rect.width * rect.height))
  const image = await createImageBitmap(source, { imageOrientation: 'from-image', colorSpaceConversion: 'none' })
  const canvas = document.createElement('canvas')
  try {
    if (image.width !== oriented.width || image.height !== oriented.height)
      throw new Error('浏览器读取的分辨率与原图不一致，无法保留原始像素')
    canvas.width = rect.width
    canvas.height = rect.height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('当前浏览器无法以原始像素裁剪这张图片')
    context.imageSmoothingEnabled = false
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('无法导出原始像素的裁剪结果'))), 'image/png')
    })
  } finally {
    image.close()
    canvas.width = 0
    canvas.height = 0
  }
}

export async function cropCanvasImageFile(source: Blob, rect: CanvasImageCropRect, name: string): Promise<File> {
  await validateCanvasImageCropSource(source)
  const info = await inspectSource(source)
  const blob = info.format === 'png' ? await cropPng(info, rect) : await cropOpaqueImage(source, info, rect)
  const fileName = (name.trim().replace(/\.(?:png|jpe?g|webp)$/i, '') || '裁切图片') + '.png'
  return new File([blob], fileName, { type: 'image/png' })
}
