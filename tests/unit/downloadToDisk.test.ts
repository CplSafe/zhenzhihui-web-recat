import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  alignDownloadFileName,
  detectDownloadedMediaType,
  downloadToDisk,
  isWeChatBrowser,
} from '@/utils/downloadToDisk'

type WindowWithPicker = Window & { showSaveFilePicker?: unknown }

describe('downloadToDisk URL 防护', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    delete (window as WindowWithPicker).showSaveFilePicker
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('根据文件头保留 JPEG 的真实类型和扩展名', async () => {
    const blob = await new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
      headers: { 'content-type': 'image/png' },
    }).blob()

    const mediaType = await detectDownloadedMediaType(blob, 'image/png', 'image/png')

    expect(mediaType).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' })
    expect(alignDownloadFileName('AI图片.png', mediaType)).toBe('AI图片.jpg')
  })

  it.each([
    {
      name: 'WebP 图片',
      bytes: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      expected: { mimeType: 'image/webp', extension: 'webp' },
    },
    {
      name: 'MP4 视频',
      bytes: [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d],
      expected: { mimeType: 'video/mp4', extension: 'mp4' },
    },
  ])('根据文件头识别$name', async ({ bytes, expected }) => {
    const blob = await new Response(new Uint8Array(bytes), {
      headers: { 'content-type': 'application/octet-stream' },
    }).blob()

    await expect(detectDownloadedMediaType(blob, 'application/octet-stream')).resolves.toEqual(expected)
  })

  it('识别微信浏览器而不误判普通 Chromium', () => {
    expect(isWeChatBrowser('Mozilla/5.0 MicroMessenger/8.0.50')).toBe(true)
    expect(isWeChatBrowser('Mozilla/5.0 Chrome/150.0.0.0')).toBe(false)
  })

  it('微信浏览器直接打开原始 HTTP 媒体地址且不创建 Blob 空文件', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 MicroMessenger/8.0.50')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const clicked: Array<{ href: string; target: string; download: string }> = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, target: this.target, download: this.download })
    })

    await expect(
      downloadToDisk({
        fileName: '生成图片.png',
        mimeType: 'image/png',
        preserveResponseMediaType: true,
        resolveUrl: () => '/api/v1/assets/42/download?workspace_id=21',
      }),
    ).resolves.toBe('started')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(clicked).toEqual([
      {
        href: `${window.location.origin}/api/v1/assets/42/download?workspace_id=21`,
        target: '_blank',
        download: '',
      },
    ])
  })

  it('普通浏览器按真实图片格式命名并延迟释放 Blob', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome/150.0.0.0')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    )
    const createObjectURL = vi.fn().mockReturnValue('blob:download-image')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    let downloadedName = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download
    })

    await expect(
      downloadToDisk({
        fileName: '生成图片.png',
        mimeType: 'image/png',
        preserveResponseMediaType: true,
        resolveUrl: () => '/api/v1/assets/42/download?workspace_id=21',
      }),
    ).resolves.toBe('done')

    expect(downloadedName).toBe('生成图片.jpg')
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }))
    vi.advanceTimersByTime(4_000)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(56_000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download-image')
  })

  it('在 fetch 和 iframe 之前拒绝危险协议', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      downloadToDisk({
        fileName: '测试视频.mp4',
        resolveUrl: () => 'javascript:parent.alert(1)',
      }),
    ).rejects.toThrow('下载地址不安全')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('跨域 fetch 被 CORS 拦截时只报告已发起 iframe 下载', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const result = await downloadToDisk({
      fileName: '测试视频.mp4',
      resolveUrl: () => 'https://cdn.example.com/video.mp4',
    })

    expect(result).toBe('started')
    const iframe = document.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.src).toBe('https://cdn.example.com/video.mp4')
    expect(iframe?.referrerPolicy).toBe('no-referrer')

    vi.advanceTimersByTime(60_000)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('同源 fetch 失败时明确报错且不使用 iframe 掩盖错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')))

    await expect(
      downloadToDisk({
        fileName: '测试视频.mp4',
        resolveUrl: () => '/api/v1/assets/42/download',
      }),
    ).rejects.toThrow('视频下载失败')

    expect(document.querySelector('iframe')).toBeNull()
  })

  it('跨域 HTTP 错误不会伪装成 CORS 并进入 iframe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })))

    await expect(
      downloadToDisk({
        fileName: '测试视频.mp4',
        resolveUrl: () => 'https://cdn.example.com/forbidden.mp4',
      }),
    ).rejects.toThrow('视频下载失败')

    expect(document.querySelector('iframe')).toBeNull()
  })

  it('blob URL 获取失败时不会进入 iframe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Blob expired')))

    await expect(
      downloadToDisk({
        fileName: '测试视频.mp4',
        resolveUrl: () => `blob:${window.location.origin}/object-id`,
      }),
    ).rejects.toThrow('视频下载失败')

    expect(document.querySelector('iframe')).toBeNull()
  })

  it('正常同源视频仍可写入用户选择的文件', async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    ;(window as WindowWithPicker).showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue(writable),
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      downloadToDisk({
        fileName: '测试视频.mp4',
        resolveUrl: () => '/api/v1/assets/42/download',
      }),
    ).resolves.toBe('done')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/assets/42/download', { cache: 'no-store' })
    expect(writable.write).toHaveBeenCalledWith(expect.any(Blob))
    expect(writable.close).toHaveBeenCalledOnce()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('文件句柄写入失败时不会改走 iframe', async () => {
    const writable = {
      write: vi.fn().mockRejectedValue(new Error('Disk full')),
      close: vi.fn(),
    }
    ;(window as WindowWithPicker).showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue(writable),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
      ),
    )

    await expect(
      downloadToDisk({
        fileName: '测试视频.mp4',
        resolveUrl: () => 'https://cdn.example.com/video.mp4',
      }),
    ).rejects.toThrow('Disk full')

    expect(document.querySelector('iframe')).toBeNull()
  })

  it('用户取消文件选择时不会解析或请求下载地址', async () => {
    const resolveUrl = vi.fn(() => '/api/download')
    const pickerError = new Error('Cancelled')
    pickerError.name = 'AbortError'
    ;(window as WindowWithPicker).showSaveFilePicker = vi.fn().mockRejectedValue(pickerError)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadToDisk({ fileName: '测试视频.mp4', resolveUrl })).resolves.toBe('cancelled')
    expect(resolveUrl).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
