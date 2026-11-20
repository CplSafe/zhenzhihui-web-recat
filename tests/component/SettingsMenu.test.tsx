import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  logout: vi.fn(),
  requestConfirm: vi.fn(),
  requireAuth: vi.fn(),
  allowProtectedAction: true,
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
vi.mock('@/composables/useRequireAuth', () => ({
  useRequireAuth: () => mocks.requireAuth,
}))

vi.mock('@/api/creditRequests', () => ({ getCreditRequestContext: mocks.context }))

import SettingsMenu from '@/components/home/SettingsMenu'
import { MANUAL_DOC_URL } from '@/utils/tutorialVideos'

describe('SettingsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.mockResolvedValue({ superior: { id: 20, name: '上级' } })
    mocks.state.isLoggingOut = false
    mocks.allowProtectedAction = true
    mocks.requireAuth.mockImplementation(async (action: () => void) => {
      if (mocks.allowProtectedAction) action()
      return mocks.allowProtectedAction
    })
    mocks.logout.mockResolvedValue(undefined)
    mocks.requestConfirm.mockResolvedValue(false)
  })

  it('redirect guard prevents guests from opening the settings menu', async () => {
    const user = userEvent.setup()
    mocks.allowProtectedAction = false
    render(<SettingsMenu />, { wrapper: MemoryRouter })

    await user.click(screen.getByRole('button', { name: '设置' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(mocks.requireAuth).toHaveBeenCalledWith(expect.any(Function), {
      prompt: false,
      returnTo: expect.any(String),
    })
  })

  it('opens an accessible menu, focuses its first item, and closes with Escape', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />, { wrapper: MemoryRouter })
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
    render(<SettingsMenu onAfterAction={onAfterAction} />, { wrapper: MemoryRouter })

    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(screen.getByRole('menuitem', { name: '个人中心' }))
    expect(screen.getByRole('button', { name: '个人中心弹窗' })).toBeInTheDocument()
    expect(onAfterAction).toHaveBeenCalledTimes(1)
  })

  it('opens the user manual in a new browser tab and closes the mobile drawer', async () => {
    const user = userEvent.setup()
    const onAfterAction = vi.fn()
    render(<SettingsMenu onAfterAction={onAfterAction} />, { wrapper: MemoryRouter })

    await user.click(screen.getByRole('button', { name: '设置' }))
    const manualLink = screen.getByRole('menuitem', { name: '使用手册' })

    expect(manualLink).toHaveAttribute('href', MANUAL_DOC_URL)
    expect(manualLink).toHaveAttribute('target', '_blank')
    expect(manualLink).toHaveAttribute('rel', 'noopener noreferrer')

    await user.click(manualLink)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onAfterAction).toHaveBeenCalledTimes(1)
  })

  it('requires logout confirmation, supports cancellation, and deduplicates confirmation', async () => {
    const user = userEvent.setup()
    const onAfterAction = vi.fn()
    render(<SettingsMenu onAfterAction={onAfterAction} />, { wrapper: MemoryRouter })

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
  it.each(['unbound', 'unavailable'])('hides the credit request entry when context is %s', async (state) => {
    if (state === 'unbound') mocks.context.mockResolvedValue({ superior: null })
    else mocks.context.mockRejectedValue(new Error('unavailable'))
    render(<SettingsMenu />, { wrapper: MemoryRouter })
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByRole('menuitem', { name: '积分申请' })).not.toBeInTheDocument()
  })

  it('rechecks hierarchy on reopening and hides the old entry while loading', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />, { wrapper: MemoryRouter })
    await user.click(screen.getByRole('button', { name: '设置' }))
    expect(await screen.findByRole('menuitem', { name: '积分申请' })).toBeVisible()
    await user.keyboard('{Escape}')
    mocks.context.mockResolvedValue({ superior: null })
    await user.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByRole('menuitem', { name: '积分申请' })).not.toBeInTheDocument()
    expect(mocks.context).toHaveBeenCalledTimes(2)
  })

  it('replaces the MCP menu item with credit requests', async () => {
    const user = userEvent.setup()
    const onAfterAction = vi.fn()
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<SettingsMenu onAfterAction={onAfterAction} />} />
          <Route path="/settings/credit-requests" element={<h1>积分申请页</h1>} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByRole('menuitem', { name: 'MCP 接入' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: '积分申请' }))
    expect(await screen.findByRole('heading', { name: '积分申请页' })).toBeInTheDocument()
    expect(onAfterAction).toHaveBeenCalledTimes(1)
  })
})
