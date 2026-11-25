import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasFailureDetails from '@/components/canvas/CanvasFailureDetails'
import CanvasNodeFailure from '@/components/canvas/CanvasNodeFailure'

describe('canvas failure details', () => {
  it('opens on demand and copies the exact task ID and complete diagnostic information', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const taskId = '20261009175303221234538'
    render(
      <CanvasFailureDetails
        data={{
          taskFailure: {
            taskId,
            requestId: 'req-1',
            message: '审核失败',
            stage: 'task',
            failedAt: '2026-10-09T08:00:00Z',
          },
        }}
      />,
    )
    expect(screen.queryByText(taskId)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看详情' }))
    expect(screen.getByText(taskId)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '复制 TaskID' }))
    expect(writeText).toHaveBeenLastCalledWith(taskId)
    await user.click(screen.getByRole('button', { name: '复制排查信息' }))
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('RequestID：req-1'))
  })

  it('does not invent a task ID for uncertain submissions and keeps previous failure details', async () => {
    const user = userEvent.setup()
    render(
      <CanvasFailureDetails
        data={{
          taskFailure: {
            message: '网络超时',
            submissionId: 'submit-1',
            stage: 'unknown',
            failedAt: '2026-10-09T08:01:00Z',
          },
          taskFailureHistory: [{ message: '之前失败', taskId: '41', stage: 'task', failedAt: '2026-10-09T08:00:00Z' }],
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: '查看详情' }))
    expect(screen.getByText('未取得任务编号')).toBeInTheDocument()
    expect(screen.getByText('任务状态待确认，请勿反复新建任务')).toBeInTheDocument()
    await user.click(screen.getByText('之前的失败记录（1）'))
    await waitFor(() => expect(screen.getByText('41').closest('details')).toHaveAttribute('open'))
  })

  it('renders a pending submission and a legacy history record without a stage', async () => {
    const user = userEvent.setup()
    render(
      <CanvasNodeFailure
        reason="等待任务回执"
        detailsData={{
          taskStatus: 'submission_unknown',
          taskIdempotencyKey: 'submit-2',
          taskRequestId: 'request-2',
          taskFailureHistory: [{ message: '旧错误', taskId: '73' }],
        }}
      />,
    )
    expect(screen.getByText('提交状态待确认')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看详情' }))
    expect(screen.getByRole('dialog', { name: '提交状态详情' })).toBeInTheDocument()
    expect(screen.getByText('状态更新时间')).toBeInTheDocument()
    expect(screen.getByText('submit-2')).toBeInTheDocument()
    expect(screen.getByText('request-2')).toBeInTheDocument()
    await user.click(screen.getByText('之前的失败记录（1）'))
    await waitFor(() => expect(screen.getByText('任务已创建').closest('details')).toHaveAttribute('open'))
  })
})
