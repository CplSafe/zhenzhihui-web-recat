import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import RealPersonNoticeModal from '@/components/resource/RealPersonNoticeModal'

it('在同一个弹层查看隐私政策，返回后保留勾选和滚动状态且不自动授权', async () => {
  const onAgree = vi.fn()
  const onCancel = vi.fn()
  render(<RealPersonNoticeModal onAgree={onAgree} onCancel={onCancel} />)
  const body = screen.getByLabelText('阅读须知正文')
  body.scrollTop = 100
  const checkbox = screen.getByRole('checkbox')
  expect(screen.getByRole('button', { name: '同意并使用' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '《帧智汇隐私政策》' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog')).toHaveAccessibleName('帧智汇隐私政策')
  expect(screen.getByRole('status')).toHaveTextContent('暂未提供正式隐私政策正文')
  expect(screen.queryByText(/用户服务协议/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '返回授权告知' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '《帧智汇隐私政策》' })).toHaveFocus())
  expect(checkbox).not.toBeChecked()
  expect(body.scrollTop).toBe(100)
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: '《帧智汇隐私政策》' }))
  fireEvent.click(screen.getByRole('button', { name: '返回授权告知' }))
  expect(checkbox).toBeChecked()
  expect(onAgree).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '同意并使用' }))
  expect(onAgree).toHaveBeenCalledOnce()
})
