import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasTimelineNodeBody from '@/components/canvas/CanvasTimelineNodeBody'
import type { CanvasTimelineSource } from '@/components/canvas/CanvasTimelineNodeActions'
import { MAX_TIMELINE_CLIPS, createTimelineClip, type TimelineClip } from '@/utils/timelineClips'

const SOURCES: CanvasTimelineSource[] = [
  { nodeId: 'video-1', assetId: 11, label: '画布视频 1', thumbnailUrl: '/a.mp4' },
  { nodeId: 'video-2', assetId: 12, label: '画布视频 2', thumbnailUrl: '' },
]

function clip(id: string, assetId: number, outSec: number): TimelineClip {
  return createTimelineClip({ id, assetId, sourceDurationSec: outSec, inSec: 0, outSec })
}

function setup(overrides: Partial<React.ComponentProps<typeof CanvasTimelineNodeBody>> = {}) {
  const props = {
    nodeId: 'timeline-1',
    clips: [clip('clip-1', 101, 30), clip('clip-2', 102, 10.2)],
    workspaceId: 21,
    onRemoveClip: vi.fn(),
    getAddableSources: vi.fn(() => SOURCES),
    onAddSource: vi.fn(),
    ...overrides,
  }
  render(<CanvasTimelineNodeBody {...props} />)
  return props
}

describe('CanvasTimelineNodeBody', () => {
  it('卡片上直接展示片段与总时长，不必先双击进弹窗', () => {
    setup()
    // 片段就是时间轴上的块，不再另起一行胶囊重复一遍同样的信息
    const track = screen.getByLabelText('时间线轨道')
    expect(within(track).getByText('30.0s')).toBeInTheDocument()
    expect(within(track).getByText('10.2s')).toBeInTheDocument()
    // 时间读数把当前时刻单独包了一层用于加重，按整段文本查不到，取容器文本
    expect(document.querySelector('[class*="time"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '00:00.0 / 00:40.2',
    )
  })

  it('片段可以就地移除，移除按钮长在片段块上', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByRole('button', { name: '移除片段 2' }))
    expect(props.onRemoveClip).toHaveBeenCalledWith('timeline-1', 'clip-2')
  })

  it('空时间线给出「拖进来或点 +」的引导', () => {
    setup({ clips: [] })
    expect(screen.getByText(/把画布上的视频拖进来/)).toBeInTheDocument()
    expect(screen.queryByLabelText('时间线轨道')).not.toBeInTheDocument()
    // 空态也要能起步：居中的「+」就是入口
    expect(screen.getByRole('button', { name: '添加视频' })).toBeInTheDocument()
  })

  it('轨道末尾的「+」点开才取列表，选中后交回来源节点 id', async () => {
    const user = userEvent.setup()
    const props = setup()

    expect(props.getAddableSources).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '添加视频' }))
    expect(props.getAddableSources).toHaveBeenCalledWith('timeline-1')

    const menu = screen.getByRole('menu', { name: '画布上的视频' })
    await user.click(within(menu).getByRole('menuitem', { name: /画布视频 2/ }))
    expect(props.onAddSource).toHaveBeenCalledWith('timeline-1', 'video-2')
    // 选完即收起，不挡住轨道
    expect(screen.queryByRole('menu', { name: '画布上的视频' })).not.toBeInTheDocument()
  })

  it('画布上没有可加入的视频时给出说明而不是空白菜单', async () => {
    const user = userEvent.setup()
    setup({ getAddableSources: vi.fn(() => []) })
    await user.click(screen.getByRole('button', { name: '添加视频' }))
    expect(screen.getByText(/画布上没有可加入的视频/)).toBeInTheDocument()
  })

  it('片段数达上限时不再提供添加入口', () => {
    setup({ clips: Array.from({ length: MAX_TIMELINE_CLIPS }, (_, i) => clip(`clip-${i + 1}`, i + 1, 2)) })
    expect(screen.queryByRole('button', { name: '添加视频' })).not.toBeInTheDocument()
  })

  it('连线来源未就绪时如实说明', () => {
    setup({ pendingSourceCount: 2 })
    expect(screen.getByText(/2 个连入的视频还在生成/)).toBeInTheDocument()
  })

  it('已合成时预览直接放成片，而不是逐段拼的预览', () => {
    setup({ composedUrl: '/composed.mp4' })
    expect(document.querySelector('video[src="/composed.mp4"]')).not.toBeNull()
    // 成片就是下游节点消费的那份素材，此时不再渲染分段播放器
    expect(screen.queryByLabelText('时间线轨道')).not.toBeInTheDocument()
  })
})
