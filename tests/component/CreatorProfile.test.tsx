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

it('阅读临时协议并主动同意后提交创作者资料', async () => {
  vi.mocked(getCreator).mockResolvedValue({
    profile: null,
    agreement_version: 'v1',
    originality_version: 'o1',
    workflow_synced: false,
  })
  vi.mocked(saveCreator).mockResolvedValue({
    profile: null,
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
  await user.type(screen.getByLabelText(/真实姓名/), '小林')
  await user.selectOptions(screen.getByLabelText(/身份类型/), '在校学生')
  await user.type(screen.getByLabelText(/学校 \/ 机构/), '测试学校')
  await user.type(screen.getByLabelText(/联系手机/), '13800001111')
  await user.type(screen.getByLabelText(/联系邮箱/), 'test@example.com')
  await user.type(screen.getByLabelText(/擅长题材/), '悬疑{Enter}')
  expect(screen.getByLabelText('创作者入驻协议内容')).toHaveTextContent('临时版')
  await user.click(submit)
  expect(saveCreator).not.toHaveBeenCalled()
  await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
  await user.click(submit)
  expect(await screen.findByRole('heading', { name: '入驻成功' })).toBeInTheDocument()
  const body = vi.mocked(saveCreator).mock.calls[0][0]
  expect(body).toEqual(expect.objectContaining({ real_name: '小林', identity_type: 'student', specialties: ['悬疑'] }))
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
  await user.click(screen.getByRole('button', { name: '一键填入示例' }))
  await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
  await user.click(submit)
  expect(await screen.findByRole('alert')).toHaveTextContent('服务端仍要求同意协议')
  expect(screen.getByLabelText(/真实姓名/)).toHaveValue('林知夏')
})
