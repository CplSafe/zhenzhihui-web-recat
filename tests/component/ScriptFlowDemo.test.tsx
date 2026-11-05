import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ScriptFlowDemo } from '@/views/ScriptFlowDemo'

describe('剧本创意本机演示', () => {
  it('提示缺少必填项，并在提交后展示只读内容', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ScriptFlowDemo owner="test-user" />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: '提交创意' }))
    expect(screen.getByRole('alert')).toHaveTextContent('剧本文档附件')
    expect(screen.getByRole('alert')).toHaveTextContent('申请人、学校')
    await user.type(screen.getByLabelText(/申请人/), '测试申请人')
    await user.type(screen.getByLabelText(/学校/), '测试学校')
    await user.type(screen.getByLabelText(/剧名/), '测试剧名')
    await user.type(screen.getByLabelText(/题材/), '悬疑')
    await user.type(screen.getByLabelText(/剧情简介/), '故事简介')
    await user.upload(
      screen.getByLabelText(/剧本文档附件/),
      new File(['测试'], '故事.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    )
    await user.click(screen.getByRole('button', { name: '提交创意' }))
    expect(screen.getByRole('heading', { name: '审核中' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已提交内容（只读）' })).toBeInTheDocument()
    expect(screen.getByText('故事.docx')).toBeInTheDocument()
  })
  it('示例填充保留附件必填，审核中不显示模拟审核操作', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ScriptFlowDemo owner="second-user" />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: '一键填入示例' }))
    expect(screen.getByLabelText(/剧名/)).toHaveValue('血月禁域：双王血契')
    expect(screen.getByRole('alert')).toHaveTextContent('请自行选择附件')
    await user.type(screen.getByLabelText(/申请人/), '测试申请人')
    await user.type(screen.getByLabelText(/学校/), '测试学校')
    await user.upload(screen.getByLabelText(/剧本文档附件/), new File(['测试'], '故事.docx'))
    await user.click(screen.getByRole('button', { name: '提交创意' }))
    expect(screen.queryByRole('button', { name: '模拟审核通过' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '模拟打回' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤回提交' })).toBeInTheDocument()
  })
})
