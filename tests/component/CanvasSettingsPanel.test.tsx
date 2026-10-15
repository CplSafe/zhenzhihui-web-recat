import { render, screen } from '@testing-library/react'
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

    const addShortcut = screen.getByRole('button', { name: '修改添加节点快捷键' })
    await user.click(addShortcut)
    await user.keyboard('k')
    expect(onChange).toHaveBeenCalledWith({
      shortcuts: { ...DEFAULT_CANVAS_PREFERENCES.shortcuts, add: 'K' },
    })

    await user.click(addShortcut)
    await user.keyboard('l')
    expect(screen.getByRole('alert')).toHaveTextContent('已用于“连接选中的两个节点”')
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
