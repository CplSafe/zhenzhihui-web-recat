import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppVersionNotice from '@/components/common/AppVersionNotice'
import { registerUpdateDraftSaver } from '@/utils/updateDraftRegistry'

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

describe('系统更新提示', () => {
  it('Escape dismisses the centered dialog without saving or refreshing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'next' }) }))
    const save = vi.fn(() => true)
    const unregister = registerUpdateDraftSaver(save)
    try {
      render(<AppVersionNotice enabled currentVersion="current" />)
      const dialog = await screen.findByRole('dialog', { name: '系统更新提示' })
      expect(dialog).toHaveAttribute('open')
      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
      fireEvent(dialog, new Event('cancel', { cancelable: true }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(save).not.toHaveBeenCalled()
    } finally {
      unregister()
    }
  })

  it('版本一致或检查失败时不打断用户', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'current' }) }))
    render(<AppVersionNotice enabled currentVersion="current" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: '系统更新提示' })).not.toBeInTheDocument()
  })

  it('检测到新版本后可暂时关闭，并在更新到另一版本时再次提示', async () => {
    const fetchVersion = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'next' }) })
    vi.stubGlobal('fetch', fetchVersion)
    const user = userEvent.setup()
    render(<AppVersionNotice enabled currentVersion="current" />)
    expect(await screen.findByRole('dialog', { name: '系统更新提示' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '稍后再说' }))
    expect(screen.queryByRole('dialog', { name: '系统更新提示' })).not.toBeInTheDocument()
    fetchVersion.mockResolvedValue({ ok: true, json: async () => ({ version: 'later' }) })
    fireEvent(document, new Event('visibilitychange'))
    expect(await screen.findByRole('dialog', { name: '系统更新提示' })).toBeInTheDocument()
  })

  it('网络异常时不展示更新提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<AppVersionNotice enabled currentVersion="current" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: '系统更新提示' })).not.toBeInTheDocument()
  })

  it('草稿无法保存时留在当前页面并提示用户', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'next' }) }))
    const unregister = registerUpdateDraftSaver(() => false)
    try {
      const user = userEvent.setup()
      render(<AppVersionNotice enabled currentVersion="current" />)
      await user.click(await screen.findByRole('button', { name: '立即刷新' }))
      expect(screen.getByRole('alert')).toHaveTextContent('草稿保存失败')
    } finally {
      unregister()
    }
  })
})
