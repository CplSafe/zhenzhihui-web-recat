import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileToDataUrl } from '@/utils/imageFile'

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

describe('fileToDataUrl', () => {
  const originalImage = globalThis.Image
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const realCreateElement = document.createElement.bind(document)
  const drawImage = vi.fn()
  const toDataURL = vi.fn()
  let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toDataURL: typeof toDataURL }

  beforeEach(() => {
    FakeImage.instances = []
    vi.stubGlobal('Image', FakeImage)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test-image') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    drawImage.mockReset()
    toDataURL.mockReset().mockReturnValue('data:image/jpeg;base64,scaled')
    canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toDataURL,
    }
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === 'canvas') return canvas as unknown as HTMLCanvasElement
      return realCreateElement(tagName, options)
    }) as typeof document.createElement)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (createObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor)
    else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
    if (revokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor)
    else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
    globalThis.Image = originalImage
  })

  it('downscales a large image without changing its aspect ratio', async () => {
    const file = new File(['image'], 'large.png', { type: 'image/png' })
    const result = fileToDataUrl(file, 1280, 0.8)
    const image = FakeImage.instances[0]
    image.width = 2000
    image.height = 1000
    image.onload?.()

    await expect(result).resolves.toBe('data:image/jpeg;base64,scaled')
    expect(URL.createObjectURL).toHaveBeenCalledWith(file)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image')
    expect(canvas).toMatchObject({ width: 1280, height: 640 })
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 1280, 640)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8)
  })

  it('does not upscale a small image and clamps zero-sized output to one pixel', async () => {
    const normal = fileToDataUrl(new File(['a'], 'small.png'), 1280)
    const first = FakeImage.instances[0]
    first.width = 100
    first.height = 50
    first.onload?.()
    await normal
    expect(canvas).toMatchObject({ width: 100, height: 50 })

    const zero = fileToDataUrl(new File(['b'], 'zero.png'), 1280)
    const second = FakeImage.instances[1]
    second.width = 0
    second.height = 0
    second.onload?.()
    await zero
    expect(canvas).toMatchObject({ width: 1, height: 1 })
  })

  it('rejects when the image cannot be decoded', async () => {
    const result = fileToDataUrl(new File(['bad'], 'bad.png'))
    FakeImage.instances[0].onerror?.()

    await expect(result).rejects.toThrow('图片读取失败')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image')
  })

  it('rejects when a canvas context is unavailable', async () => {
    canvas.getContext.mockReturnValue(null)
    const result = fileToDataUrl(new File(['image'], 'image.png'))
    const image = FakeImage.instances[0]
    image.width = 20
    image.height = 20
    image.onload?.()

    await expect(result).rejects.toThrow('无法处理图片')
  })

  it('propagates data URL encoding failures', async () => {
    toDataURL.mockImplementation(() => {
      throw new Error('canvas is tainted')
    })
    const result = fileToDataUrl(new File(['image'], 'image.png'))
    const image = FakeImage.instances[0]
    image.width = 20
    image.height = 20
    image.onload?.()

    await expect(result).rejects.toThrow('canvas is tainted')
  })
})
