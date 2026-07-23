import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  idleCallback: null as (() => void) | null,
  listBanners: vi.fn(),
  navigate: vi.fn(),
  preloadMedia: vi.fn(),
  swrFetch: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/api/banners', () => ({
  listBanners: mocks.listBanners,
}))

vi.mock('@/composables/useSwr', () => ({
  useSwr: () => ({ data: [], fromCache: false, loading: false, refresh: vi.fn() }),
}))

vi.mock('@/utils/swrCache', () => ({
  swrFetch: mocks.swrFetch,
}))

vi.mock('@/utils/mediaPreload', () => ({
  preloadMedia: mocks.preloadMedia,
}))

import SplashView from '@/views/SplashView'

const homeBanners = [
  {
    id: 1,
    title: '首页一',
    description: '',
    mediaUrl: 'https://cdn.example.com/home-first.jpg',
    mediaType: 'image' as const,
    linkUrl: '',
    position: 1,
  },
  {
    id: 2,
    title: '首页二',
    description: '',
    mediaUrl: 'https://cdn.example.com/home-second.mp4',
    mediaType: 'video' as const,
    linkUrl: '',
    position: 2,
  },
]

const loginBanners = [
  {
    id: 3,
    title: '登录页',
    description: '',
    mediaUrl: 'https://cdn.example.com/login-first.mp4',
    mediaType: 'video' as const,
    linkUrl: '',
    position: 1,
  },
]

describe('SplashView next-route warmup', () => {
  beforeEach(() => {
    mocks.idleCallback = null
    mocks.listBanners.mockImplementation(async (slug: string) => (slug === 'login' ? loginBanners : homeBanners))
    mocks.swrFetch.mockImplementation(async (_key: string, fetcher: () => Promise<unknown>) => ({
      data: await fetcher(),
      fromCache: false,
    }))
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: vi.fn((callback: () => void) => {
        mocks.idleCallback = callback
        return 1
      }),
    })
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: undefined,
    })
  })

  afterEach(() => {
    delete (window as any).requestIdleCallback
    delete (window as any).cancelIdleCallback
    delete (navigator as any).connection
  })

  it('waits for idle and warms only the first home banner', async () => {
    render(<SplashView />)

    expect(mocks.swrFetch).not.toHaveBeenCalled()
    expect(mocks.idleCallback).toBeTypeOf('function')

    act(() => mocks.idleCallback?.())

    await waitFor(() => expect(mocks.swrFetch).toHaveBeenCalledTimes(1))
    expect(mocks.swrFetch).toHaveBeenCalledWith('home-banners', expect.any(Function))
    expect(mocks.listBanners).toHaveBeenCalledWith('home')
    expect(mocks.preloadMedia).toHaveBeenCalledWith(
      [{ url: homeBanners[0].mediaUrl, type: homeBanners[0].mediaType }],
      { concurrency: 1 },
    )
    expect(mocks.preloadMedia).toHaveBeenCalledTimes(1)
  })

  it('warms login only after user intent and does not download media in save-data mode', async () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { effectiveType: '4g', saveData: true },
    })
    render(<SplashView />)

    const login = screen.getByRole('button', { name: '登录' })
    fireEvent.pointerEnter(login)
    expect(mocks.swrFetch).not.toHaveBeenCalled()

    act(() => mocks.idleCallback?.())

    await waitFor(() => expect(mocks.swrFetch).toHaveBeenCalledTimes(1))
    expect(mocks.swrFetch).toHaveBeenCalledWith('login-banners', expect.any(Function))
    expect(mocks.listBanners).toHaveBeenCalledWith('login')
    expect(mocks.preloadMedia).not.toHaveBeenCalled()

    fireEvent.click(login)
    expect(mocks.navigate).toHaveBeenCalledWith('/login')
    expect(mocks.swrFetch).toHaveBeenCalledTimes(1)
  })
})
