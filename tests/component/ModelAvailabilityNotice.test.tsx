import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import ModelAvailabilityProvider from '@/components/common/ModelAvailabilityProvider'
import { EmptyModelNotice } from '@/components/common/ModelAvailabilityNotice'

const mocks = vi.hoisted(() => ({ subscription: vi.fn(), open: vi.fn() }))
vi.mock('@/api/business', () => ({ getSubscription: mocks.subscription }))
vi.mock('@/stores/ui', () => ({ openMemberCenter: mocks.open }))
beforeEach(() => vi.clearAllMocks())

function mount(owner: boolean) {
  return render(
    <ModelAvailabilityProvider
      workspace={{ id: 21, type: 'team', owner_user_id: owner ? 7 : 8 }}
      member={{ role: owner ? 'owner' : 'member' }}
      user={{ id: 7 }}
    >
      <EmptyModelNotice workspaceId={21} label="图生图模型" />
    </ModelAvailabilityProvider>,
  )
}
it('offers the owner renewal, opens membership and refreshes subscription', async () => {
  mocks.subscription.mockResolvedValue({ plan_id: 10, active: false, expires_at: '2020-01-01T00:00:00Z' })
  mount(true)
  fireEvent.click(await screen.findByRole('button', { name: '续费 / 购买会员' }))
  expect(mocks.open).toHaveBeenCalledOnce()
  mocks.subscription.mockResolvedValue({ plan_id: 10, active: true, expires_at: '2099-01-01T00:00:00Z' })
  fireEvent.click(screen.getByRole('button', { name: '刷新权益与模型' }))
  await waitFor(() => expect(screen.queryByText(/当前会员已到期/)).not.toBeInTheDocument())
  expect(screen.getByRole('status')).toHaveTextContent('平台管理员')
})
it('tells team members who can renew without offering a purchase button', async () => {
  mocks.subscription.mockResolvedValue({ plan_code: 'team', expires_at: '2020-01-01T00:00:00Z' })
  mount(false)
  expect(await screen.findByText(/请联系团队所有者续费/)).toBeVisible()
  expect(screen.queryByRole('button', { name: '续费 / 购买会员' })).not.toBeInTheDocument()
})
it('does not turn subscription lookup failure into a purchase suggestion', async () => {
  mocks.subscription.mockRejectedValue(new Error('network'))
  mount(true)
  await waitFor(() => expect(mocks.subscription).toHaveBeenCalledOnce())
  expect(screen.getByRole('status')).toHaveTextContent('平台管理员')
  expect(screen.queryByRole('button', { name: /购买会员|查看会员/ })).not.toBeInTheDocument()
})
