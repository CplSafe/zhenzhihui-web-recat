import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPaddedCanvasImageFile, getCanvasImagePadding } from '@/utils/canvasImagePadding'
import { isSupportedVideoReferenceImageAspectRatio } from '@/utils/imageFile'

describe('getCanvasImagePadding', () => {
  it.each([
    { width: 2048, height: 768, output: [2048, 820, 0, 0, 26, 26] },
    { width: 768, height: 2048, output: [820, 2048, 26, 26, 0, 0] },
    { width: 251, height: 100, output: [251, 101, 0, 0, 0, 1] },
    { width: 100, height: 251, output: [101, 251, 0, 1, 0, 0] },
    { width: 250, height: 100, output: [250, 100, 0, 0, 0, 0] },
    { width: 100, height: 250, output: [100, 250, 0, 0, 0, 0] },
    { width: 249, height: 100, output: [249, 100, 0, 0, 0, 0] },
    { width: 100, height: 249, output: [100, 249, 0, 0, 0, 0] },
  ])('produces a valid, centered result for $width × $height', ({ width, height, output }) => {
    const layout = getCanvasImagePadding({ width, height })
    expect([layout.width, layout.height, layout.left, layout.right, layout.top, layout.bottom]).toEqual(output)
    expect(isSupportedVideoReferenceImageAspectRatio(layout)).toBe(true)
  })

  it.each([0, Number.NaN, Infinity, -1, 1.25])('rejects an invalid dimension %s', (width) => {
    expect(() => getCanvasImagePadding({ width, height: 100 })).toThrow('原图尺寸无效')
  })
})

describe('createPaddedCanvasImageFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  function mockCanvas(width: number, height: number) {
    const image = { width, height, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(image))
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
    return { image, context, getContext, toBlob }
  }

  it.each([
    [
      2048,
      768,
      [
        [0, 0, 2048, 26],
        [0, 794, 2048, 26],
      ],
      [0, 26],
    ],
    [
      768,
      2048,
      [
        [0, 0, 26, 2048],
        [794, 0, 26, 2048],
      ],
      [26, 0],
    ],
  ] as const)(
    'fills only the new bands for %i × %i and draws the source unscaled',
    async (width, height, bands, offset) => {
      const { image, context, toBlob } = mockCanvas(width, height)
      const result = await createPaddedCanvasImageFile(new Blob(), '原图.jpg', new AbortController().signal)

      expect(context.fillStyle).toBe('#fff')
      expect(context.fillRect.mock.calls).toEqual(bands)
      expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(image, ...offset)
      expect(result.originalSize).toEqual({ width, height })
      expect(result.file.name).toBe('原图-补边.png')
      expect(result.file.type).toBe('image/png')
      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
      expect(image.close).toHaveBeenCalledOnce()
    },
  )

  it('leaves the original material available when the padded output cannot be encoded', async () => {
    const { image, toBlob } = mockCanvas(2048, 768)
    toBlob.mockImplementation((callback) => callback(null))

    await expect(createPaddedCanvasImageFile(new Blob(), '原图', new AbortController().signal)).rejects.toThrow(
      '无法导出补边图',
    )
    expect(image.close).toHaveBeenCalledOnce()
  })

  it('stops before encoding when the bitmap exceeds the browser buffer budget', async () => {
    const { image, getContext } = mockCanvas(30000, 1000)

    await expect(createPaddedCanvasImageFile(new Blob(), '原图', new AbortController().signal)).rejects.toThrow(
      '原图分辨率过大',
    )
    expect(getContext).not.toHaveBeenCalled()
    expect(image.close).toHaveBeenCalledOnce()
  })
})
