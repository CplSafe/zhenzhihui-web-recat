import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DraftSaveIndicator from '@/components/common/DraftSaveIndicator'

describe('DraftSaveIndicator', () => {
  it('shows a non-retryable alert when another editor changed creative content', () => {
    render(<DraftSaveIndicator status="conflict" onRetry={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('其他页面已修改，未覆盖云端')
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('keeps the normal retry action for transport errors', async () => {
    const onRetry = vi.fn()
    render(<DraftSaveIndicator status="error" onRetry={onRetry} />)

    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
