import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SmartEntry from '@/components/smart/SmartEntry/SmartEntry'
import { createGenerationModelOperationStateMap } from '@/utils/generationModelCatalog'
import { loadSmartEntryDraft, saveSmartEntryDraft, setSmartEntryDraftScope } from '@/utils/smartEntryDraft'

const mocks = vi.hoisted(() => ({
  fileToDataUrl: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/components/smart/EntryCanvasBg', () => ({ default: () => null }))
vi.mock('@/utils/imageFile', () => ({ fileToDataUrl: mocks.fileToDataUrl }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function file(name = 'reference.png', type = 'image/png') {
  return new File(['image'], name, { type })
}

/** 统一挂载入口组件，便于各用例按需覆盖回调与初始值。 */
function TestSmartEntry(props: ComponentProps<typeof SmartEntry>) {
  return <SmartEntry {...props} />
}

beforeEach(() => {
  vi.clearAllMocks()
  setSmartEntryDraftScope('user-4', 61)
  mocks.fileToDataUrl.mockImplementation(async (input: File) => `data:${input.name}`)
})

describe('SmartEntry draft and session initialization', () => {
  it('restores an unsubmitted draft during an ordinary return to /smart', async () => {
    saveSmartEntryDraft({
      text: '上一条视频的入口草稿',
      ratio: '9:16',
      duration: '15s',
    })
    render(<TestSmartEntry onSubmit={vi.fn()} />)

    expect(screen.getByRole('textbox', { name: '创作需求' })).toHaveValue('上一条视频的入口草稿')
    expect(screen.getByRole('button', { name: '9:16' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15s' })).toBeInTheDocument()
  })

  it('renders a fresh entry on the first frame of an explicit new-video session', () => {
    saveSmartEntryDraft({ text: '不得恢复的旧草稿' })
    render(<TestSmartEntry onSubmit={vi.fn()} restoreSessionDraft={false} />)

    expect(screen.getByRole('textbox', { name: '创作需求' })).toHaveValue('')
  })

  it('prefers initial values and isolates restored drafts by workspace on remount', () => {
    saveSmartEntryDraft({ text: '工作区61草稿' })
    setSmartEntryDraftScope('user-4', 62)
    saveSmartEntryDraft({ text: '工作区62草稿' })
    setSmartEntryDraftScope('user-4', 61)

    const { unmount } = render(
      <TestSmartEntry
        onSubmit={vi.fn()}
        initial={{ text: '流程返回值', ratio: '1:1', duration: '5s', skill: '本地生活Skill' }}
      />,
    )
    expect(screen.getByRole('textbox', { name: '创作需求' })).toHaveValue('流程返回值\n\n使用本地生活广告帮我优化')
    expect(screen.getByRole('button', { name: '1:1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5s' })).toBeInTheDocument()
    unmount()

    setSmartEntryDraftScope('user-4', 62)
    render(<TestSmartEntry onSubmit={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: '创作需求' })).toHaveValue('工作区62草稿')
  })
})

describe('SmartEntry mode, options, validation, and submission', () => {
  it('does not expose the removed AI guide controls', () => {
    render(<TestSmartEntry onSubmit={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'AI 引导' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'AI 引导' })).not.toBeInTheDocument()
  })

  it('offers every whole-second duration from 1s through 15s', async () => {
    const user = userEvent.setup()
    render(<TestSmartEntry onSubmit={vi.fn()} initial={{ text: '逐秒时长' }} />)

    await user.click(screen.getByRole('button', { name: '10s' }))
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'])
  })

  it('switches to image mode and supports restored image-mode sessions', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const { unmount } = render(<TestSmartEntry onSubmit={onSubmit} />)

    await user.click(screen.getByRole('tab', { name: '制作图片' }))
    expect(mocks.showToast).not.toHaveBeenCalledWith('功能暂未开放', 'info')
    expect(screen.getByRole('tab', { name: '制作图片' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading')).toHaveTextContent('营销图片')
    expect(screen.queryByRole('button', { name: '10s' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '爆款脚本自动生成' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '视频生成模型' })).not.toBeInTheDocument()
    unmount()

    render(<TestSmartEntry onSubmit={onSubmit} initial={{ mode: 'image', text: '生成商品主图' }} />)
    expect(screen.getByRole('heading')).toHaveTextContent('营销图片')
    expect(screen.queryByRole('button', { name: '10s' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '爆款脚本自动生成' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '视频生成模型' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '生成图片数量' }))
    await user.click(screen.getByRole('option', { name: '9张' }))
    await user.click(screen.getByRole('button', { name: '去制作' }))
    expect(onSubmit).toHaveBeenLastCalledWith(
      '生成商品主图',
      expect.objectContaining({ mode: 'image', ratio: '16:9', duration: '10s', imageCount: 0, outputCount: 9 }),
    )
  })

  it('keeps multiple carried image asset ids aligned before and after removing the first image', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const images = [
      '/api/v1/assets/731/download?workspace_id=21',
      '/api/v1/assets/732/download?workspace_id=21',
      '/api/v1/assets/733/download?workspace_id=21',
    ]
    const imageAssetIds = [731, 732, 733]
    render(
      <TestSmartEntry
        onSubmit={onSubmit}
        initial={{
          mode: 'video',
          text: '让画面缓慢推进',
          images,
          imageAssetIds,
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: '去制作' }))
    expect(onSubmit).toHaveBeenCalledWith('让画面缓慢推进', expect.objectContaining({ images, imageAssetIds }))

    await user.click(screen.getAllByRole('button', { name: '移除' })[0])
    await user.click(screen.getByRole('button', { name: '去制作' }))
    expect(onSubmit).toHaveBeenLastCalledWith(
      '让画面缓慢推进',
      expect.objectContaining({
        images: images.slice(1),
        imageAssetIds: imageAssetIds.slice(1),
      }),
    )
  })

  it('requires either text or material and permits a material-only submission', async () => {
    const user = userEvent.setup()
    render(<TestSmartEntry onSubmit={vi.fn()} />)

    expect(screen.getByRole('button', { name: '去制作' })).toBeDisabled()
    await user.upload(screen.getByLabelText('选择上传图片'), file())
    expect(await screen.findByRole('button', { name: '继续上传' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去制作' })).toBeEnabled()
  })

  it('requires every homepage model slot and submits the backend model ids after dropdown selection', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TestSmartEntry
        onSubmit={onSubmit}
        initial={{ text: '生成一条新品短视频' }}
        requireModelSelection
        modelGroups={[
          {
            key: 'script',
            label: '生成脚本',
            subgroups: [
              {
                key: 'responses.multimodal',
                label: '脚本生成模型',
                models: [{ id: 731, name: '后端返回的脚本模型' }],
              },
            ],
          },
          {
            key: 'video',
            label: '生成视频',
            subgroups: [
              {
                key: 'video.generate',
                label: '视频生成模型',
                models: [{ id: 732, name: '后端返回的视频模型' }],
              },
            ],
          },
        ]}
      />,
    )

    const submit = screen.getByRole('button', { name: '去制作' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('请先选择本次创作使用的全部模型', 'info')
    expect(screen.getByRole('dialog', { name: '本次创作使用的模型' })).toBeInTheDocument()
    const attentionTrigger = screen.getByRole('button', { name: '生成模型，0/2 已选择' })
    await waitFor(() => expect(attentionTrigger).toHaveFocus())
    expect(attentionTrigger.closest('[data-attention]')).toHaveAttribute('data-attention', 'true')

    await user.selectOptions(screen.getByRole('combobox', { name: '脚本生成模型' }), '731')
    await user.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByRole('combobox', { name: '视频生成模型' }), '732')

    await user.click(submit)
    expect(onSubmit).toHaveBeenCalledWith(
      '生成一条新品短视频',
      expect.objectContaining({
        generationModels: {
          'responses.multimodal': 731,
          'video.generate': 732,
        },
      }),
    )
  })

  it('does not infer readiness from the remaining groups when one required operation failed to load', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const operationStates = createGenerationModelOperationStateMap('ready')
    operationStates['video.generate'] = {
      operationCode: 'video.generate',
      status: 'error',
      availableModelCount: 0,
      message: '视频生成模型加载失败，请重试',
    }

    render(
      <TestSmartEntry
        onSubmit={onSubmit}
        initial={{
          text: '生成一条短视频',
          generationModels: { 'responses.multimodal': 731 },
        }}
        requireModelSelection
        modelOperationStates={operationStates}
        modelGroups={[
          {
            key: 'script',
            label: '生成脚本',
            subgroups: [
              {
                key: 'responses.multimodal',
                label: '脚本生成模型',
                models: [{ id: 731, name: '后端脚本模型' }],
              },
            ],
          },
        ]}
      />,
    )

    const submit = screen.getByRole('button', { name: '去制作' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('当前有必需模型不可用，请在模型选择中检查后重试', 'info')
    expect(screen.getByRole('dialog', { name: '本次创作使用的模型' })).toBeInTheDocument()
  })

  it('keeps backend restrictions hidden while still blocking incompatible entry duration or ratio', async () => {
    const user = userEvent.setup()
    render(
      <TestSmartEntry
        onSubmit={vi.fn()}
        initial={{ text: '生成受限模型视频', duration: '6s', ratio: '9:16' }}
        requireModelSelection
        modelGroups={[
          {
            key: 'video',
            label: '生成视频',
            subgroups: [
              {
                key: 'video.generate',
                label: '视频生成模型',
                models: [
                  {
                    id: 901,
                    name: '后端受限视频模型',
                    restrictions: ['时长仅支持：5 秒、10 秒', '画面比例支持：16:9'],
                    constraints: { duration: { options: [5, 10] }, ratios: ['16:9'] },
                  },
                ],
              },
            ],
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '生成模型，0/1 已选择' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '视频生成模型' }), '901')
    expect(screen.queryByText('时长仅支持：5 秒、10 秒')).not.toBeInTheDocument()
    expect(screen.queryByText('画面比例支持：16:9')).not.toBeInTheDocument()
    expect(screen.getByText('当前创作参数与所选模型不兼容')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '去制作' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(mocks.showToast).toHaveBeenCalledWith('当前创作参数与所选模型不兼容，请调整模型或创作参数', 'info')

    await user.click(screen.getByRole('button', { name: '关闭模型选择' }))
    await user.click(screen.getByRole('button', { name: '6s' }))
    await user.click(screen.getByRole('option', { name: '5s' }))
    await user.click(screen.getByRole('button', { name: '9:16' }))
    await user.click(screen.getByRole('option', { name: '16:9' }))
    expect(screen.getByRole('button', { name: '去制作' })).toBeEnabled()
  })

  it('requires only the image model matching the current reference-image mode', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TestSmartEntry
        onSubmit={onSubmit}
        initial={{ mode: 'image', text: '生成商品海报' }}
        requireModelSelection
        modelGroups={[
          {
            key: 'image',
            label: '生成图片',
            subgroups: [
              {
                key: 'image.text_to_image',
                label: '文生图模型',
                models: [{ id: 811, name: '后端文生图模型' }],
              },
              {
                key: 'image.image_to_image',
                label: '图生图模型',
                models: [{ id: 812, name: '后端图生图模型' }],
              },
            ],
          },
        ]}
      />,
    )

    const submit = screen.getByRole('button', { name: '去制作' })
    expect(submit).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '生成模型，0/1 已选择' }))
    expect(screen.getByRole('combobox', { name: '文生图模型' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '图生图模型' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '文生图模型' }), '811')
    await user.click(submit)

    expect(onSubmit).toHaveBeenCalledWith(
      '生成商品海报',
      expect.objectContaining({
        generationModels: {
          'image.text_to_image': 811,
        },
      }),
    )
  })

  it('blocks image creation when uploaded references exceed the selected backend model limit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TestSmartEntry
        onSubmit={onSubmit}
        initial={{
          mode: 'image',
          text: '生成三图商品海报',
          images: ['data:ref-1', 'data:ref-2', 'data:ref-3'],
        }}
        requireModelSelection
        modelGroups={[
          {
            key: 'image',
            label: '生成图片',
            subgroups: [
              {
                key: 'image.text_to_image',
                label: '文生图模型',
                models: [{ id: 821, name: '后端文生图模型' }],
              },
              {
                key: 'image.image_to_image',
                label: '图生图模型',
                models: [
                  {
                    id: 822,
                    name: '最多双参考图模型',
                    constraints: { referenceImages: { minimum: 1, maximum: 2 } },
                  },
                ],
              },
            ],
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '生成模型，0/1 已选择' }))
    expect(screen.queryByRole('combobox', { name: '文生图模型' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '图生图模型' }), '822')

    expect(screen.getByText('当前创作参数与所选模型不兼容')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '去制作' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('当前创作参数与所选模型不兼容，请调整模型或创作参数', 'info')
  })

  it('submits the selected ratio, duration, and skill while stripping the skill helper line', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TestSmartEntry onSubmit={onSubmit} />)

    await user.type(screen.getByRole('textbox', { name: '创作需求' }), '推广新品咖啡')
    await user.click(screen.getByRole('button', { name: '16:9' }))
    await user.click(screen.getByRole('option', { name: '9:16' }))
    await user.click(screen.getByRole('button', { name: '10s' }))
    await user.click(screen.getByRole('option', { name: '7s' }))
    await user.click(screen.getByRole('button', { name: '爆款脚本自动生成' }))
    expect(screen.getByRole('option', { name: '本地生活广告' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: '电商广告' }))
    expect(screen.getByRole('textbox', { name: '创作需求' })).toHaveValue('推广新品咖啡\n\n使用电商广告帮我优化')
    await user.click(screen.getByRole('button', { name: '去制作' }))
    expect(onSubmit).toHaveBeenCalledWith('推广新品咖啡', {
      mode: 'video',
      style: '',
      ratio: '9:16',
      duration: '7s',
      imageCount: 0,
      images: [],
      skill: '电商广告',
    })
  })

  it('submits with Ctrl+Enter and exposes meaningful tab and textbox semantics', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TestSmartEntry onSubmit={onSubmit} initial={{ text: '键盘提交需求' }} />)

    expect(screen.getByRole('tab', { name: '制作视频' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: '创作需求' })).toHaveAccessibleName('创作需求')
    screen.getByRole('textbox', { name: '创作需求' }).focus()
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('prevents duplicate submission, reports busy state, and unlocks when the parent rejects for insufficient balance', async () => {
    const user = userEvent.setup()
    const request = deferred<boolean>()
    const onSubmit = vi.fn(() => request.promise)
    saveSmartEntryDraft({ text: '费用不足时保留' })
    render(<TestSmartEntry onSubmit={onSubmit} />)

    const submit = screen.getByRole('button', { name: '去制作' })
    await user.dblClick(submit)
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '正在准备创作' })).toBeDisabled()

    await act(async () => request.resolve(false))
    expect(screen.getByRole('button', { name: '去制作' })).toBeEnabled()
    expect(loadSmartEntryDraft()).not.toBeNull()
  })

  it('does not recreate a cleared draft after an accepted submission', async () => {
    const user = userEvent.setup()
    saveSmartEntryDraft({ text: '提交后必须清理' })
    render(<TestSmartEntry onSubmit={vi.fn().mockResolvedValue(true)} />)

    await user.click(screen.getByRole('button', { name: '去制作' }))
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
    })
    expect(loadSmartEntryDraft()).toBeNull()
  })
})

describe('SmartEntry uploads and recovery actions', () => {
  it('caps concurrent uploads at nine images and warns when already full', async () => {
    const user = userEvent.setup()
    const existing = Array.from({ length: 8 }, (_, i) => `data:existing-${i}`)
    render(<TestSmartEntry onSubmit={vi.fn()} initial={{ images: existing }} />)
    const input = screen.getByLabelText('选择上传图片')

    await user.upload(input, [file('nine.png'), file('ignored.png')])
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(9)
    expect(screen.queryByRole('button', { name: '继续上传' })).not.toBeInTheDocument()

    await user.upload(input, file('overflow.png'))
    expect(mocks.showToast).toHaveBeenCalledWith('最多上传 9 张图片', 'info')
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(9)
  })

  it('rejects non-image files and reports image-read failures without adding broken thumbnails', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<TestSmartEntry onSubmit={vi.fn()} />)
    const input = screen.getByLabelText('选择上传图片')

    await user.upload(input, file('notes.txt', 'text/plain'))
    expect(mocks.showToast).toHaveBeenCalledWith('智能成片仅支持添加图片素材', 'info')
    mocks.showToast.mockClear()
    mocks.fileToDataUrl.mockRejectedValueOnce(new Error('读取失败'))
    await user.upload(input, file('broken.png'))
    expect(mocks.showToast).toHaveBeenCalledWith('图片读取失败，请重试', 'error')
    expect(screen.queryByRole('button', { name: '移除' })).not.toBeInTheDocument()
  })

  it('inserts an uploaded material reference at the caret', async () => {
    const user = userEvent.setup()
    render(<TestSmartEntry onSubmit={vi.fn()} initial={{ text: '放到场景中', images: ['data:product'] }} />)
    const textbox = screen.getByRole('textbox', { name: '创作需求' })
    textbox.focus()
    await user.keyboard('{Home}')
    await user.click(screen.getByRole('button', { name: '@' }))
    await user.click(screen.getByRole('button', { name: '@图片1' }))

    expect(textbox).toHaveValue('@图片1 放到场景中')
  })

  it('allows an old resumable draft to complete and persist its missing homepage models', async () => {
    const user = userEvent.setup()
    const onResume = vi.fn()
    render(
      <TestSmartEntry
        onSubmit={vi.fn()}
        canResume
        onResume={onResume}
        requireModelSelection
        initial={{ text: '没有模型配置的旧草稿' }}
        modelGroups={[
          {
            key: 'script',
            label: '生成脚本',
            subgroups: [
              {
                key: 'responses.multimodal',
                label: '脚本生成模型',
                models: [{ id: 951, name: '后端脚本模型' }],
              },
            ],
          },
        ]}
      />,
    )

    const resumeButton = screen.getByRole('button', { name: '返回下一步' })
    expect(resumeButton).toBeEnabled()
    await user.click(resumeButton)
    expect(onResume).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenLastCalledWith('请先选择本次创作使用的全部模型', 'info')
    expect(await screen.findByRole('dialog', { name: '本次创作使用的模型' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '脚本生成模型' }), '951')

    await user.click(resumeButton)
    expect(onResume).toHaveBeenCalledWith({ 'responses.multimodal': 951 })
  })

  it('forwards new-video and resume actions without regenerating', async () => {
    const user = userEvent.setup()
    const onNewVideo = vi.fn()
    const onResume = vi.fn()
    const onSubmit = vi.fn()
    render(
      <TestSmartEntry
        onSubmit={onSubmit}
        onNewVideo={onNewVideo}
        canResume
        onResume={onResume}
        initial={{ text: '已有流程' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: '制作新视频' }))
    expect(onNewVideo).toHaveBeenCalledWith('video')
    await user.click(screen.getByRole('button', { name: '返回下一步' }))
    expect(onResume).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '去制作' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
