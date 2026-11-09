import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { JoinPreview } from '@/views/ScriptPrototypeSections'
import { getCreator, saveCreator } from '@/api/studentApplications'

vi.mock('@/api/studentApplications', () => ({ getCreator: vi.fn(), saveCreator: vi.fn() }))
afterEach(() => {
  vi.clearAllMocks()
})

it('查看入驻协议并主动同意后提交创作者资料', async () => {
  vi.mocked(getCreator).mockResolvedValue({
    profile: null,
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: false,
  })
  vi.mocked(saveCreator).mockImplementation(async (profile) => ({
    profile,
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: true,
  }))
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <JoinPreview user={{ id: 'first' }} />
    </MemoryRouter>,
  )
  const submit = await screen.findByRole('button', { name: '提交入驻信息' })
  await vi.waitFor(() => expect(submit).toBeEnabled())
  await user.type(screen.getByLabelText(/真实姓名/), '小林')
  await user.selectOptions(screen.getByLabelText(/学生状态/), '在校学生')
  await user.selectOptions(screen.getByLabelText(/创作身份/), '自然流创作者')
  await user.type(screen.getByLabelText(/学校全称/), '测试学校')
  await user.selectOptions(screen.getByLabelText('省 / 直辖市'), '山东省')
  await user.selectOptions(screen.getByLabelText('城市'), '济宁市')
  await user.type(screen.getByLabelText(/联系手机/), '13800001111')
  await user.type(screen.getByLabelText(/联系邮箱/), 'test@example.com')
  await user.type(screen.getByLabelText(/擅长题材/), '悬疑{Enter}')
  expect(screen.getByRole('link', { name: '《创作者入驻协议》' })).toHaveAttribute(
    'href',
    '/script-ideas/creator-agreement',
  )
  expect(screen.queryByText('创作者入驻协议（临时版）')).not.toBeInTheDocument()
  await user.click(submit)
  expect(saveCreator).not.toHaveBeenCalled()
  await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
  await user.click(submit)
  expect(await screen.findByRole('heading', { name: '入驻成功' })).toBeInTheDocument()
  const body = vi.mocked(saveCreator).mock.calls[0][0]
  expect(body).toEqual(
    expect.objectContaining({
      real_name: '小林',
      identity_type: 'student',
      student_status: 'student',
      creator_type: 'creator',
      specialties: ['悬疑'],
    }),
  )
  expect(body.agreement_accepted).toBe(true)
  expect(body.agreement_version).toBe('v1')
})

it('服务端拒绝时保留输入并显示错误', async () => {
  vi.mocked(getCreator).mockResolvedValue({
    profile: null,
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: false,
  })
  vi.mocked(saveCreator).mockRejectedValue(new Error('服务端仍要求同意协议'))
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <JoinPreview user={{ id: 'first' }} />
    </MemoryRouter>,
  )
  const submit = await screen.findByRole('button', { name: '提交入驻信息' })
  await vi.waitFor(() => expect(submit).toBeEnabled())
  expect(screen.queryByRole('button', { name: '一键填入示例' })).not.toBeInTheDocument()
  await user.type(screen.getByLabelText(/真实姓名/), '林知夏')
  await user.selectOptions(screen.getByLabelText(/学生状态/), '在校学生')
  await user.selectOptions(screen.getByLabelText(/创作身份/), '自然流创作者')
  await user.type(screen.getByLabelText(/学校全称/), '测试学校')
  await user.selectOptions(screen.getByLabelText('省 / 直辖市'), '山东省')
  await user.selectOptions(screen.getByLabelText('城市'), '济宁市')
  await user.type(screen.getByLabelText(/联系手机/), '13800001111')
  await user.type(screen.getByLabelText(/联系邮箱/), 'test@example.com')
  await user.type(screen.getByLabelText(/擅长题材/), '悬疑{Enter}')
  await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
  await user.click(submit)
  expect(await screen.findByRole('alert')).toHaveTextContent('服务端仍要求同意协议')
  expect(screen.getByLabelText(/真实姓名/)).toHaveValue('林知夏')
})

it('切换学生状态清空原分支，毕业后可不填机构并保存两个维度', async () => {
  vi.mocked(getCreator).mockResolvedValue({
    profile: null,
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: false,
  })
  vi.mocked(saveCreator).mockImplementation(async (profile) => ({
    profile,
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: true,
  }))
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <JoinPreview user={{ id: 'first' }} />
    </MemoryRouter>,
  )
  const submit = await screen.findByRole('button', { name: '提交入驻信息' })
  await vi.waitFor(() => expect(submit).toBeEnabled())
  await user.type(screen.getByLabelText(/真实姓名/), '林知夏')
  await user.selectOptions(screen.getByLabelText(/学生状态/), '在校学生')
  await user.selectOptions(screen.getByLabelText(/创作身份/), '团队编剧')
  await user.type(screen.getByLabelText(/学校全称/), '测试大学')
  await user.type(screen.getByLabelText(/年级 \/ 专业/), '大三')
  await user.selectOptions(screen.getByLabelText(/学生状态/), '已毕业')
  expect(screen.queryByLabelText(/学校全称/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/年级 \/ 专业/)).not.toBeInTheDocument()
  expect(screen.getByLabelText(/机构 \/ 公司/)).toHaveValue('')
  expect(screen.getByLabelText(/机构 \/ 公司/)).not.toBeRequired()
  await user.selectOptions(screen.getByLabelText('省 / 直辖市'), '山东省')
  await user.selectOptions(screen.getByLabelText('城市'), '济宁市')
  await user.type(screen.getByLabelText(/联系手机/), '13800001111')
  await user.type(screen.getByLabelText(/联系邮箱/), 'test@example.com')
  await user.type(screen.getByLabelText(/擅长题材/), '悬疑{Enter}')
  await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
  await user.click(submit)
  expect(await screen.findByRole('heading', { name: '入驻成功' })).toBeInTheDocument()
  expect(vi.mocked(saveCreator).mock.calls[0][0]).toEqual(
    expect.objectContaining({
      identity_type: 'team',
      student_status: 'graduated',
      creator_type: 'team',
      school: '',
      grade_major: '',
    }),
  )
})

it('服务端未回传新字段时保留表单并提示可能部分保存', async () => {
  vi.mocked(getCreator).mockResolvedValue({
    profile: null,
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: false,
  })
  vi.mocked(saveCreator).mockResolvedValue({
    profile: {
      real_name: '林知夏',
      identity_type: 'student',
      school: '测试大学',
      phone: '13800001111',
      email: 'test@example.com',
      specialties: ['悬疑'],
    },
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: true,
  })
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <JoinPreview user={{ id: 'first' }} />
    </MemoryRouter>,
  )
  const submit = await screen.findByRole('button', { name: '提交入驻信息' })
  await vi.waitFor(() => expect(submit).toBeEnabled())
  await user.type(screen.getByLabelText(/真实姓名/), '林知夏')
  await user.selectOptions(screen.getByLabelText(/学生状态/), '在校学生')
  await user.selectOptions(screen.getByLabelText(/创作身份/), '自然流创作者')
  await user.type(screen.getByLabelText(/学校全称/), '测试大学')
  await user.selectOptions(screen.getByLabelText('省 / 直辖市'), '山东省')
  await user.selectOptions(screen.getByLabelText('城市'), '济宁市')
  await user.type(screen.getByLabelText(/联系手机/), '13800001111')
  await user.type(screen.getByLabelText(/联系邮箱/), 'test@example.com')
  await user.type(screen.getByLabelText(/擅长题材/), '悬疑{Enter}')
  await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
  await user.click(submit)
  expect(await screen.findByRole('alert')).toHaveTextContent('资料可能已部分保存')
  expect(screen.getByLabelText(/学校全称/)).toHaveValue('测试大学')
  expect(screen.queryByRole('heading', { name: '入驻成功' })).not.toBeInTheDocument()
})

it('省市联动会清除旧城市，并支持填写列表以外的地区', async () => {
  vi.mocked(getCreator).mockResolvedValue({
    profile: null,
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: false,
  })
  vi.mocked(saveCreator).mockImplementation(async (profile) => ({
    profile,
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: true,
  }))
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <JoinPreview user={{ id: 'first' }} />
    </MemoryRouter>,
  )
  const submit = await screen.findByRole('button', { name: '提交入驻信息' })
  await vi.waitFor(() => expect(submit).toBeEnabled())
  const province = screen.getByLabelText('省 / 直辖市')
  const city = screen.getByLabelText('城市')
  expect(city).toBeDisabled()
  await user.selectOptions(province, '山东省')
  await user.selectOptions(city, '济宁市')
  await user.selectOptions(province, '北京市')
  expect(city).toHaveValue('')
  await user.selectOptions(province, '其他地区')
  await user.selectOptions(city, '其他城市')
  await user.type(screen.getByLabelText(/省份 \/ 地区名称/), '海外')
  await user.type(screen.getByLabelText(/城市名称/), '伦敦')
  await user.type(screen.getByLabelText(/真实姓名/), '林知夏')
  await user.selectOptions(screen.getByLabelText(/学生状态/), '已毕业')
  await user.selectOptions(screen.getByLabelText(/创作身份/), '自由职业')
  await user.type(screen.getByLabelText(/联系手机/), '13800001111')
  await user.type(screen.getByLabelText(/联系邮箱/), 'test@example.com')
  await user.type(screen.getByLabelText(/擅长题材/), '悬疑{Enter}')
  await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
  await user.click(submit)
  expect(await screen.findByRole('heading', { name: '入驻成功' })).toBeInTheDocument()
  expect(vi.mocked(saveCreator).mock.calls[0][0]).toEqual(expect.objectContaining({ province: '海外', city: '伦敦' }))
})
