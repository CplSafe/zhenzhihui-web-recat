import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import SeekableVideo from '@/components/common/SeekableVideo'
import { clearSeekableSourceCache } from '@/utils/seekableMediaSource'

const REMOTE = '/api/v1/assets/55/download?workspace_id=2'

let created = 0
let hits = 0

beforeEach(() => {
  created = 0
  hits = 0
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:local-${++created}`),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  server.use(
    http.get('/api/v1/assets/55/download', () => {
      hits += 1
      return HttpResponse.arrayBuffer(new Uint8Array(8).buffer, { headers: { 'Content-Type': 'video/mp4' } })
    }),
  )
})

afterEach(() => {
  clearSeekableSourceCache()
})

/** jsdom 的 currentTime/duration 是只读桩，用例要自己铺设这些值。 */
function setMediaState(video: HTMLVideoElement, values: { currentTime?: number; duration?: number }) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(video, key, { value, writable: true, configurable: true })
  }
}

/**
 * 铺设 seekable。
 * endSec 为 0 表示「一段可跳转范围都没有」——不支持 Range 的源就是这样。
 */
function setSeekable(video: HTMLVideoElement, endSec: number) {
  Object.defineProperty(video, 'seekable', {
    configurable: true,
    value: { length: endSec > 0 ? 1 : 0, start: () => 0, end: () => endSec },
  })
}

/** 拖动进度条到 target，但源不支持 Range，播放位置被抹回 landed。 */
function simulateSeek(video: HTMLVideoElement, target: number, landed: number) {
  setMediaState(video, { currentTime: target })
  fireEvent.seeking(video)
  setMediaState(video, { currentTime: landed })
  fireEvent.seeked(video)
}

/** 默认铺成「支持 Range」的源：可跳转范围覆盖整片。 */
function renderVideo(props: Record<string, unknown> = {}, seekableEndSec = 30) {
  render(<SeekableVideo src={REMOTE} data-testid="player" {...props} />)
  const video = screen.getByTestId('player') as HTMLVideoElement
  setMediaState(video, { currentTime: 0, duration: 30 })
  setSeekable(video, seekableEndSec)
  return video
}

describe('SeekableVideo', () => {
  it('先用远程地址播；源支持 Range 时始终不下载', async () => {
    const video = renderVideo()
    expect(video.getAttribute('src')).toBe(REMOTE)
    fireEvent.loadedMetadata(video)
    // 探测有延时，等过了判定点再确认确实没动手
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(hits).toBe(0)
    expect(video.getAttribute('src')).toBe(REMOTE)
  })

  it('源不可跳转时，元数据一到就先备好本地副本，不等用户拖了才修', async () => {
    // 等拖了再修的话第一次拖动必然是废的：浏览器已经把目标钳成别的值，
    // 我们连用户想去哪都不知道
    const video = renderVideo({}, 0)
    fireEvent.loadedMetadata(video)

    await waitFor(() => expect(video.getAttribute('src')).toBe('blob:local-1'), { timeout: 2000 })
    expect(hits).toBe(1)
  })

  it('跳转落住时不下载——服务端支持分段请求就该零成本', async () => {
    const video = renderVideo()
    simulateSeek(video, 8, 8)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hits).toBe(0)
    expect(video.getAttribute('src')).toBe(REMOTE)
  })

  it('源报不出可跳转范围时，一拖就换本地副本，不等「跳转失败」被观察到', async () => {
    // 浏览器会先把目标钳进 seekable 再报 seeking：拖到 14 秒但只有 0~1 秒可跳时，
    // seeking 里读到的已经是 1 秒，事后比对永远看不出失败——只能靠 seekable 本身判断
    const video = renderVideo({}, 0)
    simulateSeek(video, 1, 1)

    await waitFor(() => expect(video.getAttribute('src')).toBe('blob:local-1'))
    expect(hits).toBe(1)
  })

  it('seekable 看着正常但跳转仍被抹回时，兜底判定照样生效', async () => {
    const video = renderVideo()
    simulateSeek(video, 8, 0)

    await waitFor(() => expect(video.getAttribute('src')).toBe('blob:local-1'))
    expect(hits).toBe(1)

    // 换源会重新触发一次元数据事件：这时把播放位置补回 8 秒
    setMediaState(video, { currentTime: 0, duration: 30 })
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(8)
  })

  it('准备期间给出进度提示，完成后收起', async () => {
    const video = renderVideo()
    simulateSeek(video, 8, 0)

    expect(await screen.findByRole('status')).toHaveTextContent('正在准备可跳转的视频')
    await waitFor(() => expect(video.getAttribute('src')).toBe('blob:local-1'))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('quiet 时不显示提示浮层', async () => {
    const video = renderVideo({ quiet: true })
    simulateSeek(video, 8, 0)
    await waitFor(() => expect(video.getAttribute('src')).toBe('blob:local-1'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('元数据到手却读不出时长时直接抓：这种源既看不到总时长也跳不了', async () => {
    const video = renderVideo()
    setMediaState(video, { duration: NaN })
    fireEvent.loadedMetadata(video)
    await waitFor(() => expect(video.getAttribute('src')).toBe('blob:local-1'))
  })

  it('可跳转的源上，接近开头的跳转不作为判据，避免误判触发整片下载', async () => {
    const video = renderVideo()
    simulateSeek(video, 0.3, 0)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hits).toBe(0)
  })

  it('抓取失败时保持原地址，播放不受影响', async () => {
    server.use(http.get('/api/v1/assets/55/download', () => new HttpResponse(null, { status: 500 })))
    const video = renderVideo()
    simulateSeek(video, 8, 0)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(video.getAttribute('src')).toBe(REMOTE)
  })

  it('原生事件回调照常透传给调用方', async () => {
    const onSeeked = vi.fn()
    const onLoadedMetadata = vi.fn()
    render(<SeekableVideo src={REMOTE} data-testid="player" onSeeked={onSeeked} onLoadedMetadata={onLoadedMetadata} />)
    const video = screen.getByTestId('player') as HTMLVideoElement
    setMediaState(video, { currentTime: 0, duration: 30 })

    fireEvent.loadedMetadata(video)
    simulateSeek(video, 8, 8)
    expect(onLoadedMetadata).toHaveBeenCalled()
    expect(onSeeked).toHaveBeenCalled()
  })
})
