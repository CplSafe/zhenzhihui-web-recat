import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  retry: vi.fn(),
  listCommissions: vi.fn(),
  listInvitees: vi.fn(),
  getReferralMyCode: vi.fn(),
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
    isDistributionIdentity: ['allowed', 'disabled'].includes(mocks.access.status),
  }),
}))

vi.mock('@/api/business', () => ({
  getReferralMyCode: mocks.getReferralMyCode,
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
    mocks.getReferralMyCode.mockReset()
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
      items: [
        {
          invitee_id: 77,
          invitee_name: '刚注册的邀请客户',
          relationship: 'direct',
          registered_at: '2026-07-26T15:30:00+08:00',
          distributor_id: 9,
          distributor_name: '杭州云创科技有限公司',
          status: 'registered',
          total_recharge_cents: 20000,
          total_consumed_cents: 0,
          balance_cents: 20000,
          pending_commission_cents: 1000,
        },
      ],
      total: 1,
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
    mocks.getReferralMyCode.mockResolvedValue('ZZH-TEST-001')
  })

  it('renders the Figma summary and commission data returned by the backend', async () => {
    render(<DistributionView />)

    expect(screen.getByRole('heading', { name: '邀请收益' })).toBeInTheDocument()
    expect(screen.getByText('12,560.00')).toBeInTheDocument()
    expect(screen.getByText('8,320.00')).toBeInTheDocument()
    expect(screen.queryByText('4,240.00')).not.toBeInTheDocument()
    expect(await screen.findByText('上海云创科技有限公司')).toBeInTheDocument()
    expect(screen.getByText('刚注册的邀请客户')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '邀请客户' })).toBeInTheDocument()
    expect(screen.getByText('￥1,200.00')).toBeInTheDocument()
    expect(screen.getByText('￥60.00')).toBeInTheDocument()
    expect(screen.queryByText('300912345678')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '客户账户ID' })).not.toBeInTheDocument()
    expect(screen.getAllByText('我的客户')).toHaveLength(3)
    expect(await screen.findByText('结算中', { selector: '.distribution-status' })).toBeInTheDocument()
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

  it('redirects non-marketing users without loading rebate data', () => {
    mocks.access.status = 'denied'
    mocks.access.overview = null

    render(<DistributionView />)

    expect(screen.queryByRole('heading', { name: '邀请收益' })).not.toBeInTheDocument()
    expect(screen.getByText('当前账号无权访问，正在返回首页…')).toBeInTheDocument()
    expect(mocks.navigate).toHaveBeenCalledWith('/home', { replace: true })
    expect(mocks.listCommissions).not.toHaveBeenCalled()
    expect(mocks.listInvitees).not.toHaveBeenCalled()
  })

  it('loads a backend referral code and builds the customer invitation link', async () => {
    const user = userEvent.setup()
    render(<DistributionView />)

    await user.click(screen.getByRole('button', { name: '邀请客户' }))

    expect(await screen.findByLabelText('专属邀请链接')).toHaveValue(
      `${window.location.origin}/login?invite_code=ZZH-TEST-001`,
    )
    expect(mocks.getReferralMyCode).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('专属邀请码')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制邀请码' })).not.toBeInTheDocument()
  })

  it('uses the customer code returned by the distribution overview', async () => {
    const user = userEvent.setup()
    mocks.access.overview = {
      ...mocks.access.overview,
      code: 'ZZH-CUSTOMER-001',
      distributor_code: 'ZZH-D-CHANNEL-001',
    }
    render(<DistributionView />)

    await user.click(screen.getByRole('button', { name: '邀请客户' }))

    expect(await screen.findByLabelText('专属邀请链接')).toHaveValue(
      `${window.location.origin}/login?invite_code=ZZH-CUSTOMER-001`,
    )
    expect(mocks.getReferralMyCode).not.toHaveBeenCalled()
  })

  it('loads invitation relationships for summary counts without rendering a second list', async () => {
    render(<DistributionView />)

    await waitFor(() => expect(mocks.listInvitees).toHaveBeenCalledTimes(1))
    expect(mocks.listCommissions).toHaveBeenCalledTimes(1)
    expect(screen.getByText('刚注册的邀请客户')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新数据' })).not.toBeInTheDocument()
  })

  it('refreshes invitation and commission data every three seconds while visible', async () => {
    vi.useFakeTimers()
    try {
      render(<DistributionView />)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mocks.listInvitees).toHaveBeenCalledTimes(1)
      expect(mocks.listCommissions).toHaveBeenCalledTimes(1)

      await act(async () => {
        vi.advanceTimersByTime(3_000)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mocks.listInvitees).toHaveBeenCalledTimes(2)
      expect(mocks.listCommissions).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the distributor code for a channel invitation link without a QR code', async () => {
    const user = userEvent.setup()
    mocks.access.overview = {
      ...mocks.access.overview,
      invite_code: 'DIST-CUSTOMER-001',
      distributor_code: 'ZZH-D-JAZ589JR',
    }
    render(<DistributionView />)

    await user.click(screen.getByRole('button', { name: '邀请渠道' }))

    expect(screen.getByRole('dialog', { name: '邀请渠道' })).toBeInTheDocument()
    expect(screen.getByLabelText('渠道邀请链接')).toHaveValue(
      `${window.location.origin}/login?invite_code=ZZH-D-JAZ589JR&invite_type=channel`,
    )
    expect(screen.queryByLabelText('渠道邀请二维码')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载二维码' })).not.toBeInTheDocument()
    expect(mocks.getReferralMyCode).not.toHaveBeenCalled()
    expect(screen.getByText('对方通过该链接完成注册后，后端将按渠道邀请类型建立邀请关系。')).toBeInTheDocument()
  })

  it('shows a clear message when the sales identity is disabled', () => {
    mocks.access.status = 'disabled'
    mocks.access.overview = { distributor_status: 'disabled', distributor_code: 'ZZH-D-JAZ589JR' }

    render(<DistributionView />)

    expect(screen.getByRole('heading', { name: '销售身份被停用，请联系客服' })).toBeInTheDocument()
    expect(mocks.listCommissions).not.toHaveBeenCalled()
    expect(mocks.listInvitees).not.toHaveBeenCalled()
  })

  it('does not present missing backend money and status fields as zero or settling', async () => {
    mocks.access.overview = {
      successful_invitees: 1,
      distributor_invitee_count: 0,
    }
    mocks.listInvitees.mockResolvedValue({
      items: [
        {
          invitee_id: 88,
          invitee_name: '消费字段缺失客户',
          relationship: 'direct',
          registered_at: '2026-07-26T15:30:00+08:00',
          status: 'registered',
        },
      ],
      total: 1,
    })
    mocks.listCommissions.mockResolvedValue({
      items: [{ id: 2, paid_amount: 29.9 }],
      total: 1,
    })

    render(<DistributionView />)

    expect(await screen.findByRole('heading', { name: '邀请收益' })).toBeInTheDocument()
    expect(screen.getByText('消费字段缺失客户')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 条收益记录缺少客户归属信息')
    expect(screen.queryByText('消费数据待同步')).not.toBeInTheDocument()
    expect(screen.queryByText('状态待同步')).not.toBeInTheDocument()
    expect(screen.queryByText('数据待同步')).not.toBeInTheDocument()
    expect(screen.getByText('累计返利金额')).toBeInTheDocument()
    expect(screen.getByText('可提现金额')).toBeInTheDocument()
    expect(screen.queryByText('待结算金额')).not.toBeInTheDocument()
    expect(screen.queryByText('分销商邀请客户')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '消费时间' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '客户名称' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '客户账户ID' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '关系' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '所属分销商' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '客户状态' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '注册时间' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '充值金额' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '我的收益' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '收益状态' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '结算时间' })).not.toBeInTheDocument()
    expect(screen.queryByText('结算中', { selector: '.distribution-status' })).not.toBeInTheDocument()
    expect(screen.getAllByText('0.00')).toHaveLength(2)
  })
})
