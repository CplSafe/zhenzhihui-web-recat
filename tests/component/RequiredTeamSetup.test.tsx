import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ complete: vi.fn(), session: vi.fn(), reset: vi.fn(), login: vi.fn() }))
vi.mock('@/api/business', () => ({
  completeTeamSetup: mocks.complete,
  getBusinessErrorMessage: (e: Error) => e.message,
}))
vi.mock('@/api/auth', () => ({ getAuthenticatedSession: mocks.session, resetAuthenticatedSession: mocks.reset }))
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ handleLoginSuccess: mocks.login }) }))
import RequiredTeamSetup from '@/components/team/RequiredTeamSetup'

beforeEach(() => {
  vi.resetAllMocks()
})

it('cannot dismiss before creation, remounts pending, and rejects empty names', async () => {
  const first = render(<RequiredTeamSetup userId={8} />)
  expect(screen.getByRole('button', { name: /创建团队并继续/ })).toBeDisabled()
  expect(screen.queryByRole('button', { name: /close|关闭/i })).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', keyCode: 27 })
  fireEvent.click(document.querySelector('.ant-modal-mask')!)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  first.unmount()
  render(<RequiredTeamSetup userId={8} />)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(mocks.complete).not.toHaveBeenCalled()
})

it('keeps the modal after failure and submits once until the session confirms completion', async () => {
  const user = userEvent.setup()
  let resolve!: (value: unknown) => void
  mocks.complete.mockRejectedValueOnce(new Error('团队名称已存在')).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  mocks.session.mockResolvedValue({ user: { id: 8, team_setup_required: false } })
  render(<RequiredTeamSetup userId={8} />)
  await user.type(screen.getByRole('textbox', { name: '团队名称' }), '新团队')
  await user.click(await screen.findByRole('button', { name: /创建团队并继续/ }))
  expect(await screen.findByText('团队名称已存在')).toBeInTheDocument()
  expect(mocks.login).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '团队名称' })).toBeEnabled()
  await user.click(await screen.findByRole('button', { name: /创建团队并继续/ }))
  fireEvent.submit(document.querySelector('form')!)
  expect(mocks.complete).toHaveBeenCalledTimes(2)
  await act(async () => {
    resolve({ id: 9 })
    await Promise.resolve()
  })
  expect(mocks.reset).toHaveBeenCalledOnce()
  expect(mocks.login).toHaveBeenCalledWith({ user: { id: 8, team_setup_required: false } })
})

it('does not apply a late response after unmounting or changing accounts', async () => {
  let resolve!: (value: unknown) => void
  mocks.complete.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const first = render(<RequiredTeamSetup userId={8} />)
  await userEvent.type(screen.getByRole('textbox', { name: '团队名称' }), 'Old account')
  await userEvent.click(screen.getByRole('button', { name: /创建团队并继续/ }))
  first.unmount()
  render(<RequiredTeamSetup userId={9} />)
  await act(async () => {
    resolve({ id: 22 })
    await Promise.resolve()
  })
  expect(mocks.session).not.toHaveBeenCalled()
  expect(mocks.login).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '团队名称' })).toHaveValue('')
})
