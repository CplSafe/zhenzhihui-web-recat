import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SubjectAssetDialog from '@/components/smart/SubjectAssetDialog/SubjectAssetDialog'

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const baseProps = () => ({
  open: true,
  name: '精华液瓶',
  kind: '产品',
  versions: [] as string[],
  defaultPrompt: '透明玻璃瓶',
  onClose: vi.fn(),
  onGenerate: vi.fn(async () => undefined),
  onSelect: vi.fn(),
})

describe('SubjectAssetDialog', () => {
  it('is absent while closed and exposes modal semantics while open', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const view = render(<SubjectAssetDialog {...props} open={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    view.rerender(<SubjectAssetDialog {...props} open />)
    const dialog = screen.getByRole('dialog', { name: '素材管理' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('closes from the close button and backdrop but not from the dialog body', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<SubjectAssetDialog {...props} />)
    const dialog = screen.getByRole('dialog', { name: '素材管理' })

    await user.click(dialog)
    expect(props.onClose).not.toHaveBeenCalled()
    await user.click(dialog.parentElement as HTMLElement)
    expect(props.onClose).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('refines the initial prompt, supports keyboard editing and ignores a late refine result after close', async () => {
    const user = userEvent.setup()
    const first = deferred<string>()
    const props = baseProps()
    const refinePrompt = vi.fn(() => first.promise)
    const view = render(<SubjectAssetDialog {...props} refinePrompt={refinePrompt} />)

    expect(screen.getByText('正在把生成意图优化为更干净的画面提示词…')).toBeInTheDocument()
    first.resolve('高透玻璃精华液瓶')
    const promptButton = await screen.findByRole('button', { name: '高透玻璃精华液瓶' })
    promptButton.focus()
    await user.keyboard('{Enter}')
    const input = screen.getByRole('textbox', { name: '生成提示词' })
    await user.clear(input)
    await user.type(input, '磨砂玻璃瓶')
    await user.tab()
    expect(screen.getByRole('button', { name: '磨砂玻璃瓶' })).toBeInTheDocument()

    const late = deferred<string>()
    view.rerender(<SubjectAssetDialog {...props} open={false} refinePrompt={() => late.promise} />)
    view.rerender(<SubjectAssetDialog {...props} open refinePrompt={() => late.promise} />)
    view.rerender(<SubjectAssetDialog {...props} open={false} refinePrompt={() => late.promise} />)
    late.resolve('迟到提示词')
    await Promise.resolve()
    expect(screen.queryByText('迟到提示词')).not.toBeInTheDocument()
  })

  it('auto-generates once with the refined prompt only when there are no versions', async () => {
    const props = baseProps()
    const refinePrompt = vi.fn(async () => '优化后的提示词')
    const view = render(<SubjectAssetDialog {...props} autoGen refinePrompt={refinePrompt} />)

    await waitFor(() =>
      expect(props.onGenerate).toHaveBeenCalledWith('优化后的提示词', {
        refImageUrls: undefined,
        carryCurrent: false,
      }),
    )
    expect(props.onGenerate).toHaveBeenCalledOnce()

    view.rerender(<SubjectAssetDialog {...props} autoGen refinePrompt={refinePrompt} />)
    await Promise.resolve()
    expect(props.onGenerate).toHaveBeenCalledOnce()

    const withVersions = baseProps()
    render(<SubjectAssetDialog {...withVersions} versions={['/version.png']} autoGen />)
    await Promise.resolve()
    expect(withVersions.onGenerate).not.toHaveBeenCalled()
  })

  it('prevents rapid duplicate generation calls', async () => {
    const user = userEvent.setup()
    const pending = deferred<void>()
    const props = baseProps()
    props.onGenerate.mockImplementation(() => pending.promise)
    render(<SubjectAssetDialog {...props} />)

    const button = screen.getByRole('button', { name: '生成分镜图' })
    await user.dblClick(button)

    expect(props.onGenerate).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '生成中…' })).toBeDisabled()
    pending.resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: '生成分镜图' })).toBeEnabled())
  })

  it('isolates a generation that settles after the dialog was closed and reopened', async () => {
    const user = userEvent.setup()
    const first = deferred<void>()
    const second = deferred<void>()
    const props = baseProps()
    props.onGenerate.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const view = render(<SubjectAssetDialog {...props} />)

    await user.click(screen.getByRole('button', { name: '生成分镜图' }))
    view.rerender(<SubjectAssetDialog {...props} open={false} />)
    view.rerender(<SubjectAssetDialog {...props} open />)
    const reopenedButton = screen.getByRole('button', { name: '生成分镜图' })
    expect(reopenedButton).toBeEnabled()
    await user.click(reopenedButton)
    expect(props.onGenerate).toHaveBeenCalledTimes(2)

    first.resolve()
    await Promise.resolve()
    expect(screen.getByRole('button', { name: '生成中…' })).toBeDisabled()
    second.resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: '生成分镜图' })).toBeEnabled())
  })

  it('selects multiple project references and passes them with carry-current generation', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(
      <SubjectAssetDialog
        {...props}
        currentImage="/current.png"
        projectImages={[
          { url: '/upload.png', source: 'upload' },
          { url: '/ai.png', source: 'ai' },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /添加参考图/ }))
    await user.click(screen.getByRole('button', { name: '选择我上传的图 1' }))
    await user.click(screen.getByRole('button', { name: '选择AI 生成的图 1' }))
    await user.click(screen.getByRole('button', { name: '完成选择参考图' }))
    await user.click(screen.getByRole('checkbox', { name: /携带当前图/ }))
    await user.click(screen.getByRole('button', { name: '修改生成' }))

    expect(props.onGenerate).toHaveBeenCalledWith('透明玻璃瓶', {
      refImageUrls: ['/upload.png', '/ai.png'],
      carryCurrent: true,
    })
  })

  it('selects a version or replacement without starting generation', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(
      <SubjectAssetDialog
        {...props}
        currentImage="/v1.png"
        versions={['/v1.png', '/v2.png']}
        projectImages={[{ url: '/replacement.png', source: 'upload' }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '版本 2' }))
    expect(props.onSelect).toHaveBeenCalledWith('/v2.png')
    await user.click(screen.getByRole('button', { name: '替换' }))
    await user.click(screen.getByRole('button', { name: '选择我上传的图 1' }))
    expect(props.onSelect).toHaveBeenLastCalledWith('/replacement.png')
    expect(props.onGenerate).not.toHaveBeenCalled()
  })
})
