import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  retry: vi.fn(),
  listCommissions: vi.fn(),
  listInvitees: vi.fn(),
  exportCommissions: vi.fn(),
  getDistributionOverview: vi.fn(),
  listWithdrawalMethods: vi.fn(),
  listWithdrawals: vi.fn(),
  createWithdrawalMethod: vi.fn(),
  deleteWithdrawalMethod: vi.fn(),
  createWithdrawal: vi.fn(),
  requestConfirm: vi.fn(),
  showToast: vi.fn(),
  access: {
    status: 'allowed',
    overview: {
      total_commission: 12560,
      withdrawable_amount: 8320,
      withdrawn_amount: 4240,
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
  getDistributionOverview: mocks.getDistributionOverview,
  listDistributionCommissions: mocks.listCommissions,
  listDistributionInvitees: mocks.listInvitees,
  exportDistributionCommissions: mocks.exportCommissions,
  listDistributionWithdrawalMethods: mocks.listWithdrawalMethods,
  listDistributionWithdrawals: mocks.listWithdrawals,
  createDistributionWithdrawalMethod: mocks.createWithdrawalMethod,
  deleteDistributionWithdrawalMethod: mocks.deleteWithdrawalMethod,
  createDistributionWithdrawal: mocks.createWithdrawal,
}))

vi.mock('@/composables/useToast', () => ({
  useConfirmDialog: () => ({ requestConfirm: mocks.requestConfirm }),
  useToast: () => ({ showToast: mocks.showToast }),
}))

import DistributionView from '@/views/DistributionView'

describe('DistributionView', () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    mocks.retry.mockReset()
    mocks.listCommissions.mockReset()
    mocks.listInvitees.mockReset()
    mocks.exportCommissions.mockReset()
    mocks.getDistributionOverview.mockReset()
    mocks.listWithdrawalMethods.mockReset()
    mocks.listWithdrawals.mockReset()
    mocks.createWithdrawalMethod.mockReset()
    mocks.deleteWithdrawalMethod.mockReset()
    mocks.createWithdrawal.mockReset()
    mocks.requestConfirm.mockReset()
    mocks.showToast.mockReset()
    mocks.requestConfirm.mockResolvedValue(true)
    mocks.access.status = 'allowed'
    mocks.access.error = null
    mocks.access.overview = {
      total_commission: 12560,
      withdrawable_amount: 8320,
      withdrawn_amount: 4240,
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
          total_consumed_credits: 200,
          invited_customer_count: 5,
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
    mocks.getDistributionOverview.mockResolvedValue({
      code: 'ZZH-CUSTOMER-001',
      distributor_code: 'ZZH-D-CHANNEL-001',
    })
    mocks.listWithdrawalMethods.mockResolvedValue({ items: [] })
    mocks.listWithdrawals.mockResolvedValue({ items: [] })
    mocks.createWithdrawalMethod.mockResolvedValue({ id: 1 })
    mocks.deleteWithdrawalMethod.mockResolvedValue({})
    mocks.createWithdrawal.mockResolvedValue({ id: 1, status: 'pending' })
    mocks.exportCommissions.mockResolvedValue({
      blob: new Blob(['backend-xlsx'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      fileName: '后端返回的邀请收益明细.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  })

  it('renders the Figma summary and commission data returned by the backend', async () => {
    const { container } = render(<DistributionView />)

    expect(screen.getByRole('heading', { name: '邀请收益' })).toBeInTheDocument()
    expect(screen.getByText('12,560.00')).toBeInTheDocument()
    expect(screen.getByText('8,320.00')).toBeInTheDocument()
    expect(screen.getByText('4,240.00')).toBeInTheDocument()
    expect(screen.getByText('成功邀请渠道')).toBeInTheDocument()
    expect(screen.getByText('68')).toBeInTheDocument()
    expect(await screen.findByText('上海云创科技有限公司')).toBeInTheDocument()
    expect(screen.getByText('刚注册的邀请客户')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '邀请客户' })).toBeInTheDocument()
    expect(screen.getByText('￥1,200.00')).toBeInTheDocument()
    expect(screen.getByText('￥60.00')).toBeInTheDocument()
    expect(screen.queryByText('300912345678')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '客户账户ID' })).not.toBeInTheDocument()
    expect(screen.getAllByText('我的客户')).toHaveLength(3)
    expect(await screen.findByText('结算中', { selector: '.distribution-status' })).toBeInTheDocument()
    const inviteeSection = screen.getByRole('heading', { name: '邀请客户' }).closest('section')
    expect(inviteeSection).not.toBeNull()
    const inviteeHeaders = within(inviteeSection as HTMLElement)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    expect(inviteeHeaders.indexOf('累计消耗积分')).toBe(inviteeHeaders.indexOf('累计充值') + 1)
    expect(inviteeHeaders).toContain('邀请客户数')
    expect(container.querySelectorAll('table.distribution-table')).toHaveLength(2)
  })

  it('paginates invitees and commissions independently with ten rows per page', async () => {
    const user = userEvent.setup()
    mocks.listInvitees.mockResolvedValue({
      items: Array.from({ length: 11 }, (_, index) => ({
        invitee_id: index + 1,
        invitee_name: `邀请客户-${index + 1}`,
        relationship: 'direct',
        registered_at: `2026-07-${String(index + 1).padStart(2, '0')}T10:00:00+08:00`,
      })),
      total: 11,
    })
    mocks.listCommissions.mockResolvedValue({
      items: Array.from({ length: 11 }, (_, index) => ({
        id: index + 1,
        customer_name: `返利客户-${index + 1}`,
        paid_at: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00+08:00`,
        paid_amount_cents: 1000 + index,
        rebate_amount_cents: 100,
        rebate_status: 'credited',
      })),
      total: 11,
    })

    render(<DistributionView />)

    expect(await screen.findByText('邀请客户-1')).toBeInTheDocument()
    expect(screen.getByText('邀请客户-10')).toBeInTheDocument()
    expect(screen.queryByText('邀请客户-11')).not.toBeInTheDocument()
    expect(await screen.findByText('返利客户-1')).toBeInTheDocument()
    expect(screen.getByText('返利客户-10')).toBeInTheDocument()
    expect(screen.queryByText('返利客户-11')).not.toBeInTheDocument()

    const inviteePagination = screen.getByRole('navigation', { name: '邀请关系列表分页' })
    await user.click(within(inviteePagination).getByRole('button', { name: '下一页' }))
    expect(screen.getByText('邀请客户-11')).toBeInTheDocument()
    expect(screen.queryByText('邀请客户-1')).not.toBeInTheDocument()

    const commissionPagination = screen.getByRole('navigation', { name: '收益明细分页' })
    await user.click(within(commissionPagination).getByRole('button', { name: '下一页' }))
    expect(screen.getByText('返利客户-11')).toBeInTheDocument()
    expect(screen.queryByText('返利客户-1')).not.toBeInTheDocument()
  })

  it('renders the new distribution overview fields in cents and credits', async () => {
    mocks.access.overview = {
      total_earned_cents: 12301,
      withdrawable_cents: 4801,
      withdrawing_cents: 2001,
      withdrawn_cents: 5001,
      total_recharged_cents: 12301,
      total_consumed_credits: 200,
      direct_rebate_cents: 7001,
      direct_rebate_count: 3,
      indirect_rebate_cents: 2601,
      indirect_rebate_count: 2,
      successful_invitees: 1,
      distributor_invitee_count: 0,
    }

    render(<DistributionView />)

    expect(screen.getByText('123.01')).toBeInTheDocument()
    expect(screen.getByText('48.01')).toBeInTheDocument()
    expect(screen.getByText('50.01')).toBeInTheDocument()
    const details = screen.getByRole('region', { name: '分销业务概览' })
    expect(within(details).getByText('￥20.01')).toBeInTheDocument()
    expect(within(details).getByText('￥123.01')).toBeInTheDocument()
    expect(within(details).getByText('200')).toBeInTheDocument()
    expect(within(details).getByText('￥70.01')).toBeInTheDocument()
    expect(within(details).getByText('直接客户贡献 · 3 笔订单')).toBeInTheDocument()
    expect(within(details).getByText('￥26.01')).toBeInTheDocument()
    expect(within(details).getByText('下级分销关系贡献 · 2 笔订单')).toBeInTheDocument()
    ;['提现中', '累计充值', '累计消耗积分', '直接返利', '间接返利'].forEach((label) => {
      expect(within(details).getByLabelText(`查看“${label}”说明`)).toBeInTheDocument()
    })

    const rechargeHelp = within(details).getByLabelText('查看“累计充值”说明')
    await userEvent.setup().click(rechargeHelp)
    expect(rechargeHelp.closest('details')).toHaveAttribute('open')
    expect(
      within(rechargeHelp.closest('article') as HTMLElement).getByText(
        '您邀请关系内的用户，已成功支付的积分充值订单实付总额，不包含其他类型订单。',
      ),
    ).toBeInTheDocument()
    expect(
      within(rechargeHelp.closest('article') as HTMLElement).getByText('数据来源：系统汇总受邀用户的积分充值订单'),
    ).toBeInTheDocument()
  })

  it('loads withdrawal methods and submits a withdrawal with an idempotency key', async () => {
    const user = userEvent.setup()
    mocks.access.overview = {
      total_earned_cents: 12300,
      withdrawable_cents: 4800,
      withdrawing_cents: 2000,
      withdrawn_cents: 5000,
      successful_invitees: 1,
      distributor_invitee_count: 0,
    }
    mocks.listWithdrawalMethods.mockResolvedValue({
      items: [
        {
          id: 7,
          method_type: 'bank_card',
          account_name: '张三',
          account_number: '****5678',
          bank_name: '招商银行',
          is_default: true,
        },
      ],
    })
    mocks.listWithdrawals.mockResolvedValue({
      items: [{ id: 9, amount_cents: 2000, status: 'pending', created_at: '2026-07-27T12:00:00+08:00' }],
    })

    render(<DistributionView />)
    await user.click(screen.getByRole('button', { name: '提现' }))

    expect(await screen.findByRole('dialog', { name: '申请提现' })).toBeInTheDocument()
    expect(screen.getByText('****5678', { exact: false })).toBeInTheDocument()
    const dialog = await screen.findByRole('dialog', { name: '申请提现' })
    expect(within(dialog).getAllByText('提现中').length).toBeGreaterThan(0)
    await user.type(screen.getByLabelText('提现金额'), '10.01')
    await user.click(screen.getByRole('button', { name: '确认提现' }))

    await waitFor(() => {
      expect(mocks.createWithdrawal).toHaveBeenCalledWith({
        methodId: 7,
        amountCents: 1001,
        idempotencyKey: expect.any(String),
      })
    })
    expect(mocks.retry).toHaveBeenCalled()
  })

  it('adds a withdrawal method and refreshes the available methods', async () => {
    const user = userEvent.setup()
    mocks.access.overview = { withdrawable_cents: 4800 }

    render(<DistributionView />)
    await user.click(screen.getByRole('button', { name: '提现' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加提现方式' }))
    expect(screen.getByText('当前仅支持提现到本人银行卡')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '账户姓名' }), '张三')
    await user.type(screen.getByRole('textbox', { name: '银行卡号' }), '6225880012345678')
    await user.type(screen.getByRole('textbox', { name: '开户银行' }), '招商银行')
    await user.click(screen.getByRole('button', { name: '保存提现方式' }))

    await waitFor(() => {
      expect(mocks.createWithdrawalMethod).toHaveBeenCalledWith({
        methodType: 'bank_card',
        accountName: '张三',
        accountNumber: '6225880012345678',
        bankName: '招商银行',
        isDefault: true,
      })
    })
    expect(mocks.listWithdrawalMethods).toHaveBeenCalledTimes(2)
  })

  it('confirms before deleting a withdrawal method and refreshes the list', async () => {
    const user = userEvent.setup()
    mocks.access.overview = { withdrawable_cents: 4800 }
    mocks.listWithdrawalMethods.mockResolvedValue({
      items: [
        {
          id: 7,
          method_type: 'bank_card',
          account_name: '张三',
          masked_account_number: 'zh***@example.com',
        },
      ],
    })

    render(<DistributionView />)
    await user.click(screen.getByRole('button', { name: '提现' }))
    await user.click(await screen.findByRole('button', { name: '删除银行卡提现方式' }))

    expect(mocks.requestConfirm).toHaveBeenCalledWith(expect.stringContaining('zh***@example.com'), {
      title: '删除提现方式',
      confirmLabel: '删除',
      danger: true,
    })
    await waitFor(() => expect(mocks.deleteWithdrawalMethod).toHaveBeenCalledWith({ id: 7 }))
    expect(mocks.listWithdrawalMethods).toHaveBeenCalledTimes(2)
  })

  it('filters orders by keyword, mobile, relationship, order type, time and status', async () => {
    const user = userEvent.setup()
    mocks.listCommissions.mockResolvedValue({
      items: [
        {
          id: 1,
          occurred_at: '2026-06-01T14:32:08+08:00',
          nickname: '上海云创科技有限公司',
          mobile: '138****1001',
          relation_level: 1,
          kind: 'customer',
          order_type: 'credits_recharge',
          paid_amount_cents: 120000,
          rebate_amount_cents: 6000,
          rebate_status: 'credited',
        },
        {
          id: 2,
          occurred_at: '2026-07-01T09:20:00+08:00',
          nickname: '北京渠道客户',
          mobile: '139****2002',
          relation_level: 2,
          kind: 'customer',
          order_type: 'subscription_renewal',
          paid_amount_cents: 2990,
          rebate_amount_cents: 0,
          rebate_status: 'not_credited',
        },
        {
          id: 3,
          occurred_at: '2026-07-03T10:00:00+08:00',
          nickname: '未知类型客户',
          mobile: '13700003003',
          relation_level: 1,
          order_type: 'legacy_campaign_order',
          paid_amount_cents: 5000,
          rebate_amount_cents: 200,
          rebate_status: 'credited',
        },
      ],
      total: 3,
    })
    render(<DistributionView />)
    await screen.findByText('上海云创科技有限公司')
    expect(screen.getByText('北京渠道客户')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '积分充值' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '其他订单' })).toBeInTheDocument()
    expect(screen.queryByText('legacy_campaign_order')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '所属分销商' })).not.toBeInTheDocument()

    const startDateInput = screen.getByPlaceholderText('开始年月日')
    const endDateInput = screen.getByPlaceholderText('结束年月日')
    expect(screen.queryByPlaceholderText(/yyyy|mm|dd/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('搜索客户名称或账号ID'), '北京')
    await user.type(screen.getByLabelText('搜索手机号'), '2002')
    await user.selectOptions(screen.getByLabelText('关系分类'), 'distributor')
    await user.selectOptions(screen.getByLabelText('订单类型'), 'subscription_renewal')
    await user.click(startDateInput)
    await user.click(await screen.findByTitle('2026-07-01'))
    await user.click(await screen.findByTitle('2026-07-02'))
    expect(startDateInput).toHaveValue('2026年07月01日')
    expect(endDateInput).toHaveValue('2026年07月02日')
    await user.selectOptions(screen.getByLabelText('收益状态'), 'pending')
    await user.click(screen.getByRole('button', { name: '查询' }))

    expect(screen.getByText('北京渠道客户')).toBeInTheDocument()
    expect(screen.queryByText('上海云创科技有限公司')).not.toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '分销商客户' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '续订' })).toBeInTheDocument()
    expect(mocks.listCommissions).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: 0,
        limit: 100,
      }),
    )

    await user.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByText('上海云创科技有限公司')).toBeInTheDocument()
    expect(screen.getByText('北京渠道客户')).toBeInTheDocument()
  })

  it('downloads the backend export unchanged with the supported relationship and order filters', async () => {
    const user = userEvent.setup()
    const backendBlob = new Blob(['backend-xlsx'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    mocks.exportCommissions.mockResolvedValue({
      blob: backendBlob,
      fileName: '后端明细.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    mocks.listCommissions.mockResolvedValue({
      items: [
        {
          id: 1,
          occurred_at: '2026-07-27T20:44:44+08:00',
          nickname: '导出测试客户',
          mobile: '189****4806',
          relation_level: 2,
          kind: 'customer',
          order_type: 'credits_recharge',
          paid_amount_cents: 2691,
          rebate_amount_cents: 445,
          rebate_status: 'credited',
        },
      ],
      total: 1,
    })
    let downloadedFileName = ''
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      expect(value).toBe(backendBlob)
      return 'blob:distribution-export'
    })
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clickLink = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedFileName = this.download
    })

    try {
      render(<DistributionView />)
      const orderTypeCell = await screen.findByRole('cell', { name: '积分充值' })
      expect(orderTypeCell).toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('关系分类'), 'distributor')
      await user.selectOptions(screen.getByLabelText('订单类型'), 'credits_recharge')
      await user.click(screen.getByRole('button', { name: '查询' }))

      await user.click(screen.getByRole('button', { name: '导出明细' }))

      expect(mocks.exportCommissions).toHaveBeenCalledWith({
        kind: 'customer',
        level: 2,
        orderType: 'credits_recharge',
      })
      expect(downloadedFileName).toBe('后端明细.xlsx')
      expect(createObjectUrl).toHaveBeenCalledWith(backendBlob)
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:distribution-export')
      expect(mocks.showToast).toHaveBeenCalledWith('明细已导出', 'success')
    } finally {
      createObjectUrl.mockRestore()
      revokeObjectUrl.mockRestore()
      clickLink.mockRestore()
    }
  })

  it('filters commission rows by recharge amount range', async () => {
    const user = userEvent.setup()
    mocks.listCommissions.mockResolvedValue({
      items: [
        {
          id: 1,
          occurred_at: '2026-07-01T09:20:00+08:00',
          nickname: '小额充值客户',
          paid_amount_cents: 2990,
        },
        {
          id: 2,
          occurred_at: '2026-07-02T09:20:00+08:00',
          nickname: '大额充值客户',
          paid_amount_cents: 120000,
        },
      ],
      total: 2,
    })

    render(<DistributionView />)
    expect(await screen.findByText('小额充值客户')).toBeInTheDocument()
    expect(screen.getByText('大额充值客户')).toBeInTheDocument()

    await user.type(screen.getByLabelText('最低充值金额'), '20')
    await user.type(screen.getByLabelText('最高充值金额'), '100')
    await user.click(screen.getByRole('button', { name: '查询' }))

    expect(screen.getByText('小额充值客户')).toBeInTheDocument()
    expect(screen.queryByText('大额充值客户')).not.toBeInTheDocument()
  })

  it('renders the rebate page and loads available data for non-marketing users', async () => {
    mocks.access.status = 'denied'
    mocks.access.overview = null

    render(<DistributionView />)

    expect(screen.getByRole('heading', { name: '邀请收益' })).toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mocks.listCommissions).toHaveBeenCalledTimes(1)
      expect(mocks.listInvitees).toHaveBeenCalledTimes(1)
    })
  })

  it('loads a backend referral code and builds the customer invitation link', async () => {
    const user = userEvent.setup()
    render(<DistributionView />)

    await user.click(screen.getByRole('button', { name: '邀请客户' }))

    expect(await screen.findByLabelText('专属邀请链接')).toHaveValue(
      `${window.location.origin}/login?invite_code=ZZH-CUSTOMER-001`,
    )
    expect(mocks.getDistributionOverview).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('专属邀请码')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制邀请码' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '关闭邀请客户弹窗' }))
    await user.click(screen.getByRole('button', { name: '邀请客户' }))
    await waitFor(() => expect(mocks.getDistributionOverview).toHaveBeenCalledTimes(2))
  })

  it('does not substitute the distributor code when the customer code is missing', async () => {
    const user = userEvent.setup()
    mocks.getDistributionOverview.mockResolvedValue({
      distributor_code: 'ZZH-D-CHANNEL-001',
    })
    render(<DistributionView />)

    await user.click(screen.getByRole('button', { name: '邀请客户' }))

    expect(await screen.findByText('后端未返回客户邀请码')).toBeInTheDocument()
    expect(screen.queryByLabelText('专属邀请链接')).not.toBeInTheDocument()
    expect(mocks.getDistributionOverview).toHaveBeenCalledTimes(1)
  })

  it('loads invitation relationships for summary counts without rendering a second list', async () => {
    render(<DistributionView />)

    await waitFor(() => expect(mocks.listInvitees).toHaveBeenCalledTimes(1))
    expect(mocks.listCommissions).toHaveBeenCalledTimes(1)
    expect(screen.getByText('刚注册的邀请客户')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新数据' })).not.toBeInTheDocument()
  })

  it('switches between invited customers and distributors using backend relationship data', async () => {
    const user = userEvent.setup()
    mocks.listInvitees.mockResolvedValue({
      items: [
        {
          invitee_id: 77,
          invitee_name: '普通邀请客户',
          relationship: 'direct',
          registered_at: '2026-07-26T15:30:00+08:00',
        },
        {
          invitee_id: 88,
          invitee_name: '渠道分销商',
          relationship: 'distributor',
          registered_at: '2026-07-27T15:30:00+08:00',
        },
      ],
      total: 2,
    })

    render(<DistributionView />)

    expect(await screen.findByText('普通邀请客户')).toBeInTheDocument()
    expect(screen.queryByText('渠道分销商')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '邀请客户' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: '分销商' }))

    expect(screen.getByText('渠道分销商')).toBeInTheDocument()
    expect(screen.queryByText('普通邀请客户')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '分销商' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('已邀请分销商 1 个')).toBeInTheDocument()
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
    mocks.getDistributionOverview.mockResolvedValue({
      invite_code: 'DIST-CUSTOMER-001',
      distributor_code: 'ZZH-D-JAZ589JR',
    })
    render(<DistributionView />)

    await user.click(screen.getByRole('button', { name: '邀请渠道' }))

    expect(screen.getByRole('dialog', { name: '邀请渠道' })).toBeInTheDocument()
    expect(screen.getByLabelText('渠道邀请链接')).toHaveValue(
      `${window.location.origin}/login?invite_code=ZZH-D-JAZ589JR&invite_type=channel`,
    )
    expect(screen.queryByLabelText('渠道邀请二维码')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载二维码' })).not.toBeInTheDocument()
    expect(mocks.getDistributionOverview).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('对方通过该链接完成注册后，后端将按渠道邀请类型建立邀请关系。')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '关闭邀请渠道弹窗' }))
    await user.click(screen.getByRole('button', { name: '邀请渠道' }))
    await waitFor(() => expect(mocks.getDistributionOverview).toHaveBeenCalledTimes(2))
  })

  it('does not substitute the customer code when the channel endpoint omits a distributor code', async () => {
    const user = userEvent.setup()
    mocks.getDistributionOverview.mockResolvedValue({
      code: 'ZZH-MARKETING-001',
    })
    render(<DistributionView />)

    await user.click(screen.getByRole('button', { name: '邀请渠道' }))

    expect(await screen.findByText('后端未返回渠道邀请码')).toBeInTheDocument()
    expect(screen.queryByLabelText('渠道邀请链接')).not.toBeInTheDocument()
    expect(mocks.getDistributionOverview).toHaveBeenCalledTimes(1)
  })

  it('retries the channel endpoint without calling the customer-code endpoint', async () => {
    const user = userEvent.setup()
    mocks.getDistributionOverview
      .mockRejectedValueOnce(new Error('渠道接口暂不可用'))
      .mockResolvedValueOnce({ distributor_code: 'ZZH-D-RETRY-001' })
    render(<DistributionView />)

    await user.click(screen.getByRole('button', { name: '邀请渠道' }))
    expect(await screen.findByText('渠道接口暂不可用')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新获取' }))

    expect(await screen.findByLabelText('渠道邀请链接')).toHaveValue(
      `${window.location.origin}/login?invite_code=ZZH-D-RETRY-001&invite_type=channel`,
    )
    expect(mocks.getDistributionOverview).toHaveBeenCalledTimes(2)
  })

  it('keeps the rebate page visible when the sales identity is disabled', async () => {
    mocks.access.status = 'disabled'
    mocks.access.overview = { distributor_status: 'disabled', distributor_code: 'ZZH-D-JAZ589JR' }

    render(<DistributionView />)

    expect(screen.getByRole('heading', { name: '邀请收益' })).toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.listCommissions).toHaveBeenCalledTimes(1)
      expect(mocks.listInvitees).toHaveBeenCalledTimes(1)
    })
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
    const inviteeSection = screen.getByRole('heading', { name: '邀请客户' }).closest('section')
    expect(inviteeSection).not.toBeNull()
    const inviteeHeaders = within(inviteeSection as HTMLElement)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    const consumedIndex = inviteeHeaders.indexOf('累计消耗积分')
    expect(consumedIndex).toBeGreaterThanOrEqual(0)
    const inviteeCells = within(inviteeSection as HTMLElement).getAllByRole('cell')
    expect(inviteeCells[consumedIndex]).toHaveTextContent('---')
    expect(screen.getAllByText('0.00')).toHaveLength(2)
  })
})
