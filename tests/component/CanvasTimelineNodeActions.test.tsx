import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasTimelineNodeActions from '@/components/canvas/CanvasTimelineNodeActions'

function setup(overrides: Partial<React.ComponentProps<typeof CanvasTimelineNodeActions>> = {}) {
  const props = {
    nodeId: 'timeline-1',
    clipCount: 2,
    onCompose: vi.fn(),
    onOpenEditor: vi.fn(),
    ...overrides,
  }
  render(<CanvasTimelineNodeActions {...props} />)
  return props
}

describe('CanvasTimelineNodeActions', () => {
  it('只保留针对整条时间线的动作，添加入口在轨道上', () => {
    setup()
    expect(screen.getByRole('button', { name: '精修' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '合成' })).toBeInTheDocument()
    // 「添加视频」已挪到轨道末尾的「+」，这里不该再有第二个入口
    expect(screen.queryByRole('button', { name: /添加视频/ })).not.toBeInTheDocument()
  })

  it('合成按钮交回节点 id；片段不足 2 段时禁用并说明', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByRole('button', { name: '合成' }))
    expect(props.onCompose).toHaveBeenCalledWith('timeline-1')

    setup({ clipCount: 1 })
    const compose = screen.getAllByRole('button', { name: '合成' })[1]
    expect(compose).toBeDisabled()
    expect(compose).toHaveAttribute('title', '至少需要 2 个片段才能合成')
  })

  it('合成中把当前阶段显示在按钮上', () => {
    setup({ composing: true, composeProgress: '正在读取素材 1/2' })
    expect(screen.getByRole('button', { name: '正在读取素材 1/2' })).toBeDisabled()
  })

  it('「精修」把节点 id 交回上层打开弹窗编辑器', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByRole('button', { name: '精修' }))
    expect(props.onOpenEditor).toHaveBeenCalledWith('timeline-1')
  })

  it('按钮上的指针事件不冒泡，否则点击会被当成拖拽节点', async () => {
    const user = userEvent.setup()
    const onPointerDown = vi.fn()
    render(
      <div onPointerDown={onPointerDown}>
        <CanvasTimelineNodeActions nodeId="timeline-1" clipCount={2} onCompose={vi.fn()} onOpenEditor={vi.fn()} />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: '精修' }))
    expect(onPointerDown).not.toHaveBeenCalled()
  })
})
