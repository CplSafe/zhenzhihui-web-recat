import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShotList, { RetryableShotImage, SHOT_IMAGE_RETRY_DELAYS_MS } from '@/components/smart/ShotList/ShotList'

afterEach(() => vi.useRealTimers())

describe('RetryableShotImage', () => {
  it('recovers from a transient first load failure without reporting the shot as broken', () => {
    vi.useFakeTimers()
    const onLoad = vi.fn()
    const onFinalError = vi.fn()
    const onRetrying = vi.fn()
    render(
      <RetryableShotImage
        src="https://cdn.example.com/shot.png"
        alt="镜头1分镜图"
        onLoad={onLoad}
        onFinalError={onFinalError}
        onRetrying={onRetrying}
      />,
    )

    fireEvent.error(screen.getByRole('img', { name: '镜头1分镜图' }))
    expect(onFinalError).not.toHaveBeenCalled()
    expect(onRetrying).toHaveBeenCalledOnce()

    act(() => vi.advanceTimersByTime(SHOT_IMAGE_RETRY_DELAYS_MS[0]))
    const retryImage = screen.getByRole('img', { name: '镜头1分镜图' })
    expect(retryImage).toHaveAttribute('data-load-attempt', '1')
    fireEvent.load(retryImage)

    expect(onLoad).toHaveBeenCalledOnce()
    expect(onFinalError).not.toHaveBeenCalled()
  })

  it('reports a durable failure only after all bounded retries are exhausted', () => {
    vi.useFakeTimers()
    const onFinalError = vi.fn()
    render(
      <RetryableShotImage
        src="https://cdn.example.com/unavailable.png"
        alt="镜头2分镜图"
        onFinalError={onFinalError}
      />,
    )

    for (const delay of SHOT_IMAGE_RETRY_DELAYS_MS) {
      fireEvent.error(screen.getByRole('img', { name: '镜头2分镜图' }))
      expect(onFinalError).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(delay))
    }
    fireEvent.error(screen.getByRole('img', { name: '镜头2分镜图' }))

    expect(onFinalError).toHaveBeenCalledOnce()
  })
})

describe('ShotList hover rendering', () => {
  it('shows adjacent insert controls without rerendering every shot card', async () => {
    const user = userEvent.setup()
    const badgeOf = vi.fn(() => '待生成')
    render(
      <ShotList
        shots={[
          { id: 'shot-1', no: '镜头1', duration: '5s', desc: '第一镜', subjects: [] },
          { id: 'shot-2', no: '镜头2', duration: '5s', desc: '第二镜', subjects: [] },
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        onShotsChange={vi.fn()}
        badgeOf={badgeOf}
        showMoreMenu={false}
      />,
    )

    const beforeFirst = screen.getByRole('button', { name: '在镜头1前插入分镜' })
    const afterFirst = screen.getByRole('button', { name: '在镜头1后插入分镜' })
    const afterSecond = screen.getByRole('button', { name: '在镜头2后插入分镜' })
    const initialClass = afterFirst.className
    const badgeCallsAfterMount = badgeOf.mock.calls.length
    const secondCard = screen.getByText('镜头2').parentElement?.parentElement
    expect(secondCard).not.toBeNull()

    await user.hover(secondCard as HTMLElement)

    expect(beforeFirst).toHaveClass(initialClass)
    expect(afterFirst.className).not.toBe(initialClass)
    expect(afterSecond.className).not.toBe(initialClass)
    expect(badgeOf).toHaveBeenCalledTimes(badgeCallsAfterMount)

    await user.unhover(secondCard as HTMLElement)

    expect(afterFirst).toHaveClass(initialClass)
    expect(afterSecond).toHaveClass(initialClass)
    expect(badgeOf).toHaveBeenCalledTimes(badgeCallsAfterMount)
  })
})
