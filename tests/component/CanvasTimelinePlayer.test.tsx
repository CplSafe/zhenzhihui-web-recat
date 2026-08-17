import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CanvasTimelinePlayer from '@/components/canvas/CanvasTimelinePlayer'
import { addTimelineClips, createTimelineClip, createTimelineState } from '@/utils/timelineClips'

// jsdom 没有实现播放控制，桩掉即可；本用例关注的是「切到哪一段、播放头到哪」而不是真实解码
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

const twoClips = addTimelineClips(createTimelineState(), [
  createTimelineClip({ id: 'clip-1', assetId: 101, sourceDurationSec: 10, inSec: 0, outSec: 5 }),
  createTimelineClip({ id: 'clip-2', assetId: 102, sourceDurationSec: 10, inSec: 2, outSec: 6 }),
]).clips

/** 取两个槽位的 video 元素（活动槽位带 aria-label，备用槽位 aria-hidden）。 */
function videos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll('video'))
}

/**
 * 时间读数「当前 / 总长」。
 * 当前时刻单独包了一层用于加重显示，所以按整段文本查不到，这里取容器的文本内容。
 */
function readout(): string {
  return (document.querySelector('[class*="time"]')?.textContent || '').replace(/\s+/g, ' ').trim()
}

describe('CanvasTimelinePlayer', () => {
  it('用两个 video 槽位承载相邻片段，下一段提前加载好', () => {
    render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} />)
    const [slotA, slotB] = videos()

    // 两个槽位同时存在：一个放当前段，另一个预载下一段——切换时才不会黑一帧
    expect(videos()).toHaveLength(2)
    expect(slotA.getAttribute('data-clip')).toBe('clip-1')
    expect(slotB.getAttribute('data-clip')).toBe('clip-2')
    // 同源 /download 地址，不是会过期的签名 URL
    expect(slotA.getAttribute('src')).toBe('/api/v1/assets/101/download?workspace_id=21')
    expect(slotB.getAttribute('src')).toBe('/api/v1/assets/102/download?workspace_id=21')
  })

  it('本段播完自动切到下一段，并把播放头推进到该段起点', () => {
    const onPlayheadChange = vi.fn()
    render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} onPlayheadChange={onPlayheadChange} />)
    const [slotA] = videos()

    // 第一段截取 0–5 秒：播到 5 秒即为本段结束
    Object.defineProperty(slotA, 'currentTime', { value: 5, writable: true, configurable: true })
    fireEvent.timeUpdate(slotA)

    // 第二段在成片时间轴上的起点是 5 秒
    expect(onPlayheadChange).toHaveBeenLastCalledWith(5)
    expect(readout()).toBe('00:05.0 / 00:09.0')
  })

  it('播放中途按片段实际截取区间推进播放头', async () => {
    const user = userEvent.setup()
    const onPlayheadChange = vi.fn()
    render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} onPlayheadChange={onPlayheadChange} />)

    // 必须先真的开始播：暂停态下的 timeupdate 只是 seek 的回声，播放器会忽略它
    await user.click(screen.getByRole('button', { name: '播放' }))
    const [slotA] = videos()

    Object.defineProperty(slotA, 'currentTime', { value: 2, writable: true, configurable: true })
    fireEvent.timeUpdate(slotA)
    expect(onPlayheadChange).toHaveBeenLastCalledWith(2)
  })

  it('点击轨道段落跳转到该段起点', async () => {
    const user = userEvent.setup()
    render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} />)

    await user.click(screen.getByRole('button', { name: '跳到片段 2' }))
    expect(readout()).toBe('00:05.0 / 00:09.0')
  })

  it('播放/暂停按钮切换状态', async () => {
    const user = userEvent.setup()
    render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} />)

    await user.click(screen.getByRole('button', { name: '播放' }))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '暂停' }))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  })

  it('总时长按各段截取区间累加，而不是源片总长', () => {
    render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} />)
    // 5 秒 + 4 秒 = 9 秒（两条源片各 10 秒）
    expect(readout()).toBe('00:00.0 / 00:09.0')
  })

  it('元数据就绪后强制 seek 一次，逼出首帧而不是停在纯黑', () => {
    render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} />)
    const [slotA, slotB] = videos()

    // 第一段截取自 0 秒：目标时刻与 currentTime 相等，按差值判断会跳过 seek，
    // 于是 video 停在 HAVE_METADATA（时长读得到）却一帧都没解码，画面纯黑。
    expect(slotA.currentTime).toBe(0)
    fireEvent.loadedMetadata(slotA)
    expect(slotA.currentTime).toBeGreaterThan(0)

    // 备用槽位同样要逼出首帧，否则切过去的瞬间会黑一下
    fireEvent.loadedMetadata(slotB)
    // 第二段截取自源片 2 秒起
    expect(slotB.currentTime).toBeGreaterThanOrEqual(2)
  })

  it('拖动轨道按位置定位，并把活动 video 实际 seek 过去', () => {
    const onPlayheadChange = vi.fn()
    const { container } = render(
      <CanvasTimelinePlayer clips={twoClips} workspaceId={21} onPlayheadChange={onPlayheadChange} />,
    )
    const scrub = container.querySelector('[class*="scrub"]') as HTMLElement
    const track = container.querySelector('[aria-label="时间线轨道"]') as HTMLElement
    // jsdom 不做布局，给轨道一个确定的几何尺寸才能换算位置
    // 宽度取 90：总时长 9 秒，正好 10px = 1 秒，位置换算不会带出浮点尾数
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 90 } as DOMRect)

    // 拖到 30px = 3 秒，仍落在第一段（截取 0–5 秒）内
    fireEvent.pointerDown(scrub, { clientX: 30, pointerId: 1 })
    expect(onPlayheadChange).toHaveBeenLastCalledWith(3)

    // 拖动过程中持续定位，而不是松手才跳一次
    fireEvent.pointerMove(scrub, { clientX: 40, pointerId: 1 })
    expect(onPlayheadChange).toHaveBeenLastCalledWith(4)

    // 关键：画面要真的跟过去——活动 video 的 currentTime 被设到该段内对应时刻
    expect(videos()[0].currentTime).toBeCloseTo(4, 3)

    fireEvent.pointerUp(scrub, { clientX: 40, pointerId: 1 })
  })

  it('拖动跨到下一段时改用已预载的槽位，不给当前槽位重设 src', () => {
    const { container } = render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} />)
    const scrub = container.querySelector('[class*="scrub"]') as HTMLElement
    const track = container.querySelector('[aria-label="时间线轨道"]') as HTMLElement
    // 宽度取 90：总时长 9 秒，正好 10px = 1 秒，位置换算不会带出浮点尾数
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 90 } as DOMRect)

    const [slotA, slotB] = videos()
    expect(slotA.getAttribute('data-clip')).toBe('clip-1')
    expect(slotB.getAttribute('data-clip')).toBe('clip-2')

    // 拖到 80px = 8 秒：落在第二段（成片 5–9 秒），它已经预载在备用槽位里
    fireEvent.pointerDown(scrub, { clientX: 80, pointerId: 1 })

    // 槽位分工不变——说明是换了显示哪一个，而不是给 slotA 重新设 src（那会黑一帧）
    expect(slotA.getAttribute('data-clip')).toBe('clip-1')
    expect(slotB.getAttribute('data-clip')).toBe('clip-2')
    // 第二段截取自源片 2 秒起，成片 8 秒 = 段内 3 秒 = 源片 5 秒
    expect(slotB.currentTime).toBeCloseTo(5, 3)
  })

  it('轨道按真实宽度渲染时间刻度与标签', () => {
    // 挂载时组件用 getBoundingClientRect 量轨道宽度；jsdom 不做布局，这里给一个确定值
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 600 } as DOMRect)
    const { container } = render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} />)

    // 总时长 9 秒 / 600px：主刻度取 1 秒档，0–9 共 10 条
    const majors = container.querySelectorAll('[class*="tickMajor"]')
    expect(majors.length).toBeGreaterThanOrEqual(9)
    // 标签跟着主刻度出现（0 秒不标，避免和左端重叠）
    const labels = Array.from(container.querySelectorAll('[class*="rulerLabel"]')).map((el) => el.textContent)
    expect(labels).toContain('00:05.0')
    expect(labels).not.toContain('00:00.0')
  })

  it('紧凑模式不渲染时间标签，只留刻度线', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 600 } as DOMRect)
    const { container } = render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} compact />)
    expect(container.querySelectorAll('[class*="tickMajor"]').length).toBeGreaterThan(0)
    expect(container.querySelector('[class*="rulerLabel"]')).toBeNull()
  })

  it('没有片段时给出接入引导且不渲染 video', () => {
    render(<CanvasTimelinePlayer clips={[]} workspaceId={21} />)
    expect(screen.getByText(/把画布上的视频拖进来/)).toBeInTheDocument()
    expect(videos()).toHaveLength(0)
  })

  it('提供 onAddClip 时轨道末尾出现「+」', async () => {
    const user = userEvent.setup()
    const onAddClip = vi.fn()
    render(<CanvasTimelinePlayer clips={twoClips} workspaceId={21} onAddClip={onAddClip} />)
    await user.click(screen.getByRole('button', { name: '添加视频' }))
    expect(onAddClip).toHaveBeenCalledTimes(1)
  })
})
