import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  retry: vi.fn(),
  listCommissions: vi.fn(),
  listInvitees: vi.fn(),
  access: {
    status: 'allowed',
    overview: {
      total_commission: 12560,
      withdrawable_amount: 8320,
      pending_amount: 4240,
      successful_invitees: 36,
      distributor_invitee_count: 68,
    },
    error: null,
  } as any,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/composables/useDistributionAccess', () => ({
  useDistributionAccess: () => ({
    ...mocks.access,
    retry: mocks.retry,
    isDistributor: mocks.access.status === 'allowed',
  }),
}))

vi.mock('@/api/business', () => ({
  listDistributionCommissions: mocks.listCommissions,
  listDistributionInvitees: mocks.listInvitees,
}))

import DistributionView from '@/views/DistributionView'

describe('DistributionView', () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    mocks.retry.mockReset()
    mocks.listCommissions.mockReset()
    mocks.listInvitees.mockReset()
    mocks.access.status = 'allowed'
    mocks.access.error = null
    mocks.access.overview = {
      total_commission: 12560,
      withdrawable_amount: 8320,
      pending_amount: 4240,
      successful_invitees: 36,
      distributor_invitee_count: 68,
    }
    mocks.listInvitees.mockResolvedValue({
      items: [{ distributor_id: 9, distributor_name: '杭州云创科技有限公司' }],
    })
    mocks.listCommissions.mockResolvedValue({
      items: [
        {
          id: 1,
          paid_at: '2026-06-01T14:32:08+08:00',
          customer_name: '上海云创科技有限公司',
          customer_account_id: '300912345678',
          relationship: 'direct',
          paid_amount: 1200,
          commission_amount: 60,
          status: 'pending',
        },
      ],
      total: 1,
    })
  })

  it('renders the Figma summary and commission data returned by the backend', async () => {
    render(<DistributionView />)

    expect(screen.getByRole('heading', { name: '邀请收益' })).toBeInTheDocument()
    expect(screen.getByText('12,560.00')).toBeInTheDocument()
    expect(screen.getByText('8,320.00')).toBeInTheDocument()
    expect(screen.getByText('4,240.00')).toBeInTheDocument()
    expect(await screen.findByText('上海云创科技有限公司')).toBeInTheDocument()
    expect(screen.getByText('300912345678')).toBeInTheDocument()
    expect(screen.getAllByText('我的客户')).toHaveLength(2)
    expect(screen.getByText('结算中')).toBeInTheDocument()
  })

  it('submits filters using the backend query contract', async () => {
    const user = userEvent.setup()
    render(<DistributionView />)
    await screen.findByText('上海云创科技有限公司')

    await user.type(screen.getByPlaceholderText('搜索客户名称/账号ID'), '云创')
    await user.selectOptions(screen.getByDisplayValue('全部关系'), 'direct')
    await user.click(screen.getByRole('button', { name: '查询' }))

    await waitFor(() => {
      expect(mocks.listCommissions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          keyword: '云创',
          relationship: 'direct',
          offset: 0,
          limit: 50,
        }),
      )
    })
  })

  it('redirects a non-marketing user away from the protected page', async () => {
    mocks.access.status = 'denied'
    mocks.access.overview = null

    render(<DistributionView />)

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/home', { replace: true }))
    expect(screen.queryByRole('heading', { name: '邀请收益' })).not.toBeInTheDocument()
  })
})
