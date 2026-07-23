import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  requestConfirm: vi.fn(),
  state: { isLoggingOut: false },
}))

vi.mock('@/components/auth/ChangePasswordModal', () => ({
  default: ({ onClose }: any) => <button onClick={onClose}>修改密码弹窗</button>,
}))
vi.mock('@/components/layout/PersonalCenterModal', () => ({
  default: ({ onClose }: any) => <button onClick={onClose}>个人中心弹窗</button>,
}))
vi.mock('@/composables/useLogout', () => ({
  useLogout: () => ({ isLoggingOut: mocks.state.isLoggingOut, logout: mocks.logout }),
}))
vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
}))

import SettingsMenu from '@/components/home/SettingsMenu'

describe('SettingsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.isLoggingOut = false
    mocks.logout.mockResolvedValue(undefined)
    mocks.requestConfirm.mockResolvedValue(false)
  })

  it('opens an accessible menu, focuses its first item, and closes with Escape', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)
    const trigger = screen.getByRole('button', { name: '设置' })

    await user.click(trigger)
    expect(screen.getByRole('menu', { name: '设置菜单' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '个人中心' })).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens personal center and requests the mobile drawer to close', async () => {
    const user = userEvent.setup()
    const onAfterAction = vi.fn()
    render(<SettingsMenu onAfterAction={onAfterAction} />)

    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(screen.getByRole('menuitem', { name: '个人中心' }))
    expect(screen.getByRole('button', { name: '个人中心弹窗' })).toBeInTheDocument()
    expect(onAfterAction).toHaveBeenCalledTimes(1)
  })

  it('requires logout confirmation, supports cancellation, and deduplicates confirmation', async () => {
    const user = userEvent.setup()
    const onAfterAction = vi.fn()
    render(<SettingsMenu onAfterAction={onAfterAction} />)

    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.dblClick(screen.getByRole('menuitem', { name: '退出登录' }))
    expect(mocks.requestConfirm).toHaveBeenCalledTimes(1)
    expect(mocks.logout).not.toHaveBeenCalled()
    expect(onAfterAction).not.toHaveBeenCalled()

    mocks.requestConfirm.mockResolvedValue(true)
    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(screen.getByRole('menuitem', { name: '退出登录' }))
    expect(mocks.logout).toHaveBeenCalledTimes(1)
    expect(onAfterAction).toHaveBeenCalledTimes(1)
  })
})
