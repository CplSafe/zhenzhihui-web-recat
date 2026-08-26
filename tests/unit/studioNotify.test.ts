import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureNotifyPermission, isPageHidden, notifyGenerationDone } from '@/utils/studioNotify'

/** 构造一个可断言的 Notification 桩，记录每次实例化出的通知对象本身。 */
function stubNotification(permission: NotificationPermission, requestResult?: NotificationPermission) {
  const requestPermission = vi.fn(async () => requestResult ?? permission)

  class FakeNotification {
    static permission = permission
    static requestPermission = requestPermission
    title: string
    options: NotificationOptions
    onclick: (() => void) | null = null
    close = vi.fn()
    constructor(title: string, options: NotificationOptions = {}) {
      this.title = title
      this.options = options
      instances.push(this)
    }
  }

  const instances: FakeNotification[] = []
  vi.stubGlobal('Notification', FakeNotification)
  return { instances, requestPermission }
}

/** 设置页面可见性，通知只在页面不可见时才该发出。 */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

describe('studioNotify', () => {
  beforeEach(() => {
    vi.stubGlobal('focus', vi.fn())
    setVisibility('hidden')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('isPageHidden', () => {
    it('跟随 document.visibilityState', () => {
      setVisibility('hidden')
      expect(isPageHidden()).toBe(true)
      setVisibility('visible')
      expect(isPageHidden()).toBe(false)
    })
  })

  describe('ensureNotifyPermission', () => {
    it('已授权时直接放行，不再重复申请', async () => {
      const { requestPermission } = stubNotification('granted')
      await expect(ensureNotifyPermission()).resolves.toBe(true)
      expect(requestPermission).not.toHaveBeenCalled()
    })

    it('已拒绝时不再骚扰用户', async () => {
      const { requestPermission } = stubNotification('denied')
      await expect(ensureNotifyPermission()).resolves.toBe(false)
      expect(requestPermission).not.toHaveBeenCalled()
    })

    it('未决定时才申请权限', async () => {
      const { requestPermission } = stubNotification('default', 'granted')
      await expect(ensureNotifyPermission()).resolves.toBe(true)
      expect(requestPermission).toHaveBeenCalledTimes(1)
    })

    it('环境不支持 Notification 时安静返回 false', async () => {
      vi.stubGlobal('Notification', undefined)
      await expect(ensureNotifyPermission()).resolves.toBe(false)
    })
  })

  describe('notifyGenerationDone', () => {
    it('页面可见时不打扰（页面内已有 toast）', async () => {
      setVisibility('visible')
      const { instances } = stubNotification('granted')
      await expect(notifyGenerationDone({ count: 1, kind: 'image' })).resolves.toBe(false)
      expect(instances).toHaveLength(0)
    })

    it('页面在后台且已授权时发出通知', async () => {
      const { instances } = stubNotification('granted')
      await expect(notifyGenerationDone({ count: 2, kind: 'video', prompt: '一只猫' })).resolves.toBe(true)
      expect(instances).toHaveLength(1)
      expect(instances[0].title).toBe('视频生成完成')
      expect(instances[0].options.body).toBe('一只猫')
    })

    it('图片与视频用不同的文案', async () => {
      const { instances } = stubNotification('granted')
      await notifyGenerationDone({ count: 1, kind: 'image' })
      expect(instances[0].title).toBe('图片生成完成')
    })

    it('提示词过长时截断', async () => {
      const { instances } = stubNotification('granted')
      await notifyGenerationDone({ count: 1, kind: 'image', prompt: '猫'.repeat(100) })
      expect(instances[0].options.body).toHaveLength(61) // 60 字 + 省略号
      expect(instances[0].options.body?.endsWith('…')).toBe(true)
    })

    it('没有提示词时给出可点击的默认正文', async () => {
      const { instances } = stubNotification('granted')
      await notifyGenerationDone({ count: 1, kind: 'image', prompt: '   ' })
      expect(instances[0].options.body).toBe('点击查看生成结果')
    })

    it('用户拒绝权限时不发通知', async () => {
      const { instances } = stubNotification('denied')
      await expect(notifyGenerationDone({ count: 1, kind: 'image' })).resolves.toBe(false)
      expect(instances).toHaveLength(0)
    })

    it('申请权限期间用户切回页面则不再弹', async () => {
      // 申请是异步的，用户完全可能在这期间切回来——这时通知就成了打扰。
      const instances: unknown[] = []
      class FakeNotification {
        static permission: NotificationPermission = 'default'
        static requestPermission = vi.fn(async () => {
          setVisibility('visible')
          return 'granted' as NotificationPermission
        })
        onclick: (() => void) | null = null
        close = vi.fn()
        constructor() {
          instances.push(this)
        }
      }
      vi.stubGlobal('Notification', FakeNotification)

      await expect(notifyGenerationDone({ count: 1, kind: 'image' })).resolves.toBe(false)
      expect(instances).toHaveLength(0)
    })

    it('点击通知回到页面并触发定位回调', async () => {
      const { instances } = stubNotification('granted')
      const onClick = vi.fn()
      await notifyGenerationDone({ count: 1, kind: 'image', onClick })

      const notification = instances[0]
      notification.onclick?.()
      expect(onClick).toHaveBeenCalledTimes(1)
      expect(notification.close).toHaveBeenCalledTimes(1)
    })

    it('构造通知抛错时不影响生成主流程', async () => {
      class ThrowingNotification {
        static permission: NotificationPermission = 'granted'
        static requestPermission = vi.fn()
        constructor() {
          throw new Error('Illegal constructor')
        }
      }
      vi.stubGlobal('Notification', ThrowingNotification)
      await expect(notifyGenerationDone({ count: 1, kind: 'image' })).resolves.toBe(false)
    })

    it('环境不支持 Notification 时安静跳过', async () => {
      vi.stubGlobal('Notification', undefined)
      await expect(notifyGenerationDone({ count: 1, kind: 'image' })).resolves.toBe(false)
    })
  })
})
