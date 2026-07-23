import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BannerVideo } from '@/views/HomeView'

const matchMediaMock = vi.mocked(window.matchMedia)
const defaultMatchMediaImplementation = matchMediaMock.getMockImplementation()

describe('BannerVideo', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (defaultMatchMediaImplementation) {
      matchMediaMock.mockImplementation(defaultMatchMediaImplementation)
    }
  })

  it('does not block initial load but stops waiting when another resource keeps load pending', async () => {
    vi.useFakeTimers()
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const { container } = render(
      <BannerVideo src="https://cdn.example.test/hero.mp4" active visible onDone={vi.fn()} />,
    )
    const video = container.querySelector('video') as HTMLVideoElement

    expect(video).not.toHaveAttribute('src')
    act(() => {
      vi.advanceTimersByTime(1199)
    })
    expect(video).not.toHaveAttribute('src')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(video).toHaveAttribute('src', 'https://cdn.example.test/hero.mp4')
    readyState.mockRestore()
  })

  it('attaches on window load and does not autoplay when reduced motion is requested', async () => {
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    matchMediaMock.mockImplementation(
      (query: string) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    )
    const { container } = render(<BannerVideo src="/hero.mp4" active visible onDone={vi.fn()} />)
    const video = container.querySelector('video') as HTMLVideoElement

    act(() => {
      window.dispatchEvent(new Event('load'))
    })

    await waitFor(() => expect(video).toHaveAttribute('src', '/hero.mp4'))
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()

    readyState.mockRestore()
  })
})
