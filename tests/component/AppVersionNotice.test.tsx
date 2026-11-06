import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppVersionNotice from '@/components/common/AppVersionNotice'
import { registerUpdateDraftSaver } from '@/utils/updateDraftRegistry'

afterEach(() => vi.unstubAllGlobals())

describe('系统更新提示', () => {
  it('版本一致或检查失败时不打断用户', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'current' }) }))
    render(<AppVersionNotice enabled currentVersion="current" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByRole('status', { name: '系统更新提示' })).not.toBeInTheDocument()
  })

  it('检测到新版本后可暂时关闭，并在更新到另一版本时再次提示', async () => {
    const fetchVersion = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 'next' }) })
    vi.stubGlobal('fetch', fetchVersion)
    const user = userEvent.setup()
    render(<AppVersionNotice enabled currentVersion="current" />)
    expect(await screen.findByRole('status', { name: '系统更新提示' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '稍后再说' }))
    expect(screen.queryByRole('status', { name: '系统更新提示' })).not.toBeInTheDocument()
    fetchVersion.mockResolvedValue({ ok: true, json: async () => ({ version: 'later' }) })
    fireEvent(document, new Event('visibilitychange'))
    expect(await screen.findByRole('status', { name: '系统更新提示' })).toBeInTheDocument()
  })

  it('网络异常时不展示更新提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<AppVersionNotice enabled currentVersion="current" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByRole('status', { name: '系统更新提示' })).not.toBeInTheDocument()
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
