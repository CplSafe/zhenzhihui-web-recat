import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgreementModal from '@/components/auth/AgreementModal'
import HotCopyCaseModal from '@/components/hotcopy/HotCopyCaseModal/HotCopyCaseModal'

describe('AgreementModal', () => {
  it('requires agreement, exposes modal semantics, and submits the uncontrolled choice', async () => {
    const user = userEvent.setup()
    const onAgree = vi.fn()
    const onAgreedChange = vi.fn()
    render(<AgreementModal onAgree={onAgree} onAgreedChange={onAgreedChange} />)

    const dialog = screen.getByRole('dialog', { name: '"帧智汇"用户服务协议' })
    const checkbox = screen.getByRole('checkbox', { name: /我已阅读并同意/ })
    const confirm = screen.getByRole('button', { name: '同意并继续' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()
    expect(confirm).toBeDisabled()

    await user.click(checkbox)
    expect(onAgreedChange).toHaveBeenCalledWith(true)
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(onAgree).toHaveBeenCalledTimes(1)
  })

  it('keeps controlled state authoritative and closes from Escape, cancel, or the backdrop only', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onAgreedChange = vi.fn()
    const view = render(<AgreementModal agreed={false} onCancel={onCancel} onAgreedChange={onAgreedChange} />)

    await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }))
    expect(onAgreedChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: '同意并继续' })).toBeDisabled()

    view.rerender(<AgreementModal agreed onCancel={onCancel} onAgreedChange={onAgreedChange} />)
    expect(screen.getByRole('button', { name: '同意并继续' })).toBeEnabled()

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '不同意' }))
    fireEvent.click(screen.getByRole('dialog'))
    expect(onCancel).toHaveBeenCalledTimes(2)

    fireEvent.click(view.container.firstElementChild as Element)
    expect(onCancel).toHaveBeenCalledTimes(3)
  })
})

describe('HotCopyCaseModal', () => {
  it('renders nothing without a tab and exposes a focused, Escape-closeable dialog when opened', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const view = render(<HotCopyCaseModal tab={null} onClose={onClose} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    view.rerender(<HotCopyCaseModal tab="remake" onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: '同款翻拍案例' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()
    expect(screen.getByRole('img', { name: '同款翻拍案例' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '关闭' }))
    fireEvent.click(dialog.parentElement as Element)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('selects the replica case artwork', () => {
    render(<HotCopyCaseModal tab="replica" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: '精准复刻案例' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '精准复刻案例' })).toBeInTheDocument()
  })
})
