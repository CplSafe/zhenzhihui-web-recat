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

/**
 * 比例 / 时长 / 分辨率 / 出图数量都收进了「创作参数」弹窗（与模型弹窗同一形式），
 * 底栏只留一个 chip。这两个小工具封装「打开弹窗」和「在弹窗里选一项」。
 */
function openCreativeParams() {
  return screen.getByRole('button', { name: /创作参数/ })
}

async function pickCreativeParam(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  await user.click(openCreativeParams())
  await user.selectOptions(screen.getByRole('combobox', { name: label }), value)
  await user.click(screen.getByRole('button', { name: '关闭参数选择' }))
}

/** 读取弹窗内某个参数当前可选项（含占位项）。 */
async function readCreativeParamOptions(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(openCreativeParams())
  const options = within(screen.getByRole('combobox', { name: label }))
    .getAllByRole('option')
    .map((option) => option.textContent)
  await user.click(screen.getByRole('button', { name: '关闭参数选择' }))
  return options
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
    // 底栏只剩一个「创作参数」chip，摘要里能读到比例与时长
    expect(openCreativeParams()).toHaveTextContent('9:16')
    expect(openCreativeParams()).toHaveTextContent('15s')
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
    expect(openCreativeParams()).toHaveTextContent('1:1')
    expect(openCreativeParams()).toHaveTextContent('5s')
    unmount()

    setSmartEntryDraftScope('user-4', 62)
    render(<TestSmartEntry onSubmit={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: '创作需求' })).toHaveValue('工作区62草稿')
  })
})

describe('SmartEntry mode, options, validation, and submission', () => {
  it('renders the real-person studio as a video-only entry with independent copy', () => {
    render(<TestSmartEntry variant="real-person" onSubmit={vi.fn()} initial={{ mode: 'image' }} />)

    expect(screen.getByRole('heading', { name: '让真实人物，成为视频主角' })).toBeInTheDocument()
    expect(screen.getByText('真人成片工作台')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '制作视频' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '制作图片' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /爆款脚本自动生成/ })).not.toBeInTheDocument()
    // 时长默认未选，需先选模型再选秒数。
    expect(openCreativeParams()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从真人素材库选择' })).toBeInTheDocument()
    expect(screen.getByText('必选项 · 未选择无法开始制作')).toBeInTheDocument()
    // 与上面那句必选文案一致:没选真人就不能开始制作。
    expect(screen.getByRole('button', { name: '去制作' })).toBeDisabled()
    expect(screen.queryByLabelText('选择上传图片')).not.toBeInTheDocument()
  })

  it('enables real-person creation only with an authenticated library reference', () => {
    render(
      <TestSmartEntry
        variant="real-person"
        onSubmit={vi.fn()}
        initial={{
          images: ['https://assets.example/person.jpg'],
          imageAssetIds: [731],
          realPersonReferences: [
            {
              realPersonId: 13,
              mappingId: 27,
              localAssetId: 731,
              personName: '已认证人物',
              verificationStatus: 'verified',
              assetStatus: 'ready',
            },
          ],
        }}
      />,
    )

    expect(screen.getByRole('button', { name: '去制作' })).toBeEnabled()
    // 真人变体不走本地上传,但可以从素材库继续加人(多人同框)。
    expect(screen.queryByRole('button', { name: '继续上传' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续添加真人素材' })).toBeInTheDocument()
  })

  /**
   * 多人同框、真人配产品图都是常见广告场景。后端逐个 asset 查真人库并各自校验授权，
   * 并不要求素材列表里只有一个真人——限制只存在于前端，且随「准备素材」步一起失去了理由。
   */
  it('keeps multiple real-person references and matches them to assets by id', () => {
    const person = (realPersonId: number, localAssetId: number, personName: string) => ({
      realPersonId,
      mappingId: realPersonId * 2,
      localAssetId,
      personName,
      verificationStatus: 'verified' as const,
      assetStatus: 'ready' as const,
    })
    render(
      <TestSmartEntry
        onSubmit={vi.fn()}
        initial={{
          images: ['https://assets.example/a.jpg', 'https://assets.example/b.jpg', 'data:product'],
          imageAssetIds: [731, 732, 733],
          realPersonReferences: [person(13, 731, '甲'), person(14, 732, '乙')],
        }}
      />,
    )

    // 两个真人 + 一张产品图共用同一份素材列表，都会作为参考图提交。
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(3)
    expect(screen.getByText('3/9 张参考图')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去制作' })).toBeEnabled()
  })

  it('does not expose the removed AI guide controls', () => {
    render(<TestSmartEntry onSubmit={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'AI 引导' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'AI 引导' })).not.toBeInTheDocument()
  })

  /**
   * 参数档位由所选模型的 schema 决定，所以顺序是「先模型、后参数」。
   * 没选模型时给出的只是兜底档位，用户可能挑中一个该模型根本做不到的秒数，
   * 直到提交才被告知不兼容——锁上入口把这条弯路堵掉。
   */
  it('locks creative params until a model is selected', async () => {
    render(<TestSmartEntry onSubmit={vi.fn()} initial={{ text: '逐秒时长' }} />)

    const chip = openCreativeParams()
    expect(chip).toBeDisabled()
    expect(chip).toHaveAttribute('title', '请先选择本次创作使用的模型')
  })

  it('offers every whole-second duration once a model without duration constraints is selected', async () => {
    const user = userEvent.setup()
    render(
      <TestSmartEntry
        onSubmit={vi.fn()}
        initial={{ text: '逐秒时长' }}
        modelGroups={[
          {
            key: 'video',
            label: '生成视频',
            subgroups: [
              { key: 'video.generate', label: '视频生成模型', models: [{ id: 701, name: '不限时长的视频模型' }] },
            ],
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '生成模型，0/1 已选择' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '视频生成模型' }), '701')
    await user.click(screen.getByRole('button', { name: '关闭模型选择' }))

    // 弹窗里的下拉带一个占位项，其后才是模型支持的档位
    expect(await readCreativeParamOptions(user, '视频时长')).toEqual([
      '选择时长',
      '1s',
      '2s',
      '3s',
      '4s',
      '5s',
      '6s',
      '7s',
      '8s',
      '9s',
      '10s',
      '11s',
      '12s',
      '13s',
      '14s',
      '15s',
    ])
  })

  it('switches to image mode and supports restored image-mode sessions', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const { unmount } = render(<TestSmartEntry onSubmit={onSubmit} />)

    await user.click(screen.getByRole('tab', { name: '制作图片' }))
    expect(mocks.showToast).not.toHaveBeenCalledWith('功能暂未开放', 'info')
    expect(screen.getByRole('tab', { name: '制作图片' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading')).toHaveTextContent('营销图片')
    expect(screen.queryByRole('button', { name: '视频时长' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '爆款脚本自动生成' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '视频生成模型' })).not.toBeInTheDocument()
    unmount()

    render(
      <TestSmartEntry
        onSubmit={onSubmit}
        initial={{ mode: 'image', text: '生成商品主图' }}
        modelGroups={[
          {
            key: 'image',
            label: '生成图片',
            subgroups: [
              { key: 'image.text_to_image', label: '文生图模型', models: [{ id: 601, name: '文生图模型 A' }] },
            ],
          },
        ]}
      />,
    )
    expect(screen.getByRole('heading')).toHaveTextContent('营销图片')
    expect(screen.queryByRole('button', { name: '视频时长' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '爆款脚本自动生成' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '视频生成模型' })).not.toBeInTheDocument()
    // 参数在选定模型后才解锁（档位由模型 schema 决定）
    await user.click(screen.getByRole('button', { name: '生成模型，0/1 已选择' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '文生图模型' }), '601')
    await user.click(screen.getByRole('button', { name: '关闭模型选择' }))
    await pickCreativeParam(user, '生成数量', '9张')
    await user.click(screen.getByRole('button', { name: '去制作' }))
    expect(onSubmit).toHaveBeenLastCalledWith(
      '生成商品主图',
      expect.objectContaining({ mode: 'image', ratio: '16:9', imageCount: 0, outputCount: 9 }),
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
          duration: '10s',
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
        initial={{ text: '生成一条新品短视频', duration: '10s' }}
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
    // 选中模型的当下就说明它做不了什么，不必等下拉档位变少或提交被拒才发现
    expect(screen.getByText('时长仅支持：5 秒、10 秒')).toBeInTheDocument()
    expect(screen.getByText('画面比例支持：16:9')).toBeInTheDocument()
    expect(screen.getByText('当前创作参数与所选模型不兼容')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '去制作' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(mocks.showToast).toHaveBeenCalledWith('当前创作参数与所选模型不兼容，请调整模型或创作参数', 'info')

    // 列表反过来标出做不到本次秒数的模型，用户不必逐个试
    expect(screen.getByRole('option', { name: /本次 6 秒不支持/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '关闭模型选择' }))
    // 用户选的 6s 原样保留：模型不支持不等于可以替他改成 5s，静默吸附就是在丢掉用户的输入。
    // 档位本身仍跟随模型，只剩它声明的秒数
    const durationOptions = await readCreativeParamOptions(user, '视频时长')
    expect(durationOptions).toContain('10s')
    expect(durationOptions).not.toContain('15s')
    await pickCreativeParam(user, '视频时长', '5s')
    // 比例同样只剩模型支持的那一项；它没被用户显式选过，所以跟着模型收敛到 16:9
    expect(await readCreativeParamOptions(user, '画面比例')).not.toContain('9:16')
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
    render(
      <TestSmartEntry
        onSubmit={onSubmit}
        modelGroups={[
          {
            key: 'video',
            label: '生成视频',
            subgroups: [
              { key: 'video.generate', label: '视频生成模型', models: [{ id: 741, name: '不限时长的视频模型' }] },
            ],
          },
        ]}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: '创作需求' }), '推广新品咖啡')
    // 参数必须先选模型才能选：模型决定可用档位。
    await user.click(screen.getByRole('button', { name: '生成模型，0/1 已选择' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '视频生成模型' }), '741')
    await user.click(screen.getByRole('button', { name: '关闭模型选择' }))
    await pickCreativeParam(user, '画面比例', '9:16')
    await pickCreativeParam(user, '视频时长', '7s')
    await user.click(screen.getByRole('button', { name: '爆款脚本自动生成' }))
    expect(screen.getByRole('option', { name: '本地生活广告' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: '电商广告' }))
    expect(screen.getByRole('textbox', { name: '创作需求' })).toHaveValue('推广新品咖啡\n\n使用电商广告帮我优化')
    await user.click(screen.getByRole('button', { name: '去制作' }))
    expect(onSubmit).toHaveBeenCalledWith(
      '推广新品咖啡',
      expect.objectContaining({
        mode: 'video',
        style: '',
        ratio: '9:16',
        duration: '7s',
        imageCount: 0,
        images: [],
        skill: '电商广告',
      }),
    )
  })

  it('按所选视频模型收敛分辨率档位，并提交用户选择的分辨率', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TestSmartEntry
        onSubmit={onSubmit}
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
                    id: 751,
                    name: '高清视频模型',
                    constraints: { resolution: { options: ['720p', '1080p'] } },
                  },
                ],
              },
            ],
          },
        ]}
      />,
    )

    await user.type(screen.getByRole('textbox', { name: '创作需求' }), '推广新品咖啡')
    await user.click(screen.getByRole('button', { name: '生成模型，0/1 已选择' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '视频生成模型' }), '751')
    await user.click(screen.getByRole('button', { name: '关闭模型选择' }))
    await pickCreativeParam(user, '视频时长', '7s')

    // 档位只来自模型 schema：480p 不在其中，不应出现在下拉里。
    expect(await readCreativeParamOptions(user, '分辨率')).toEqual(['720p', '1080p'])
    await pickCreativeParam(user, '分辨率', '1080p')

    await user.click(screen.getByRole('button', { name: '去制作' }))
    expect(onSubmit).toHaveBeenCalledWith('推广新品咖啡', expect.objectContaining({ resolution: '1080p' }))
  })

  it('submits with Ctrl+Enter and exposes meaningful tab and textbox semantics', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TestSmartEntry onSubmit={onSubmit} initial={{ text: '键盘提交需求', duration: '10s' }} />)

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
    saveSmartEntryDraft({ text: '费用不足时保留', duration: '10s' })
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
    saveSmartEntryDraft({ text: '提交后必须清理', duration: '10s' })
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
    // 上限跟着所选模型走；没选模型时回退到 9 张，提示文案也据此说明来源。
    expect(mocks.showToast).toHaveBeenCalledWith('当前模型最多支持 9 张参考图', 'info')
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(9)
  })

  /**
   * 用户上传的素材会直接作为参考图提交给视频模型，而各模型能收的张数差别很大
   * （Seedance 2.5 收 30 张、HappyHorse 图生视频只收 1 张）。上限必须来自
   * 后端 input_constraints，写死任何数字都会让一部分模型白传或少传。
   */
  it('follows the selected model reference-image ceiling instead of a fixed nine', async () => {
    const user = userEvent.setup()
    render(
      <TestSmartEntry
        onSubmit={vi.fn()}
        initial={{ images: ['data:only-one'] }}
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
                    id: 811,
                    name: '只收一张参考图的模型',
                    constraints: { referenceImages: { maximum: 1 } },
                  },
                ],
              },
            ],
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: '生成模型，0/1 已选择' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '视频生成模型' }), '811')
    await user.click(screen.getByRole('button', { name: '关闭模型选择' }))

    // 已达该模型上限：继续上传的入口消失，用量提示显示模型真实上限而不是 9。
    expect(screen.queryByRole('button', { name: '继续上传' })).not.toBeInTheDocument()
    expect(screen.getByText('1/1 张参考图')).toBeInTheDocument()

    await user.upload(screen.getByLabelText('选择上传图片'), file('second.png'))
    expect(mocks.showToast).toHaveBeenCalledWith('当前模型最多支持 1 张参考图', 'info')
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(1)
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
        initial={{ text: '已有流程', duration: '10s' }}
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
