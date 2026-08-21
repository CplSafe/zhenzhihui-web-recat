import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_VIDEO_MAX_BYTES,
  extractImageFiles,
  extractMediaFiles,
  hasFileDrag,
  pickImageFiles,
  pickVideoFiles,
  readImageNaturalSize,
  snapImageRatio,
} from '@/utils/canvasLocalImage'

function imageFile(name = 'a.png', type = 'image/png'): File {
  return new File(['x'], name, { type })
}

function videoFile(name = 'a.mp4', type = 'video/mp4'): File {
  return new File(['x'], name, { type })
}

/** 构造最小可用的 DataTransfer 替身（jsdom 不提供构造函数） */
function dataTransfer(init: {
  files?: File[]
  items?: Array<{ kind: string; file: File | null }>
  types?: string[]
}): DataTransfer {
  return {
    files: init.files || [],
    items: (init.items || []).map((item) => ({ kind: item.kind, getAsFile: () => item.file })),
    types: init.types || [],
  } as unknown as DataTransfer
}

describe('canvas local image import helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps only image files and tolerates holes in the list', () => {
    const png = imageFile()
    const picked = pickImageFiles([png, new File(['x'], 'a.mp4', { type: 'video/mp4' }), null])
    expect(picked).toEqual([png])
    expect(pickImageFiles(null)).toEqual([])
  })

  it('falls back to clipboard items when a pasted screenshot exposes no files', () => {
    const shot = imageFile('screenshot.png')
    const fromItems = extractImageFiles(
      dataTransfer({
        items: [
          { kind: 'string', file: null },
          { kind: 'file', file: shot },
        ],
      }),
    )
    expect(fromItems).toEqual([shot])
    expect(extractImageFiles(null)).toEqual([])
  })

  it('prefers the dropped file list when both files and items are present', () => {
    const dropped = imageFile('dropped.png')
    const other = imageFile('other.png')
    expect(extractImageFiles(dataTransfer({ files: [dropped], items: [{ kind: 'file', file: other }] }))).toEqual([
      dropped,
    ])
  })

  it('keeps only video files', () => {
    const mp4 = videoFile()
    expect(pickVideoFiles([mp4, imageFile(), null])).toEqual([mp4])
    expect(pickVideoFiles(null)).toEqual([])
  })

  it('extracts images and videos together so a pasted video is not dropped', () => {
    const png = imageFile()
    const mp4 = videoFile()
    expect(extractMediaFiles(dataTransfer({ files: [png, mp4] }))).toEqual({ images: [png], videos: [mp4] })
    expect(extractMediaFiles(null)).toEqual({ images: [], videos: [] })
  })

  it('does not fall through to items when the file list holds only a video', () => {
    // 只看图片判断「files 是否为空」会在这里误判：复制单个视频时 files 非空但图片为空，
    // 一旦落到 items 分支就会拿到重复或错误的文件
    const dropped = videoFile('dropped.mp4')
    const other = videoFile('other.mp4')
    expect(extractMediaFiles(dataTransfer({ files: [dropped], items: [{ kind: 'file', file: other }] }))).toEqual({
      images: [],
      videos: [dropped],
    })
  })

  it('falls back to clipboard items for videos as well as images', () => {
    const mp4 = videoFile('clip.mp4')
    expect(
      extractMediaFiles(
        dataTransfer({
          items: [
            { kind: 'string', file: null },
            { kind: 'file', file: mp4 },
          ],
        }),
      ),
    ).toEqual({ images: [], videos: [mp4] })
  })

  it('caps a single local video at the same 512MB budget the timeline compositor uses', () => {
    expect(LOCAL_VIDEO_MAX_BYTES).toBe(512 * 1024 * 1024)
  })

  it('only reports a file drag when the payload actually carries files', () => {
    expect(hasFileDrag(dataTransfer({ types: ['Files'] }))).toBe(true)
    expect(hasFileDrag(dataTransfer({ types: ['text/plain'] }))).toBe(false)
    expect(hasFileDrag(null)).toBe(false)
  })

  it('snaps natural sizes to the ratios the node panel offers', () => {
    expect(snapImageRatio(1920, 1080)).toBe('16:9')
    expect(snapImageRatio(1080, 1920)).toBe('9:16')
    expect(snapImageRatio(800, 800)).toBe('1:1')
    expect(snapImageRatio(1000, 750)).toBe('4:3')
    expect(snapImageRatio(800, 1200)).toBe('2:3')
  })

  it('falls back to 1:1 for unusable dimensions', () => {
    expect(snapImageRatio(0, 100)).toBe('1:1')
    expect(snapImageRatio(Number.NaN, 100)).toBe('1:1')
  })

  it('reads the natural size and always releases the temporary object url', async () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:preview', revokeObjectURL })
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 1024
        naturalHeight = 768
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_value: string) {
          this.onload?.()
        }
      },
    )
    await expect(readImageNaturalSize(imageFile())).resolves.toEqual({ width: 1024, height: 768 })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('resolves null when the file cannot be decoded', async () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:broken', revokeObjectURL: vi.fn() })
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 0
        naturalHeight = 0
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_value: string) {
          this.onerror?.()
        }
      },
    )
    await expect(readImageNaturalSize(imageFile('broken.png'))).resolves.toBeNull()
  })
})
