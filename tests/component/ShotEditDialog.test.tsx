import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShotEditDialog from '@/components/smart/ShotEditDialog/ShotEditDialog'

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function baseProps() {
  return {
    open: true,
    mode: 'insert' as const,
    onGenerate: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('ShotEditDialog', () => {
  it('renders only while open and exposes modal, form, and close semantics', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const { rerender } = render(<ShotEditDialog {...props} open={false} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<ShotEditDialog {...props} />)
    const dialog = screen.getByRole('dialog', { name: '新增分镜' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('textbox', { name: '分镜描述' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('enforces the empty boundary and submits trimmed text with Ctrl+Enter', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<ShotEditDialog {...props} onPolish={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: '分镜描述' })
    expect(screen.getByRole('button', { name: 'AI一键润色' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '生成分镜' })).toBeDisabled()

    await user.type(input, '  产品特写  ')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(props.onGenerate).toHaveBeenCalledWith('产品特写', [])
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('suppresses rapid duplicate generation before the controlled parent closes it', () => {
    const props = baseProps()
    render(<ShotEditDialog {...props} />)
    const input = screen.getByRole('textbox', { name: '分镜描述' })

    fireEvent.change(input, { target: { value: '产品特写' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })

    expect(props.onGenerate).toHaveBeenCalledOnce()
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('disables duplicate polishing, reports failure, and allows a successful retry', async () => {
    const user = userEvent.setup()
    const first = deferred<string>()
    const onPolish = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce('润色结果')
    render(<ShotEditDialog {...baseProps()} onPolish={onPolish} />)

    const input = screen.getByRole('textbox', { name: '分镜描述' })
    await user.type(input, '原始描述')
    await user.click(screen.getByRole('button', { name: 'AI一键润色' }))
    expect(screen.getByRole('button', { name: '润色中…' })).toBeDisabled()
    expect(onPolish).toHaveBeenCalledOnce()

    await act(async () => first.reject(new Error('服务繁忙')))
    expect(mocks.showToast).toHaveBeenCalledWith('AI 润色失败:服务繁忙', 'error')

    await user.click(screen.getByRole('button', { name: 'AI一键润色' }))
    await waitFor(() => expect(input).toHaveValue('润色结果'))
    expect(onPolish).toHaveBeenCalledTimes(2)
  })

  it('uploads references and recovers after one failure', async () => {
    const user = userEvent.setup()
    const onUpload = vi
      .fn()
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce({ url: 'https://cdn.example.com/ref.png', assetId: 8 })
    const props = baseProps()
    render(<ShotEditDialog {...props} onUpload={onUpload} />)

    const fileInput = screen.getByLabelText('上传素材文件')
    await user.upload(fileInput, new File(['bad'], 'bad.png', { type: 'image/png' }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('素材上传失败,请重试', 'error'))
    expect(screen.getByRole('button', { name: '生成分镜' })).toBeDisabled()

    await user.upload(fileInput, new File(['ok'], 'ok.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '移除' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '生成分镜' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '生成分镜' }))
    expect(props.onGenerate).toHaveBeenCalledWith('', ['https://cdn.example.com/ref.png'])
  })

  it('ignores a late polish success after close and reopen', async () => {
    const user = userEvent.setup()
    const oldRequest = deferred<string>()
    const onPolish = vi.fn(() => oldRequest.promise)
    const props = baseProps()
    const { rerender } = render(<ShotEditDialog {...props} onPolish={onPolish} />)

    await user.type(screen.getByRole('textbox', { name: '分镜描述' }), '旧会话')
    await user.click(screen.getByRole('button', { name: 'AI一键润色' }))
    rerender(<ShotEditDialog {...props} open={false} onPolish={onPolish} />)
    rerender(<ShotEditDialog {...props} onPolish={onPolish} />)
    const currentInput = screen.getByRole('textbox', { name: '分镜描述' })
    await user.type(currentInput, '新会话')

    await act(async () => oldRequest.resolve('迟到结果'))
    expect(currentInput).toHaveValue('新会话')
  })

  it('does not surface a late polish error from a closed session', async () => {
    const user = userEvent.setup()
    const oldRequest = deferred<string>()
    const onPolish = vi.fn(() => oldRequest.promise)
    const props = baseProps()
    const { rerender } = render(<ShotEditDialog {...props} onPolish={onPolish} />)

    await user.type(screen.getByRole('textbox', { name: '分镜描述' }), '旧会话')
    await user.click(screen.getByRole('button', { name: 'AI一键润色' }))
    rerender(<ShotEditDialog {...props} open={false} onPolish={onPolish} />)
    rerender(<ShotEditDialog {...props} onPolish={onPolish} />)

    await act(async () => oldRequest.reject(new Error('旧会话失败')))
    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'AI一键润色' })).toBeDisabled()
  })

  it('ignores a late upload success after close and reopen', async () => {
    const user = userEvent.setup()
    const oldRequest = deferred<{ url: string; assetId?: number }>()
    const onUpload = vi.fn(() => oldRequest.promise)
    const props = baseProps()
    const { rerender } = render(<ShotEditDialog {...props} onUpload={onUpload} />)

    await user.upload(screen.getByLabelText('上传素材文件'), new File(['old'], 'old.png', { type: 'image/png' }))
    rerender(<ShotEditDialog {...props} open={false} onUpload={onUpload} />)
    rerender(<ShotEditDialog {...props} onUpload={onUpload} />)

    await act(async () => oldRequest.resolve({ url: 'https://cdn.example.com/stale.png' }))
    expect(screen.queryByRole('button', { name: '移除' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成分镜' })).toBeDisabled()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })
})
