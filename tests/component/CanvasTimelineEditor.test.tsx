import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import CanvasTimelineEditor from '@/components/canvas/CanvasTimelineEditor'
import {
  MAX_TIMELINE_CLIPS,
  addTimelineClips,
  createTimelineClip,
  createTimelineState,
  type TimelineState,
} from '@/utils/timelineClips'

function baseState(): TimelineState {
  return addTimelineClips(createTimelineState(), [
    createTimelineClip({ id: 'clip-1', assetId: 101, sourceDurationSec: 10, inSec: 0, outSec: 5 }),
    createTimelineClip({ id: 'clip-2', assetId: 102, sourceDurationSec: 10, inSec: 0, outSec: 4 }),
  ])
}

/** 受控壳：编辑器的每次 onChange 都写回，才能连续操作。 */
function ControlledEditor(props: {
  initial?: TimelineState
  onCompose?: () => void
  onAddClip?: (sourceNodeId: string) => void
  addableSources?: Array<{ nodeId: string; assetId: number; label: string; thumbnailUrl: string }>
  pendingSourceCount?: number
  composing?: boolean
  composeProgress?: string
  composeDisabledReason?: string
  onState?: (state: TimelineState) => void
}) {
  const [state, setState] = useState<TimelineState>(props.initial ?? baseState())
  return (
    <CanvasTimelineEditor
      open
      workspaceId={21}
      state={state}
      onChange={(next) => {
        setState(next)
        props.onState?.(next)
      }}
      onClose={vi.fn()}
      pendingSourceCount={props.pendingSourceCount ?? 0}
      addableSources={props.addableSources ?? []}
      composing={props.composing ?? false}
      composeProgress={props.composeProgress ?? ''}
      {...(props.onCompose ? { onCompose: props.onCompose } : {})}
      {...(props.onAddClip ? { onAddClip: props.onAddClip } : {})}
      {...(props.composeDisabledReason ? { composeDisabledReason: props.composeDisabledReason } : {})}
    />
  )
}

/** 末次 onChange 交回的状态。编译目标未开 ES2022，用下标取而不是 Array.prototype.at。 */
function lastState(onState: ReturnType<typeof vi.fn>): TimelineState {
  const calls = onState.mock.calls
  return calls[calls.length - 1]?.[0] as TimelineState
}

describe('CanvasTimelineEditor', () => {
  it('展示片段数与总时长，关闭时不渲染', () => {
    const { rerender } = render(<ControlledEditor />)
    expect(screen.getByText('2 段 · 共 00:09.0')).toBeInTheDocument()
    expect(within(screen.getByLabelText('片段列表')).getAllByRole('listitem')).toHaveLength(2)

    rerender(
      <CanvasTimelineEditor open={false} workspaceId={21} state={baseState()} onChange={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.queryByRole('dialog', { name: '视频剪辑' })).not.toBeInTheDocument()
  })

  it('点片段即选中，右侧属性面板显示它的裁剪区间', async () => {
    const user = userEvent.setup()
    render(<ControlledEditor />)

    const inspector = screen.getByLabelText('片段属性')
    expect(within(inspector).getByText(/在下方轨道上点一个片段/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '片段 2' }))
    expect(within(inspector).getByText('片段 2')).toBeInTheDocument()
    expect(screen.getByLabelText('终点')).toHaveValue(4)
  })

  it('前移/后移按钮调整片段顺序，首尾按钮相应禁用', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<ControlledEditor onState={onState} />)

    await user.click(screen.getByRole('button', { name: '片段 1' }))
    expect(screen.getByRole('button', { name: '片段 1 前移' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '片段 2' }))
    expect(screen.getByRole('button', { name: '片段 2 后移' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '片段 2 前移' }))
    expect(lastState(onState).clips.map((clip) => clip.id)).toEqual(['clip-2', 'clip-1'])
  })

  it('工具条删除选中片段，总时长同步变化', async () => {
    const user = userEvent.setup()
    render(<ControlledEditor />)

    await user.click(screen.getByRole('button', { name: '片段 2' }))
    await user.click(screen.getByRole('button', { name: /删除/ }))
    expect(screen.getByText('1 段 · 共 00:05.0')).toBeInTheDocument()
  })

  it('静音按钮反映并切换选中片段的静音态', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<ControlledEditor onState={onState} />)

    await user.click(screen.getByRole('button', { name: '片段 1' }))
    const mute = screen.getByRole('button', { name: /静音/ })
    expect(mute).toHaveAttribute('aria-pressed', 'false')

    await user.click(mute)
    expect(lastState(onState).clips[0]).toMatchObject({ muted: true })
    expect(screen.getByRole('button', { name: /取消静音/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('复制片段：副本紧跟原段插入', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<ControlledEditor onState={onState} />)

    await user.click(screen.getByRole('button', { name: '片段 1' }))
    await user.click(screen.getByRole('button', { name: /复制/ }))
    expect(lastState(onState).clips.map((clip) => clip.id)).toEqual(['clip-1', 'clip-3', 'clip-2'])
    expect(screen.getByText('3 段 · 共 00:14.0')).toBeInTheDocument()
  })

  it('播放头移到片段中间后才能分割，分割点落在播放头上', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<ControlledEditor onState={onState} />)

    // 播放头在 0：分割会切出一个零长度的片段，按钮必须是禁用的
    expect(screen.getByRole('button', { name: /分割/ })).toBeDisabled()

    // 方向键把播放头推到 2 秒——拖动在 jsdom 里不可达，这是同一件事的键盘通道
    await user.keyboard('{ArrowRight>20/}')
    await user.click(screen.getByRole('button', { name: /分割/ }))

    const clips = lastState(onState).clips
    expect(clips).toHaveLength(3)
    expect(clips[0]).toMatchObject({ inSec: 0, outSec: 2 })
    expect(clips[1]).toMatchObject({ inSec: 2, outSec: 5 })
  })

  it('裁剪手柄支持方向键微调，且不会顺带挪动播放头', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<ControlledEditor onState={onState} />)

    screen.getByRole('button', { name: '片段 1 起点手柄' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(lastState(onState).clips[0].inSec).toBeCloseTo(0.1, 5)

    screen.getByRole('button', { name: '片段 1 终点手柄' }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(lastState(onState).clips[0].outSec).toBeCloseTo(4.9, 5)

    // 播放头没被这两次按键带走，分割按钮仍然是禁用的（播放头还停在 0）
    expect(screen.getByRole('button', { name: /分割/ })).toBeDisabled()
  })

  it('选中片段后可用起点/终点输入裁剪，并被约束在源片范围内', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<ControlledEditor onState={onState} />)

    await user.click(screen.getByRole('button', { name: '片段 1' }))
    const endInput = screen.getByLabelText('终点')
    await user.clear(endInput)
    await user.type(endInput, '99')

    // 源片只有 10 秒：终点被收敛到 10，而不是照单全收
    expect(lastState(onState).clips[0].outSec).toBeLessThanOrEqual(10)
  })

  it('撤销/重做回到上一步，无历史时禁用', async () => {
    const user = userEvent.setup()
    render(<ControlledEditor />)

    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '片段 2' }))
    await user.click(screen.getByRole('button', { name: /删除/ }))
    expect(screen.getByText('1 段 · 共 00:05.0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByText('2 段 · 共 00:09.0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重做' }))
    expect(screen.getByText('1 段 · 共 00:05.0')).toBeInTheDocument()
  })

  it('合成按钮在引擎不可用时禁用并说明原因', () => {
    render(<ControlledEditor composeDisabledReason="合成引擎尚未接入" onCompose={vi.fn()} />)
    const compose = screen.getByRole('button', { name: '合成为一条视频' })
    expect(compose).toBeDisabled()
    expect(compose).toHaveAttribute('title', '合成引擎尚未接入')
  })

  it('片段不足时给出校验提示且不允许合成', () => {
    const single = addTimelineClips(createTimelineState(), [
      createTimelineClip({ id: 'clip-1', assetId: 1, sourceDurationSec: 5, inSec: 0, outSec: 5 }),
    ])
    render(<ControlledEditor initial={single} onCompose={vi.fn()} />)
    expect(screen.getByText('至少需要 2 个片段才能合成')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '合成为一条视频' })).toBeDisabled()
  })

  it('空时间线给出接入片段的引导', () => {
    render(<ControlledEditor initial={createTimelineState()} />)
    expect(screen.getByText(/把画布上的视频拖进来/)).toBeInTheDocument()
    expect(screen.getByText(/时间线还是空的/)).toBeInTheDocument()
  })

  it('空时间线也能从画布挑视频起步，不必先有连线', async () => {
    const user = userEvent.setup()
    const onAddClip = vi.fn()
    render(
      <ControlledEditor
        initial={createTimelineState()}
        onAddClip={onAddClip}
        addableSources={[
          { nodeId: 'video-1', assetId: 11, label: '画布视频 1', thumbnailUrl: '/a.mp4' },
          { nodeId: 'video-2', assetId: 12, label: '画布视频 2', thumbnailUrl: '' },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '＋ 添加片段' }))
    const menu = screen.getByRole('menu', { name: '画布上的视频' })
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2)

    await user.click(within(menu).getByRole('menuitem', { name: /画布视频 2/ }))
    // 交回的是节点 id：上层据此建连线并追加片段
    expect(onAddClip).toHaveBeenCalledWith('video-2')
    // 选完即收起，不挡住下面的轨道
    expect(screen.queryByRole('menu', { name: '画布上的视频' })).not.toBeInTheDocument()
  })

  it('画布上没有可加入的视频时禁用并说明原因', () => {
    render(<ControlledEditor initial={createTimelineState()} onAddClip={vi.fn()} addableSources={[]} />)
    const add = screen.getByRole('button', { name: '＋ 添加片段' })
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', expect.stringContaining('画布上没有可加入的视频'))
  })

  it('片段数达上限时禁用添加并说明原因', () => {
    const full = addTimelineClips(
      createTimelineState(),
      Array.from({ length: MAX_TIMELINE_CLIPS }, (_, i) =>
        createTimelineClip({ id: `clip-${i + 1}`, assetId: i + 1, sourceDurationSec: 3, inSec: 0, outSec: 3 }),
      ),
    )
    render(
      <ControlledEditor
        initial={full}
        onAddClip={vi.fn()}
        addableSources={[{ nodeId: 'video-9', assetId: 99, label: '画布视频 9', thumbnailUrl: '' }]}
      />,
    )
    const add = screen.getByRole('button', { name: '＋ 添加片段' })
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', `片段数已达上限（${MAX_TIMELINE_CLIPS} 个）`)
  })

  it('连线来源尚未生成完成时如实说明，而不是静默什么都不发生', () => {
    const { rerender } = render(<ControlledEditor initial={createTimelineState()} pendingSourceCount={2} />)
    expect(screen.getByText(/有 2 个连入的视频还没有生成完成/)).toBeInTheDocument()

    rerender(
      <CanvasTimelineEditor
        open
        workspaceId={21}
        state={createTimelineState()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        pendingSourceCount={0}
      />,
    )
    expect(screen.queryByText(/还没有生成完成/)).not.toBeInTheDocument()
  })

  it('合成中把当前阶段显示在按钮上', () => {
    render(<ControlledEditor onCompose={vi.fn()} composing composeProgress="正在读取素材 1/2" />)
    expect(screen.getByRole('button', { name: '正在读取素材 1/2' })).toBeDisabled()
  })
})
