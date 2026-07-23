import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LazyMediaVideo, useMediaCardActivation } from '@/components/common/LazyMediaVideo'

let intersectionCallback: IntersectionObserverCallback

class IntersectionObserverMock implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0.01]
  disconnect = vi.fn()
  observe = vi.fn()
  takeRecords = vi.fn(() => [])
  unobserve = vi.fn()

  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback
  }
}

function ActivationHarness() {
  const { active, activationProps } = useMediaCardActivation()
  return (
    <div data-testid="card" data-active={String(active)} {...activationProps}>
      <button type="button">操作</button>
    </div>
  )
}

describe('LazyMediaVideo', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })

  it('attaches the source only after entering the viewport and stays paused at metadata preload', async () => {
    const onVisible = vi.fn()
    const { container } = render(<LazyMediaVideo src="https://cdn.example.test/card.mp4" onVisible={onVisible} />)
    const video = container.querySelector('video') as HTMLVideoElement

    expect(video).not.toHaveAttribute('src')

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true, target: video } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })

    await waitFor(() => expect(video).toHaveAttribute('src', 'https://cdn.example.test/card.mp4'))
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(onVisible).toHaveBeenCalledTimes(1)
  })

  it('plays only while explicitly active', async () => {
    const { container, rerender } = render(<LazyMediaVideo src="/media/card.mp4" active />)
    const video = container.querySelector('video') as HTMLVideoElement

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
    expect(video).toHaveAttribute('src', '/media/card.mp4')
    expect(video).toHaveAttribute('preload', 'auto')

    rerender(<LazyMediaVideo src="/media/card.mp4" active={false} />)
    await waitFor(() => expect(video).toHaveAttribute('preload', 'metadata'))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  })

  it('does not let visible media hold the initial document load open', async () => {
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const { container } = render(<LazyMediaVideo src="/media/initial.mp4" active />)
    const video = container.querySelector('video') as HTMLVideoElement

    expect(video).not.toHaveAttribute('src')
    readyState.mockReturnValue('complete')
    act(() => {
      window.dispatchEvent(new Event('load'))
    })

    await waitFor(() => expect(video).toHaveAttribute('src', '/media/initial.mp4'))
  })
})

describe('useMediaCardActivation', () => {
  it('activates a card for hover and keyboard focus', () => {
    render(<ActivationHarness />)
    const card = screen.getByTestId('card')
    const button = screen.getByRole('button', { name: '操作' })

    fireEvent.mouseEnter(card)
    expect(card).toHaveAttribute('data-active', 'true')
    fireEvent.mouseLeave(card)
    expect(card).toHaveAttribute('data-active', 'false')

    fireEvent.focus(button)
    expect(card).toHaveAttribute('data-active', 'true')
    fireEvent.blur(button, { relatedTarget: null })
    expect(card).toHaveAttribute('data-active', 'false')
  })
})
