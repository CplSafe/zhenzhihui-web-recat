import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppConfirmDialog from '@/components/AppConfirmDialog'
import AppToast from '@/components/AppToast'
import ComingSoonDialog from '@/components/ComingSoonDialog'
import InlineEdit from '@/components/common/InlineEdit'
import Markdown from '@/components/common/Markdown'
import UserAvatar from '@/components/common/UserAvatar'
import StepProgress from '@/components/smart/StepProgress/StepProgress'
import { useUiStore } from '@/stores/ui'

describe('global feedback primitives', () => {
  beforeEach(() => {
    useUiStore.getState().clearToast()
    useUiStore.setState({
      confirm: {
        visible: false,
        id: 0,
        title: '',
        message: '',
        inputEnabled: false,
        inputValue: '',
        inputLabel: '',
        inputPlaceholder: '',
        confirmLabel: '确认',
        cancelLabel: '取消',
        danger: false,
        resolve: null,
      },
      comingSoonOpen: false,
    })
  })

  it('renders success/info as status and errors as alerts', () => {
    const { rerender } = render(<AppToast />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    useUiStore.getState().showToast('保存成功', 'success', 0)
    rerender(<AppToast />)
    expect(screen.getByRole('status')).toHaveTextContent('保存成功')

    useUiStore.getState().showToast('保存失败', 'error', 0)
    rerender(<AppToast />)
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败')
  })

  it('resolves a boolean confirmation from click, Enter and Escape', async () => {
    const user = userEvent.setup()
    const first = useUiStore.getState().requestConfirm('删除这个项目？', { title: '删除项目', danger: true })
    const view = render(<AppConfirmDialog />)
    expect(screen.getByRole('alertdialog', { name: '删除项目' })).toHaveAttribute('aria-modal', 'true')
    await user.click(screen.getByRole('button', { name: '确认' }))
    await expect(first).resolves.toBe(true)

    const second = useUiStore.getState().requestConfirm('继续？')
    view.rerender(<AppConfirmDialog />)
    await user.keyboard('{Escape}')
    await expect(second).resolves.toBe(false)

    const third = useUiStore.getState().requestConfirm('继续？')
    view.rerender(<AppConfirmDialog />)
    await user.keyboard('{Enter}')
    await expect(third).resolves.toBe(true)
  })

  it('trims prompt input and returns null on cancel', async () => {
    const user = userEvent.setup()
    const first = useUiStore.getState().requestConfirm('团队名称', {
      inputEnabled: true,
      inputLabel: '新团队名称',
      inputValue: ' 原名称 ',
    })
    const view = render(<AppConfirmDialog />)
    const input = screen.getByRole('textbox', { name: '新团队名称' })
    await user.clear(input)
    await user.type(input, '  新团队  {Enter}')
    await expect(first).resolves.toBe('新团队')

    const second = useUiStore.getState().requestConfirm('团队名称', { inputEnabled: true })
    view.rerender(<AppConfirmDialog />)
    await user.click(screen.getByRole('button', { name: '取消' }))
    await expect(second).resolves.toBeNull()
  })

  it('closes the coming-soon modal by button, Escape and backdrop', async () => {
    const user = userEvent.setup()
    const view = render(<ComingSoonDialog />)

    for (const close of ['button', 'escape', 'backdrop']) {
      useUiStore.getState().openComingSoon()
      view.rerender(<ComingSoonDialog />)
      const dialog = screen.getByRole('dialog', { name: '功能待开放' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      if (close === 'button') await user.click(screen.getByRole('button', { name: '我知道了' }))
      if (close === 'escape') await user.keyboard('{Escape}')
      if (close === 'backdrop') await user.click(dialog.parentElement as HTMLElement)
      expect(screen.queryByRole('dialog', { name: '功能待开放' })).not.toBeInTheDocument()
    }
  })
})

describe('InlineEdit', () => {
  it.each(['Enter', ' '])('can enter edit mode from the keyboard with %p', async (key) => {
    const user = userEvent.setup()
    render(<InlineEdit value="镜头一" onCommit={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: '镜头一' })
    trigger.focus()
    await user.keyboard(key === 'Enter' ? '{Enter}' : ' ')
    expect(screen.getByRole('textbox')).toHaveValue('镜头一')
  })

  it('commits changed text on Enter and does not emit an unchanged value', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    const view = render(<InlineEdit value="原值" onCommit={onCommit} />)

    await user.dblClick(screen.getByRole('button', { name: '原值' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '新值{Enter}')
    expect(onCommit).toHaveBeenCalledWith('新值')

    view.rerender(<InlineEdit value="原值" onCommit={onCommit} />)
    await user.dblClick(screen.getByRole('button', { name: '原值' }))
    await user.keyboard('{Enter}')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('filters numeric input and cancels changes with Escape', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<InlineEdit value="3" numeric trigger="click" onCommit={onCommit} />)
    await user.click(screen.getByRole('button', { name: '3' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'a4.5b')
    expect(input).toHaveValue('4.5')
    await user.keyboard('{Escape}')
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument()
  })

  it('supports Shift+Enter in multiline mode and commits on blur', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<InlineEdit value="第一行" multiline onCommit={onCommit} />)
    await user.dblClick(screen.getByRole('button', { name: '第一行' }))
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, '{Shift>}{Enter}{/Shift}第二行')
    fireEvent.blur(textarea)
    expect(onCommit).toHaveBeenCalledWith('第一行\n第二行')
  })
})

describe('display primitives', () => {
  it('falls back from a broken avatar and resets when the URL changes', () => {
    const view = render(<UserAvatar src="/broken.png" name=" alice " alt="用户头像" />)
    fireEvent.error(screen.getByRole('img', { name: '用户头像' }))
    expect(screen.getByText('A')).toBeInTheDocument()

    view.rerender(<UserAvatar src="/new.png" name=" alice " alt="用户头像" />)
    expect(screen.getByRole('img', { name: '用户头像' })).toHaveAttribute('src', '/new.png')
  })

  it('uses a question mark for a blank fallback name', () => {
    render(<UserAvatar src="" name="   " />)
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('renders GFM while keeping raw HTML inert', () => {
    const { container } = render(<Markdown>{'~~删除~~\n\n<script>window.hacked=true</script>'}</Markdown>)
    expect(container.querySelector('del')).toHaveTextContent('删除')
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('<script>window.hacked=true</script>')).toBeInTheDocument()
  })

  it('only enables reached steps and announces the active step', async () => {
    const user = userEvent.setup()
    const onStepClick = vi.fn()
    render(
      <StepProgress
        current={1}
        clickableMax={1}
        onStepClick={onStepClick}
        steps={[
          { key: 'script', label: '分镜脚本' },
          { key: 'assets', label: '准备素材' },
          { key: 'video', label: '生成视频' },
        ]}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('已完成')
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[2]).toBeDisabled()
    await user.click(items[0])
    expect(onStepClick).toHaveBeenCalledWith(0)
  })
})
