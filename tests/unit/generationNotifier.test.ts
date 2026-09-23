import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureNotificationPermission,
  getNotificationPermission,
  isPageInBackground,
  playNotificationSound,
  showGenerationNotification,
} from '@/utils/generationNotifier'

class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
  static instances: FakeNotification[] = []
  onclick: (() => void) | null = null
  close = vi.fn()
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeNotification.instances = []
  FakeNotification.permission = 'granted'
})

describe('generationNotifier', () => {
  it('浏览器不支持时报 unsupported，且不会抛错', async () => {
    vi.stubGlobal('Notification', undefined)
    expect(getNotificationPermission()).toBe('unsupported')
    expect(await ensureNotificationPermission()).toBe('unsupported')
    expect(showGenerationNotification({ title: 'x' })).toBeNull()
  })

  it('已授权时直接发通知，点击后关闭并回调', () => {
    vi.stubGlobal('Notification', FakeNotification)
    // jsdom 没实现 window.focus，会往控制台打「Not implemented」
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)
    const onClick = vi.fn()
    const notification = showGenerationNotification({ title: '生成完成', body: '海边', tag: 'n1', onClick })
    expect(notification).not.toBeNull()
    expect(FakeNotification.instances[0].options).toMatchObject({ body: '海边', tag: 'n1' })
    FakeNotification.instances[0].onclick?.()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(FakeNotification.instances[0].close).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalled()
    focus.mockRestore()
  })

  it('未授权时不发通知；权限为 default 才会去申请', async () => {
    vi.stubGlobal('Notification', FakeNotification)
    FakeNotification.permission = 'denied'
    expect(showGenerationNotification({ title: 'x' })).toBeNull()
    expect(await ensureNotificationPermission()).toBe('denied')
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()

    FakeNotification.permission = 'default'
    expect(await ensureNotificationPermission()).toBe('granted')
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('页面隐藏或失焦视为后台', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get')
    hidden.mockReturnValue(true)
    expect(isPageInBackground()).toBe(true)
    hidden.mockReturnValue(false)
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    expect(isPageInBackground()).toBe(true)
    hasFocus.mockReturnValue(true)
    expect(isPageInBackground()).toBe(false)
    hidden.mockRestore()
    hasFocus.mockRestore()
  })

  it('没有 AudioContext 时提示音静默跳过', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => playNotificationSound()).not.toThrow()
  })
})
