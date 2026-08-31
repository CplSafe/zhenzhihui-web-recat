import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasRenameNodeDialog from '@/components/canvas/CanvasRenameNodeDialog'

describe('CanvasRenameNodeDialog', () => {
  it('自动聚焦当前名称并通过回车提交新名称', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(<CanvasRenameNodeDialog currentName="产品主图" defaultName="图片" onClose={vi.fn()} onConfirm={onConfirm} />)

    const input = screen.getByRole('textbox', { name: '节点名称' })
    expect(input).toHaveFocus()
    expect(input).toHaveValue('产品主图')

    await user.clear(input)
    await user.type(input, '镜头一{Enter}')
    expect(onConfirm).toHaveBeenCalledWith('镜头一')
  })

  it('允许留空恢复默认名称，并支持 Esc 取消', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    render(
      <CanvasRenameNodeDialog currentName="自定义名称" defaultName="视频" onClose={onClose} onConfirm={onConfirm} />,
    )

    await user.clear(screen.getByRole('textbox', { name: '节点名称' }))
    await user.click(screen.getByRole('button', { name: '确认修改' }))
    expect(onConfirm).toHaveBeenCalledWith('')

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
