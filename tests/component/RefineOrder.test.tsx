import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import RefineOrder, { type RefineOrderSnapshot } from '@/components/smart/refine/RefineOrder'
import { estimateRefineCredits, REFINE_DURATIONS } from '@/utils/refineDelivery'

const order: RefineOrderSnapshot = {
  duration: 60,
  script: '测评视频',
  ratio: '16:9',
  resolution: '720p',
  referenceModel: 'Seedance 2.5',
  count: 1,
  deliveryTime: '明天 18:00 前',
  credits: 2250,
}

describe('精制订单', () => {
  it('根据同一订单显示参数和确认信息，并仅在用户确认时调用提交', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<RefineOrder order={order} onEdit={vi.fn()} onConfirm={onConfirm} />)

    expect(screen.getAllByText('1 分钟')).toHaveLength(2)
    expect(screen.getByText('测评视频')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '提交精制任务（T+1）' }))
    const dialog = screen.getByRole('dialog', { name: '确认提交精制任务？' })
    expect(within(dialog).getByText('2,250 积分（约 ¥45.00）')).toBeInTheDocument()
    expect(within(dialog).getByText('交付成片时')).toBeInTheDocument()
    expect(within(dialog).getByText('全额退回')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: '确认提交' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('允许返回修改及取消确认，提交中禁止关闭或再次提交', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onConfirm = vi.fn()
    const { rerender } = render(<RefineOrder order={order} onEdit={onEdit} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: '修改' }))
    expect(onEdit).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: '提交精制任务（T+1）' }))
    await user.click(screen.getByRole('button', { name: /取\s*消/ }))
    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '提交精制任务（T+1）' }))
    rerender(<RefineOrder order={order} submitting onEdit={onEdit} onConfirm={onConfirm} />)
    expect(screen.getByRole('button', { name: /取\s*消/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /确认提交/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '修改', hidden: true })).toBeDisabled()
  })

  it('按原型公式计算七档展示参考价格', () => {
    expect(REFINE_DURATIONS.map(estimateRefineCredits)).toEqual([563, 1125, 1688, 2250, 4500, 6750, 11250])
  })
})
