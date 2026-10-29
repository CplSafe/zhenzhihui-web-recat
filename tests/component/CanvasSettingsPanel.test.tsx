import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasSettingsPanel from '@/components/canvas/CanvasSettingsPanel'
import { DEFAULT_CANVAS_PREFERENCES } from '@/utils/canvasPreferences'

vi.mock('@/utils/generationNotifier', () => ({
  ensureNotificationPermission: vi.fn().mockResolvedValue('granted'),
  getNotificationPermission: vi.fn(() => 'default'),
  playNotificationSound: vi.fn(),
  showGenerationNotification: vi.fn(),
}))

describe('CanvasSettingsPanel 快捷键设置', () => {
  it('录入新快捷键并阻止与其它动作重复', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <CanvasSettingsPanel
        preferences={DEFAULT_CANVAS_PREFERENCES}
        onChange={onChange}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    for (const label of [
      '生成当前节点',
      '撤销',
      '重做',
      '成组',
      '解组',
      '画布节点搜索',
      '删除节点和连线',
      '时间线：播放 / 暂停',
      '时间线：上一帧',
      '滚轮缩放画布',
    ]) {
      expect(screen.getByRole('button', { name: `修改${label}快捷键` })).toBeInTheDocument()
    }
    const addShortcut = screen.getByRole('button', { name: '修改添加节点快捷键' })
    await user.click(addShortcut)
    await user.keyboard('k')
    expect(onChange).toHaveBeenCalledWith({
      shortcuts: { ...DEFAULT_CANVAS_PREFERENCES.shortcuts, add: 'K' },
    })

    await user.click(addShortcut)
    await user.keyboard(' ')
    expect(screen.getByRole('alert')).toHaveTextContent('临时平移画布')
    await user.keyboard('{Control>}l{/Control}')
    expect(screen.getByRole('alert')).toHaveTextContent('已用于“连接选中的两个节点”')
  })

  it('时间线允许使用空格，滚轮缩放可录入修饰键并持久化回调', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <CanvasSettingsPanel
        preferences={DEFAULT_CANVAS_PREFERENCES}
        onChange={onChange}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: '修改时间线：播放 / 暂停快捷键' }))
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith({
      shortcuts: { ...DEFAULT_CANVAS_PREFERENCES.shortcuts, timelinePlay: 'Space' },
    })
    const wheel = screen.getByRole('button', { name: '修改滚轮缩放画布快捷键' })
    await user.click(wheel)
    fireEvent.wheel(wheel, { altKey: true, deltaY: -100 })
    expect(onChange).toHaveBeenLastCalledWith({
      shortcuts: { ...DEFAULT_CANVAS_PREFERENCES.shortcuts, zoomWheel: 'Alt+Wheel' },
    })
  })

  it('保留统一的恢复默认入口', async () => {
    const user = userEvent.setup()
    const onReset = vi.fn()
    render(
      <CanvasSettingsPanel
        preferences={DEFAULT_CANVAS_PREFERENCES}
        onChange={vi.fn()}
        onReset={onReset}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(onReset).toHaveBeenCalledOnce()
  })
})
