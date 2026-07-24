import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fileToDataUrl: vi.fn(),
  openMemberCenter: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/utils/imageFile', () => ({ fileToDataUrl: mocks.fileToDataUrl }))
vi.mock('@/stores/ui', () => ({ openMemberCenter: mocks.openMemberCenter }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('@/components/smart/EntryDropdown', () => ({
  default: ({
    value,
    options,
    onChange,
    ariaLabel,
  }: {
    value: string
    options: (string | { value: string; label: string })[]
    onChange: (v: string) => void
    ariaLabel?: string
  }) => (
    <label>
      {ariaLabel || '图片比例'}
      <select aria-label={ariaLabel || '图片比例'} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option
            key={typeof option === 'string' ? option : option.value}
            value={typeof option === 'string' ? option : option.value}
          >
            {typeof option === 'string' ? option : option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}))

import ImageChat, { type ImageVideoSelection } from '@/components/smart/ImageChat/ImageChat'

const baseProps = () => ({
  messages: [],
  onSend: vi.fn(),
})

describe('ImageChat', () => {
  beforeEach(() => {
    mocks.fileToDataUrl.mockReset()
    mocks.openMemberCenter.mockReset()
    mocks.showToast.mockReset()
    mocks.fileToDataUrl.mockImplementation(async (file: File) => `data:${file.name}`)
  })

  it('identifies the page as image-only creation', () => {
    render(<ImageChat {...baseProps()} />)

    expect(screen.getByRole('heading', { name: '制作图片' })).toBeInTheDocument()
    expect(screen.getByText('仅生成图片')).toBeInTheDocument()
    expect(screen.getByText(/当前页面只会生成或修改图片，不会直接生成视频/)).toBeInTheDocument()
  })

  it('renders user, pending, error and completed assistant messages semantically', () => {
    render(
      <ImageChat
        {...baseProps()}
        messages={[
          { id: 'u1', role: 'user', text: '把 @图片1 放进场景', images: [{ url: '/ref.png' }] },
          { id: 'a1', role: 'assistant', status: 'pending' },
          { id: 'a2', role: 'assistant', status: 'error', error: '余额不足' },
          { id: 'a3', role: 'assistant', status: 'done', text: '已完成', images: [{ url: '/done.png' }] },
        ]}
      />,
    )

    expect(screen.getByText('@图片1')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('营销图片生成中…')
    expect(screen.getByRole('alert')).toHaveTextContent('余额不足')
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })

  it('keeps completed and pending images in stable horizontal batch slots', () => {
    const batchMessages = [
      {
        id: 'batch-image-1',
        role: 'assistant' as const,
        status: 'done' as const,
        images: [{ url: '/batch-1.png' }],
        batchId: 'batch-layout',
        batchIndex: 0,
        batchTotal: 3,
      },
      {
        id: 'batch-image-2',
        role: 'assistant' as const,
        status: 'pending' as const,
        batchId: 'batch-layout',
        batchIndex: 1,
        batchTotal: 3,
      },
      {
        id: 'batch-image-3',
        role: 'assistant' as const,
        status: 'pending' as const,
        batchId: 'batch-layout',
        batchIndex: 2,
        batchTotal: 3,
      },
    ]
    const view = render(<ImageChat {...baseProps()} messages={batchMessages} />)

    const batch = screen.getByRole('list', { name: '批量图片生成进度' })
    const slots = within(batch).getAllByRole('listitem')
    expect(slots).toHaveLength(3)
    expect(within(slots[0]).getByRole('img', { name: 'AI 生成图片 1' })).toBeInTheDocument()
    expect(within(slots[1]).getByRole('status')).toHaveTextContent('正在生成第 2/3 张图片…')
    expect(slots[0].nextElementSibling).toBe(slots[1])

    const secondSlot = slots[1]
    view.rerender(
      <ImageChat
        {...baseProps()}
        messages={[
          batchMessages[0],
          {
            ...batchMessages[1],
            status: 'done',
            images: [{ url: '/batch-2.png' }],
          },
          batchMessages[2],
        ]}
      />,
    )

    const updatedSlots = within(screen.getByRole('list', { name: '批量图片生成进度' })).getAllByRole('listitem')
    expect(updatedSlots[1]).toBe(secondSlot)
    expect(within(updatedSlots[1]).getByRole('img', { name: 'AI 生成图片 2' })).toBeInTheDocument()
    expect(within(updatedSlots[2]).getByRole('status')).toHaveTextContent('正在生成第 3/3 张图片…')
  })

  it('submits trimmed text by button and Ctrl+Enter, then clears the composer', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<ImageChat {...props} />)
    const input = screen.getByRole('textbox', { name: '图片创作描述' })

    await user.type(input, '  夏日产品海报  ')
    await user.click(screen.getByRole('button', { name: '生成' }))
    expect(props.onSend).toHaveBeenCalledWith('夏日产品海报', [], '16:9')
    expect(input).toHaveValue('')

    await user.type(input, '第二张{Control>}{Enter}{/Control}')
    expect(props.onSend).toHaveBeenLastCalledWith('第二张', [], '16:9')
    expect(props.onSend).toHaveBeenCalledTimes(2)
  })

  it('does not submit an empty or busy composer', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const view = render(<ImageChat {...props} />)
    expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: '图片创作描述' }), '内容')
    view.rerender(<ImageChat {...props} busy />)
    expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('keeps the composer when paid confirmation is cancelled and prevents duplicate submits while confirming', async () => {
    const user = userEvent.setup()
    let resolveConfirmation: ((accepted: boolean) => void) | undefined
    const onSend = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve
        }),
    )
    render(<ImageChat messages={[]} onSend={onSend} />)
    const composer = screen.getByRole('textbox', { name: '图片创作描述' })
    await user.type(composer, '保留这条提示词')
    await user.click(screen.getByRole('button', { name: '生成' }))

    expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onSend).toHaveBeenCalledTimes(1)

    resolveConfirmation?.(false)
    await waitFor(() => expect(screen.getByRole('button', { name: '生成' })).toBeEnabled())
    expect(composer).toHaveValue('保留这条提示词')
  })

  it('uses the selected ratio and follows a changed initial ratio for a new context', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const onRatioChange = vi.fn()
    const view = render(<ImageChat {...props} initialRatio="4:3" onRatioChange={onRatioChange} />)
    expect(screen.getByRole('combobox', { name: '图片比例' })).toHaveValue('4:3')
    expect(onRatioChange).toHaveBeenLastCalledWith('4:3')

    await user.selectOptions(screen.getByRole('combobox', { name: '图片比例' }), '1:1')
    expect(onRatioChange).toHaveBeenLastCalledWith('1:1')
    await user.type(screen.getByRole('textbox', { name: '图片创作描述' }), '方形海报')
    await user.click(screen.getByRole('button', { name: '生成' }))
    expect(props.onSend).toHaveBeenLastCalledWith('方形海报', [], '1:1')

    view.rerender(<ImageChat {...props} initialRatio="9:16" onRatioChange={onRatioChange} />)
    expect(screen.getByRole('combobox', { name: '图片比例' })).toHaveValue('9:16')
    expect(onRatioChange).toHaveBeenLastCalledWith('9:16')
  })

  it('uploads images, removes the exact duplicate and renumbers text references', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const { container } = render(<ImageChat {...props} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const duplicateA = new File(['a'], 'same.png', { type: 'image/png' })
    const duplicateB = new File(['b'], 'same.png', { type: 'image/png' })

    await user.upload(input, [duplicateA, duplicateB])
    expect(await screen.findAllByRole('button', { name: /移除图片/ })).toHaveLength(2)
    const composer = screen.getByRole('textbox', { name: '图片创作描述' })
    await user.type(composer, '@图片1 和 @图片2')
    await user.click(screen.getByRole('button', { name: '移除图片 2' }))
    expect(composer).toHaveValue('@图片1 和 ')
    await user.click(screen.getByRole('button', { name: '生成' }))
    expect(props.onSend).toHaveBeenCalledWith('@图片1 和', ['data:same.png'], '16:9')
  })

  it('caps a single upload selection at nine and tells the user about omitted files', async () => {
    const user = userEvent.setup()
    const { container } = render(<ImageChat {...baseProps()} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const files = Array.from({ length: 10 }, (_, index) => new File(['x'], `${index}.png`, { type: 'image/png' }))

    await user.upload(input, files)

    expect(await screen.findAllByRole('button', { name: /移除图片/ })).toHaveLength(9)
    expect(mocks.showToast).toHaveBeenCalledWith('最多上传 9 张图片', 'info')
  })

  it('inserts @ directly without images and inserts a selected reference at the caret', async () => {
    const user = userEvent.setup()
    const { container } = render(<ImageChat {...baseProps()} />)
    const composer = screen.getByRole('textbox', { name: '图片创作描述' })
    await user.type(composer, '产品')
    await user.click(screen.getByRole('button', { name: '引用参考素材' }))
    expect(composer).toHaveValue('产品@')

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['x'], 'ref.png', { type: 'image/png' }))
    fireEvent.select(composer, { target: { selectionStart: 0 } })
    await user.click(screen.getByRole('button', { name: '引用参考素材' }))
    await user.click(screen.getByRole('button', { name: '@图片1' }))
    expect(composer).toHaveValue('@图片1 产品@')
  })

  it('opens member center for insufficient points and starts a new chat', async () => {
    const user = userEvent.setup()
    const onNewChat = vi.fn()
    render(<ImageChat {...baseProps()} costText="约 20 积分 · 余额 5 积分" costInsufficient onNewChat={onNewChat} />)

    await user.click(screen.getByRole('button', { name: '请前往充值积分' }))
    expect(mocks.openMemberCenter).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: '创建新对话' }))
    expect(onNewChat).toHaveBeenCalledOnce()
  })

  it('disables paid generation when points are insufficient', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<ImageChat {...props} costText="约 20 积分 · 余额 5 积分" costInsufficient />)

    await user.type(screen.getByRole('textbox', { name: '图片创作描述' }), '一张商品海报')
    expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('disables generation and retry when no model is selected without blocking a new chat', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const onRetry = vi.fn()
    const onNewChat = vi.fn()
    const reason = '请先选择图生图模型'
    render(
      <ImageChat
        {...props}
        messages={[{ id: 'failed', role: 'assistant', status: 'error', error: '生成失败' }]}
        generationDisabled
        generationDisabledReason={reason}
        onRetry={onRetry}
        onNewChat={onNewChat}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: '图片创作描述' }), '修改商品海报')
    const generate = screen.getByRole('button', { name: '生成' })
    const retry = screen.getByRole('button', { name: '重新生成这张图片' })
    expect(generate).toBeDisabled()
    expect(generate).toHaveAttribute('title', reason)
    expect(retry).toBeDisabled()

    await user.keyboard('{Control>}{Enter}{/Control}')
    await user.click(retry)
    expect(props.onSend).not.toHaveBeenCalled()
    expect(onRetry).not.toHaveBeenCalled()

    const newChat = screen.getByRole('button', { name: '创建新对话' })
    expect(newChat).toBeEnabled()
    await user.click(newChat)
    expect(onNewChat).toHaveBeenCalledOnce()
  })

  it('supports retry gates that are evaluated for each failed message', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const recoverable = {
      id: 'recoverable',
      role: 'assistant' as const,
      status: 'error' as const,
      taskId: 91,
      error: '连接中断',
    }
    const needsImageToImageModel = {
      id: 'new-i2i-task',
      role: 'assistant' as const,
      status: 'error' as const,
      operationCode: 'image.image_to_image' as const,
      error: '任务失败',
    }
    render(
      <ImageChat
        {...baseProps()}
        messages={[recoverable, needsImageToImageModel]}
        generationDisabled
        generationDisabledReason="当前输入框缺少文生图模型"
        costInsufficient
        onRetry={onRetry}
        isRetryDisabled={(message) => message.id === needsImageToImageModel.id}
        getRetryDisabledReason={(message) => (message.id === needsImageToImageModel.id ? '请先选择图生图模型' : '')}
      />,
    )

    const retryButtons = screen.getAllByRole('button', { name: '重新生成这张图片' })
    expect(retryButtons[0]).toBeEnabled()
    expect(retryButtons[1]).toBeDisabled()
    expect(retryButtons[1]).toHaveAttribute('title', '请先选择图生图模型')

    await user.click(retryButtons[0])
    await user.click(retryButtons[1])
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onRetry).toHaveBeenCalledWith(recoverable)
  })

  it('disables creating a new chat while a generation is running', async () => {
    const user = userEvent.setup()
    const onNewChat = vi.fn()
    render(<ImageChat {...baseProps()} busy onNewChat={onNewChat} />)

    const button = screen.getByRole('button', { name: '创建新对话' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onNewChat).not.toHaveBeenCalled()
  })

  it('offers preview, download and an explicit edit action for generated images', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const onPreview = vi.fn()
    const onDownload = vi.fn()
    const onUseAsReference = vi.fn()
    const message = {
      id: 'a1',
      role: 'assistant' as const,
      status: 'done' as const,
      images: [{ url: '/generated.png', assetId: 82 }],
    }
    render(
      <ImageChat
        {...props}
        messages={[message]}
        onPreview={onPreview}
        onDownload={onDownload}
        onUseAsReference={onUseAsReference}
      />,
    )

    expect(screen.getByRole('img', { name: 'AI 生成图片 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '预览图片 1' }))
    await user.click(screen.getByRole('button', { name: '下载图片 1' }))
    const editButton = screen.getByRole('button', { name: '修改图片 1' })
    await user.click(editButton)

    expect(onPreview).toHaveBeenCalledWith(message.images[0], message)
    expect(onDownload).toHaveBeenCalledWith(message.images[0], message)
    expect(onUseAsReference).toHaveBeenCalledWith(message.images[0], message)
    expect(editButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('已选中图片作为修改参考')
    expect(screen.getByRole('img', { name: '待发送参考图片 1' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '图片创作描述' }), '继续调整背景')
    await user.click(screen.getByRole('button', { name: '生成' }))
    expect(props.onSend).toHaveBeenCalledWith('继续调整背景', ['/generated.png'], '16:9', [82])
  })

  it('opens the built-in large-image preview, closes with Escape and restores trigger focus', async () => {
    const user = userEvent.setup()
    const message = {
      id: 'a-preview-fallback',
      role: 'assistant' as const,
      status: 'done' as const,
      images: [{ url: '/large-preview.png', assetId: 83 }],
    }
    render(<ImageChat {...baseProps()} messages={[message]} />)

    const previewTrigger = screen.getByRole('button', { name: '预览图片 1' })
    await user.click(previewTrigger)

    const dialog = screen.getByRole('dialog', { name: '图片预览' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'AI 生成图片 1大图预览' })).toHaveAttribute('src', '/large-preview.png')
    expect(document.body.style.overflow).toBe('hidden')
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭图片预览' })).toHaveFocus())

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()
    await waitFor(() => expect(previewTrigger).toHaveFocus())
    expect(document.body.style.overflow).toBe('')
  })

  it('selects one to nine outputs and forwards the exact count', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const onOutputCountChange = vi.fn()
    render(<ImageChat {...props} onOutputCountChange={onOutputCountChange} />)

    expect(screen.getByRole('combobox', { name: '生成图片数量' })).toHaveValue('1张')
    await user.selectOptions(screen.getByRole('combobox', { name: '生成图片数量' }), '9张')
    expect(onOutputCountChange).toHaveBeenLastCalledWith(9)
    await user.type(screen.getByRole('textbox', { name: '图片创作描述' }), '九张产品海报')
    await user.click(screen.getByRole('button', { name: '生成' }))

    expect(props.onSend).toHaveBeenCalledWith('九张产品海报', [], '16:9', undefined, 9)
  })

  it('returns the complete composer draft and sends selected results through one independent video action', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const onContinueToVideo = vi.fn()
    const message = {
      id: 'a-video',
      role: 'assistant' as const,
      status: 'done' as const,
      images: [
        { url: '/video-source-1.png', assetId: 91 },
        { url: '/video-source-2.png', assetId: 92 },
      ],
    }
    render(
      <ImageChat
        {...baseProps()}
        messages={[message]}
        initialComposerDraft={{
          text: '保留人物，修改背景',
          ratio: '1:1',
          images: message.images,
          outputCount: 3,
        }}
        onBack={onBack}
        onContinueToVideo={onContinueToVideo}
      />,
    )

    const continueButton = screen.getByRole('button', { name: '做视频' })
    expect(continueButton).toBeDisabled()
    expect(screen.queryByRole('button', { name: '用图片 1 制作视频' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '选择图片 1 用于制作视频' }))
    await user.click(screen.getByRole('button', { name: '选择图片 2 用于制作视频' }))
    expect(screen.getByText('已选 2 张，最多 9 张')).toBeInTheDocument()
    expect(continueButton).toBeEnabled()

    await user.click(continueButton)
    expect(onContinueToVideo).toHaveBeenCalledWith([
      { image: message.images[0], message },
      { image: message.images[1], message },
    ])

    await user.click(screen.getByRole('button', { name: '返回上一步' }))
    expect(onBack).toHaveBeenCalledWith({
      text: '保留人物，修改背景',
      ratio: '1:1',
      images: message.images,
      outputCount: 3,
    })
  })

  it('selects at most nine video images and prevents duplicate continuation while the first request is pending', async () => {
    const user = userEvent.setup()
    let resolveContinuation: (() => void) | undefined
    const onContinueToVideo = vi.fn(
      (_selections: ImageVideoSelection[]) =>
        new Promise<void>((resolve) => {
          resolveContinuation = resolve
        }),
    )
    const message = {
      id: 'a-video-limit',
      role: 'assistant' as const,
      status: 'done' as const,
      images: Array.from({ length: 10 }, (_, index) => ({
        url: `/video-limit-${index + 1}.png`,
        assetId: 100 + index,
      })),
    }
    render(<ImageChat {...baseProps()} messages={[message]} onContinueToVideo={onContinueToVideo} />)

    for (let index = 1; index <= 9; index += 1) {
      await user.click(screen.getByRole('button', { name: `选择图片 ${index} 用于制作视频` }))
    }
    expect(screen.getByText('已选 9 张，最多 9 张')).toBeInTheDocument()

    const tenthSelection = screen.getByRole('button', { name: '选择图片 10 用于制作视频' })
    await user.click(tenthSelection)
    expect(tenthSelection).toHaveAttribute('aria-pressed', 'false')
    expect(mocks.showToast).toHaveBeenCalledWith('最多选择 9 张图片制作视频', 'info')

    const continueButton = screen.getByRole('button', { name: '做视频' })
    await user.dblClick(continueButton)

    expect(onContinueToVideo).toHaveBeenCalledTimes(1)
    expect(onContinueToVideo.mock.calls[0][0].map(({ image }) => image.assetId)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108,
    ])
    expect(continueButton).toBeDisabled()
    expect(continueButton).toHaveTextContent('准备中…')

    resolveContinuation?.()
    await waitFor(() => expect(continueButton).toBeEnabled())
  })

  it('flushes the latest composer draft when unmounted before the debounce fires', () => {
    const onComposerDraftChange = vi.fn()
    const selectedImage = { url: '/selected-before-unmount.png', assetId: 92 }
    const { unmount } = render(
      <ImageChat
        {...baseProps()}
        messages={[
          {
            id: 'a-unmount',
            role: 'assistant',
            status: 'done',
            images: [selectedImage],
          },
        ]}
        onComposerDraftChange={onComposerDraftChange}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '图片创作描述' }), {
      target: { value: '离开页面前刚输入的修改要求' },
    })
    fireEvent.click(screen.getByRole('button', { name: '修改图片 1' }))
    expect(onComposerDraftChange).not.toHaveBeenCalled()

    unmount()

    expect(onComposerDraftChange).toHaveBeenCalledTimes(1)
    expect(onComposerDraftChange).toHaveBeenLastCalledWith({
      text: '离开页面前刚输入的修改要求',
      ratio: '16:9',
      images: [selectedImage],
      outputCount: 1,
    })
  })

  it('lets the user retry a failed message and disables retry while busy', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const message = { id: 'failed', role: 'assistant' as const, status: 'error' as const, error: '服务繁忙' }
    const view = render(<ImageChat {...baseProps()} messages={[message]} onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: '重新生成这张图片' }))
    expect(onRetry).toHaveBeenCalledWith(message)

    view.rerender(<ImageChat {...baseProps()} messages={[message]} onRetry={onRetry} busy />)
    expect(screen.getByRole('button', { name: '重新生成这张图片' })).toBeDisabled()
  })

  it('reports composer reference count after add, remove and send', async () => {
    const user = userEvent.setup()
    const onComposerReferenceCountChange = vi.fn()
    const props = baseProps()
    const { container } = render(
      <ImageChat {...props} onComposerReferenceCountChange={onComposerReferenceCountChange} />,
    )
    expect(onComposerReferenceCountChange).toHaveBeenLastCalledWith(0)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['x'], 'ref.png', { type: 'image/png' }))
    await waitFor(() => expect(onComposerReferenceCountChange).toHaveBeenLastCalledWith(1))

    await user.click(screen.getByRole('button', { name: '移除图片 1' }))
    expect(onComposerReferenceCountChange).toHaveBeenLastCalledWith(0)

    await user.upload(input, new File(['x'], 'ref-2.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => expect(onComposerReferenceCountChange).toHaveBeenLastCalledWith(0))
  })

  it('filters non-image files and reports decoding failures', async () => {
    const user = userEvent.setup({ applyAccept: false })
    mocks.fileToDataUrl.mockRejectedValueOnce(new Error('broken'))
    const { container } = render(<ImageChat {...baseProps()} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, [
      new File(['text'], 'notes.txt', { type: 'text/plain' }),
      new File(['x'], 'broken.png', { type: 'image/png' }),
    ])

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('已忽略 1 个非图片文件', 'info'))
    expect(mocks.showToast).toHaveBeenCalledWith('1 张图片读取失败，请重新选择', 'error')
    expect(screen.queryByRole('button', { name: /移除图片/ })).not.toBeInTheDocument()
  })

  it('keeps successfully decoded files when another selected file fails', async () => {
    const user = userEvent.setup()
    mocks.fileToDataUrl.mockRejectedValueOnce(new Error('broken')).mockResolvedValueOnce('data:good.png')
    const { container } = render(<ImageChat {...baseProps()} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(input, [
      new File(['x'], 'broken.png', { type: 'image/png' }),
      new File(['x'], 'good.png', { type: 'image/png' }),
    ])

    await waitFor(() => expect(screen.getAllByRole('button', { name: /移除图片/ })).toHaveLength(1))
  })
})
