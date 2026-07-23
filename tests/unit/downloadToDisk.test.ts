import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadToDisk } from '@/utils/downloadToDisk'

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
    document.body.innerHTML = ''
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
