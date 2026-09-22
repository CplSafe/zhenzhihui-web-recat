import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VIDEO_REFERENCE_IMAGE_MAX_DIMENSION,
  normalizeImageFileForAiInput,
  videoReferenceImageIssue,
} from '@/utils/imageFile'

class FakeImage {
  static instances: FakeImage[] = []

  width = 0
  height = 0
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''

  constructor() {
    FakeImage.instances.push(this)
  }
}

describe('videoReferenceImageIssue', () => {
  it('合规图片返回空串', () => {
    expect(videoReferenceImageIssue({ width: 1080, height: 1920 })).toBe('')
    expect(videoReferenceImageIssue({ width: 5760, height: 2304 })).toBe('')
  })

  it('像素范围优先于宽高比，文案带具体数值', () => {
    expect(videoReferenceImageIssue({ width: 200, height: 1000 })).toBe(
      '图片尺寸为 200×1000px，宽和高均需在 256–5760px 之间',
    )
  })

  it('宽高比越界（供应商原文 media aspect ratio must be between 0.4 and 2.5）在本地就能拦下', () => {
    expect(videoReferenceImageIssue({ width: 300, height: 1000 })).toBe(
      '图片宽高比为 0.30（300×1000px），需在 0.4–2.5 之间，请裁掉过长的一边后重试',
    )
    expect(videoReferenceImageIssue({ width: 3000, height: 1000 })).toContain('宽高比为 3.00')
  })
})

describe('normalizeImageFileForAiInput', () => {
  const originalImage = globalThis.Image
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const realCreateElement = document.createElement.bind(document)
  const drawImage = vi.fn()
  const fillRect = vi.fn()
  const toBlob = vi.fn()
  let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: typeof toBlob }

  /** 触发图片加载完成并等待流程推进。 */
  const loadImage = async (width: number, height: number) => {
    await Promise.resolve()
    const image = FakeImage.instances[0]
    image.width = width
    image.height = height
    image.naturalWidth = width
    image.naturalHeight = height
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

  it('合规图片原样返回，不走 canvas', async () => {
    const file = new File(['ok'], 'ref.jpg', { type: 'image/jpeg' })
    const result = normalizeImageFileForAiInput(file, { checkAspectRatio: true })
    await loadImage(1920, 1080)

    await expect(result).resolves.toBe(file)
    expect(toBlob).not.toHaveBeenCalled()
  })

  it('任一边小于 256px 直接拒绝并给中文原因', async () => {
    const file = new File(['tiny'], 'tiny.png', { type: 'image/png' })
    const result = normalizeImageFileForAiInput(file)
    await loadImage(200, 800)

    await expect(result).rejects.toThrow('图片尺寸为 200×800px，宽和高均需在 256–5760px 之间')
  })

  it('只有视频类入口才校验宽高比', async () => {
    const tall = new File(['tall'], 'tall.png', { type: 'image/png' })
    const rejected = normalizeImageFileForAiInput(tall, { checkAspectRatio: true })
    await loadImage(300, 1000)
    await expect(rejected).rejects.toThrow('图片宽高比为 0.30（300×1000px），需在 0.4–2.5 之间')

    FakeImage.instances = []
    const accepted = normalizeImageFileForAiInput(tall)
    await loadImage(300, 1000)
    await expect(accepted).resolves.toBe(tall)
  })

  it('超过 5760px 的图等比缩到上限以内，PNG 仍保持 PNG（不铺白底）', async () => {
    toBlob.mockImplementation((cb: (blob: Blob | null) => void) => cb(new Blob([new Uint8Array(16)])))
    const file = new File(['huge'], 'poster.png', { type: 'image/png', lastModified: 123 })
    const result = normalizeImageFileForAiInput(file)
    await loadImage(8000, 4000)

    const normalized = await result
    expect(normalized).not.toBe(file)
    expect(normalized.type).toBe('image/png')
    expect(normalized.name).toBe('poster.png')
    expect(canvas).toMatchObject({ width: VIDEO_REFERENCE_IMAGE_MAX_DIMENSION, height: 2880 })
    expect(fillRect).not.toHaveBeenCalled()
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined)
  })

  it('超大 JPEG 缩放后仍是 JPEG，浏览器解不开时原样放行交给后端报错', async () => {
    toBlob.mockImplementation((cb: (blob: Blob | null) => void) => cb(new Blob([new Uint8Array(16)])))
    const file = new File(['huge'], 'IMG_0001.jpeg', { type: 'image/jpeg' })
    const result = normalizeImageFileForAiInput(file)
    await loadImage(6000, 9000)
    const normalized = await result
    expect(normalized.type).toBe('image/jpeg')
    expect(normalized.name).toBe('IMG_0001.jpg')
    expect(canvas).toMatchObject({ width: 3840, height: VIDEO_REFERENCE_IMAGE_MAX_DIMENSION })

    FakeImage.instances = []
    const broken = new File(['x'], 'broken.jpg', { type: 'image/jpeg' })
    const passthrough = normalizeImageFileForAiInput(broken)
    await Promise.resolve()
    FakeImage.instances[0].onerror?.()
    await expect(passthrough).resolves.toBe(broken)
  })
})
