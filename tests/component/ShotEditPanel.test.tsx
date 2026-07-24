import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShotEditPanel from '@/components/smart/ShotEditPanel/ShotEditPanel'
import type { Shot } from '@/components/smart/ScriptStoryboardTable'

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

const makeShot = (patch: Partial<Shot> = {}): Shot => ({
  id: 'shot-1',
  no: '镜头1',
  duration: '5s',
  desc: '原始分镜描述',
  subjects: [{ tag: '@产品', image: 'https://cdn.example.com/product.png' }],
  image: 'https://cdn.example.com/current.png',
  imageAssetId: 30,
  imagePrompt: '原始提示词',
  imageVersions: [
    { url: 'https://cdn.example.com/v1.png', assetId: 11, prompt: '版本一提示词' },
    { url: 'https://cdn.example.com/v2.png', assetId: 12, prompt: '版本二提示词' },
  ],
  line: '原台词',
  subtitle: '原字幕',
  sfx: '原音效',
  ...patch,
})

function textField(title: string) {
  const root = screen.getByText(title).parentElement?.parentElement
  if (!root) throw new Error(`找不到字段: ${title}`)
  return within(root)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => vi.clearAllMocks())

describe('ShotEditPanel', () => {
  it('renders the selected shot and its empty states without inventing content', () => {
    const { rerender } = render(<ShotEditPanel shot={makeShot()} onPatch={vi.fn()} />)

    expect(screen.getByText('镜头1-分镜描述')).toBeInTheDocument()
    expect(screen.getByText('原始分镜描述')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '产品' })).toHaveAttribute('src', 'https://cdn.example.com/product.png')
    expect(screen.getByText('V2')).toBeInTheDocument()
    const mediaRow = screen.getByRole('group', { name: '分镜图片与素材' })
    expect(within(mediaRow).getByText('使用到的主体和素材')).toBeInTheDocument()
    expect(within(mediaRow).getByRole('button', { name: '放大当前分镜图' })).toBeInTheDocument()
    expect(within(mediaRow).getByText('历史生成')).toBeInTheDocument()

    rerender(
      <ShotEditPanel
        shot={makeShot({ subjects: [], image: '', imageVersions: [], desc: '', imagePrompt: '' })}
        onPatch={vi.fn()}
      />,
    )
    expect(screen.getByText('暂无分镜图')).toBeInTheDocument()
    expect(screen.getByText('生成后在此查看 / 切换历史版本')).toBeInTheDocument()
    expect(screen.getByText('（暂无分镜描述）')).toBeInTheDocument()
  })

  it('commits inline text with Enter and cancels it with Escape', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    render(<ShotEditPanel shot={makeShot()} onPatch={onPatch} />)

    await user.click(textField('台词修改').getByRole('button', { name: '原台词' }))
    const editor = screen.getByRole('textbox')
    await user.clear(editor)
    await user.type(editor, '新台词{Enter}')
    expect(onPatch).toHaveBeenCalledWith({ line: '新台词' })

    await user.click(textField('字幕修改').getByRole('button', { name: '原字幕' }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '不保存{Escape}')
    expect(onPatch).not.toHaveBeenCalledWith({ subtitle: '不保存' })
  })

  it('supports keyboard entry into inline editing', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    render(<ShotEditPanel shot={makeShot()} onPatch={onPatch} />)

    const trigger = textField('音效修改').getByRole('button', { name: '原音效' })
    trigger.focus()
    await user.keyboard('{Enter}')
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '新音效{Enter}')

    expect(onPatch).toHaveBeenCalledWith({ sfx: '新音效' })
  })

  it('disables polishing while pending, suppresses duplicate clicks, and writes back success', async () => {
    const user = userEvent.setup()
    const request = deferred<string>()
    const onPatch = vi.fn()
    const onPolishText = vi.fn(() => request.promise)
    render(<ShotEditPanel shot={makeShot()} onPatch={onPatch} onPolishText={onPolishText} />)

    const button = textField('台词修改').getByRole('button', { name: 'AI一键润色' })
    await user.click(button)
    expect(onPolishText).toHaveBeenCalledOnce()
    expect(onPolishText).toHaveBeenCalledWith('line', '原台词')
    expect(textField('台词修改').getByRole('button', { name: '润色中…' })).toBeDisabled()

    await user.click(textField('台词修改').getByRole('button', { name: '润色中…' }))
    expect(onPolishText).toHaveBeenCalledOnce()

    request.resolve('润色后的台词')
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ line: '润色后的台词' }))
    expect(textField('台词修改').getByRole('button', { name: 'AI一键润色' })).toBeEnabled()
  })

  it('keeps empty fields disabled and recovers after a polishing error', async () => {
    const user = userEvent.setup()
    const onPolishText = vi.fn().mockRejectedValueOnce(new Error('服务繁忙')).mockResolvedValueOnce('恢复结果')
    const onPatch = vi.fn()
    render(<ShotEditPanel shot={makeShot({ subtitle: '' })} onPatch={onPatch} onPolishText={onPolishText} />)

    expect(textField('字幕修改').getByRole('button', { name: 'AI一键润色' })).toBeDisabled()
    const lineButton = textField('台词修改').getByRole('button', { name: 'AI一键润色' })
    await user.click(lineButton)
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('AI 润色失败:服务繁忙', 'error'))
    expect(lineButton).toBeEnabled()

    await user.click(lineButton)
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ line: '恢复结果' }))
    expect(onPolishText).toHaveBeenCalledTimes(2)
  })

  it('isolates a late polishing response after switching to another shot', async () => {
    const user = userEvent.setup()
    const oldRequest = deferred<string>()
    const onPolishText = vi
      .fn()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockResolvedValueOnce('镜头2结果')
    const onPatch = vi.fn()
    const { rerender } = render(<ShotEditPanel shot={makeShot()} onPatch={onPatch} onPolishText={onPolishText} />)

    await user.click(textField('台词修改').getByRole('button', { name: 'AI一键润色' }))
    rerender(
      <ShotEditPanel
        shot={makeShot({ id: 'shot-2', no: '镜头2', line: '镜头2台词' })}
        onPatch={onPatch}
        onPolishText={onPolishText}
      />,
    )

    const newShotButton = textField('台词修改').getByRole('button', { name: 'AI一键润色' })
    expect(newShotButton).toBeEnabled()
    oldRequest.resolve('迟到的镜头1结果')
    await waitFor(() => expect(onPolishText).toHaveBeenCalledOnce())
    expect(onPatch).not.toHaveBeenCalled()

    await user.click(newShotButton)
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ line: '镜头2结果' }))
    expect(onPatch).not.toHaveBeenCalledWith({ line: '迟到的镜头1结果' })
  })

  it('does not surface a stale polishing error after switching shots', async () => {
    const user = userEvent.setup()
    const oldRequest = deferred<string>()
    const onPolishText = vi.fn(() => oldRequest.promise)
    const { rerender } = render(<ShotEditPanel shot={makeShot()} onPatch={vi.fn()} onPolishText={onPolishText} />)

    await user.click(textField('台词修改').getByRole('button', { name: 'AI一键润色' }))
    rerender(
      <ShotEditPanel
        shot={makeShot({ id: 'shot-2', no: '镜头2', line: '镜头2台词' })}
        onPatch={vi.fn()}
        onPolishText={onPolishText}
      />,
    )
    await act(async () => oldRequest.reject(new Error('镜头1请求失败')))

    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(textField('台词修改').getByRole('button', { name: 'AI一键润色' })).toBeEnabled()
  })

  it('switches history versions and exposes independent keyboard-accessible zoom actions', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    render(<ShotEditPanel shot={makeShot()} onPatch={onPatch} />)

    await user.click(screen.getByRole('button', { name: '切换到历史版本 V2' }))
    expect(onPatch).toHaveBeenCalledWith({
      image: 'https://cdn.example.com/v2.png',
      imageAssetId: 12,
      imagePrompt: '版本二提示词',
    })

    const zoom = screen.getByRole('button', { name: '放大历史版本 V1' })
    zoom.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: '图片放大' })).toBeInTheDocument()
    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/v1.png')
    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('makes current and subject images keyboard accessible and falls back after a broken subject image', async () => {
    const user = userEvent.setup()
    render(<ShotEditPanel shot={makeShot()} onPatch={vi.fn()} />)

    const currentButton = screen.getByRole('button', { name: '放大当前分镜图' })
    currentButton.focus()
    await user.keyboard(' ')
    expect(screen.getByRole('dialog', { name: '图片放大' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭' }))

    const subjectButton = screen.getByRole('button', { name: '放大素材 产品' })
    subjectButton.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: '图片放大' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭' }))

    fireEvent.error(screen.getByRole('img', { name: '产品' }))
    expect(screen.queryByRole('img', { name: '产品' })).not.toBeInTheDocument()
    expect(screen.getAllByText('产品')).toHaveLength(2)
  })

  it('announces the regenerating state and blocks image expansion', async () => {
    const user = userEvent.setup()
    render(<ShotEditPanel shot={makeShot()} regenerating onPatch={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('生成中…')
    expect(screen.queryByRole('button', { name: '放大当前分镜图' })).not.toBeInTheDocument()
    await user.click(screen.getByText('生成中…'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses a read-only compact image surface with keyboard lightbox support and no polish actions', async () => {
    const user = userEvent.setup()
    render(<ShotEditPanel shot={makeShot()} compact onPatch={vi.fn()} onPolishText={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'AI一键润色' })).not.toBeInTheDocument()
    const imageButton = screen.getByRole('button', { name: '放大当前分镜图' })
    imageButton.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: '分镜图放大' })).toBeInTheDocument()
  })
})
