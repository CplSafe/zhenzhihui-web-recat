import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FACE_DETECT_IMAGE_MAX_BYTES,
  compressImageFileForFaceDetect,
  needsFaceDetectImageCompression,
} from '@/utils/imageFile'

class FakeImage {
  static instances: FakeImage[] = []

  width = 0
  height = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''

  constructor() {
    FakeImage.instances.push(this)
  }
}

const withSize = (file: File, size: number): File => {
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('needsFaceDetectImageCompression', () => {
  it('passes JPEG/PNG within 3MB and flags oversized or non JPEG/PNG files', () => {
    expect(needsFaceDetectImageCompression({ size: 1024, type: 'image/jpeg' })).toBe(false)
    expect(needsFaceDetectImageCompression({ size: FACE_DETECT_IMAGE_MAX_BYTES, type: 'image/png' })).toBe(false)
    expect(needsFaceDetectImageCompression({ size: FACE_DETECT_IMAGE_MAX_BYTES + 1, type: 'image/jpeg' })).toBe(true)
    expect(needsFaceDetectImageCompression({ size: 1024, type: 'image/webp' })).toBe(true)
  })
})

describe('compressImageFileForFaceDetect', () => {
  const originalImage = globalThis.Image
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const realCreateElement = document.createElement.bind(document)
  const drawImage = vi.fn()
  const fillRect = vi.fn()
  const toBlob = vi.fn()
  let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: typeof toBlob }

  /** 触发图片加载完成并等待压缩流程推进。 */
  const loadImage = async (width: number, height: number) => {
    await Promise.resolve()
    const image = FakeImage.instances[0]
    image.width = width
    image.height = height
    image.onload?.()
  }

  beforeEach(() => {
    FakeImage.instances = []
    vi.stubGlobal('Image', FakeImage)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test-image') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    drawImage.mockReset()
    fillRect.mockReset()
    toBlob.mockReset()
    canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage, fillRect })),
      toBlob,
    }
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === 'canvas') return canvas as unknown as HTMLCanvasElement
      return realCreateElement(tagName, options)
    }) as typeof document.createElement)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if (createObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor)
    else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
    if (revokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor)
    else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
    globalThis.Image = originalImage
  })

  it('returns the original file when it is already within the limits', async () => {
    const file = new File(['ok'], 'face.jpg', { type: 'image/jpeg' })
    const result = compressImageFileForFaceDetect(file)
    await loadImage(1200, 800)

    await expect(result).resolves.toBe(file)
    expect(toBlob).not.toHaveBeenCalled()
  })

  it('downscales an oversized photo to 4096px JPEG under 3MB', async () => {
    const file = withSize(new File(['big'], 'IMG_0001.HEIC.png', { type: 'image/png' }), 9 * 1024 * 1024)
    toBlob.mockImplementation((cb: (blob: Blob | null) => void) => cb(new Blob([new Uint8Array(1024)])))
    const result = compressImageFileForFaceDetect(file)
    await loadImage(6000, 4000)

    const out = await result
    expect(out).not.toBe(file)
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('IMG_0001.HEIC.jpg')
    expect(out.size).toBe(1024)
    expect(canvas).toMatchObject({ width: 4096, height: 2731 })
    expect(drawImage).toHaveBeenCalledWith(FakeImage.instances[0], 0, 0, 4096, 2731)
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9)
  })

  it('lowers quality first, then shrinks the edge, until the blob fits', async () => {
    const file = withSize(new File(['big'], 'face.jpg', { type: 'image/jpeg' }), 5 * 1024 * 1024)
    const tooBig = { size: FACE_DETECT_IMAGE_MAX_BYTES + 1 } as Blob
    toBlob
      .mockImplementationOnce((cb: (blob: Blob | null) => void) => cb(tooBig))
      .mockImplementationOnce((cb: (blob: Blob | null) => void) => cb(tooBig))
      .mockImplementationOnce((cb: (blob: Blob | null) => void) => cb(tooBig))
      .mockImplementationOnce((cb: (blob: Blob | null) => void) => cb(new Blob([new Uint8Array(10)])))
    const result = compressImageFileForFaceDetect(file)
    await loadImage(3000, 3000)

    const out = await result
    expect(out.size).toBe(10)
    const qualities = toBlob.mock.calls.map((call) => Number(call[2]).toFixed(1))
    expect(qualities).toEqual(['0.9', '0.8', '0.7', '0.7'])
    expect(canvas).toMatchObject({ width: 2400, height: 2400 })
  })

  it('falls back to the original file when the browser cannot process the image', async () => {
    canvas.getContext.mockReturnValue(null)
    const noCanvas = withSize(new File(['big'], 'face.jpg', { type: 'image/jpeg' }), 5 * 1024 * 1024)
    const noCanvasResult = compressImageFileForFaceDetect(noCanvas)
    await loadImage(3000, 3000)
    await expect(noCanvasResult).resolves.toBe(noCanvas)

    FakeImage.instances = []
    const broken = withSize(new File(['bad'], 'bad.jpg', { type: 'image/jpeg' }), 5 * 1024 * 1024)
    const brokenResult = compressImageFileForFaceDetect(broken)
    await Promise.resolve()
    FakeImage.instances[0].onerror?.()
    await expect(brokenResult).resolves.toBe(broken)
  })
})
