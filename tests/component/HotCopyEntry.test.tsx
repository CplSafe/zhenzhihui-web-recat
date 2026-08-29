import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAiTasks: vi.fn(),
  listAssets: vi.fn(),
  listCreativeProjects: vi.fn(),
  showToast: vi.fn(),
  currentUserId: 7,
  workspaceId: 21,
}))

vi.mock('@/stores/workspaceSession', () => ({
  useCurrentUser: () => (mocks.currentUserId ? { id: mocks.currentUserId } : null),
  useWorkspaceId: () => mocks.workspaceId,
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/api/business', () => ({
  extractAssetPage: (payload: { items?: unknown[]; offset?: number; total?: number }) => ({
    items: payload?.items ?? [],
    limit: payload?.items?.length ?? 0,
    offset: payload?.offset ?? 0,
    total: payload?.total ?? payload?.items?.length ?? 0,
  }),
  extractAssetPageItems: (payload: { items?: unknown[] } | null) => payload?.items ?? [],
  listAiTasks: mocks.listAiTasks,
  listAssets: mocks.listAssets,
  listCreativeProjects: mocks.listCreativeProjects,
}))

vi.mock('@/components/material/MaterialLibraryPicker', () => ({
  default: ({
    materials,
    modelValue,
    projectName,
  }: {
    materials: Array<{ id: string; name: string }>
    modelValue: boolean
    projectName: string
  }) =>
    modelValue ? (
      <section aria-label={`${projectName}素材选择器`}>
        {materials.map((material) => (
          <span key={material.id}>{material.name}</span>
        ))}
      </section>
    ) : null,
}))

vi.mock('@/components/hotcopy/HotCopyCaseModal/HotCopyCaseModal', () => ({
  default: () => null,
}))

vi.mock('@/components/smart/EntryCanvasBg', () => ({
  default: () => null,
}))

import HotCopyEntry from '@/components/hotcopy/HotCopyEntry/HotCopyEntry'

function project(id: number, restrictedMemberIds: number[]) {
  return { id, user_id: 8, draft_json: { restrictedMemberIds } }
}

function asset(id: number, name: string, type: 'image' | 'video', projectId = 0) {
  return {
    id,
    name,
    type,
    url: `/${id}.${type === 'video' ? 'mp4' : 'png'}`,
    ...(projectId ? { project_id: projectId } : {}),
  }
}

function openLibraryFor(tileLabel: string) {
  const tile = screen.getByText(tileLabel).closest('.hotcopy__tilewrap')
  if (!tile) throw new Error(`找不到入口: ${tileLabel}`)
  fireEvent.click(within(tile as HTMLElement).getByRole('button', { name: tileLabel }))
  fireEvent.click(within(tile as HTMLElement).getByRole('button', { name: '素材库' }))
}

/**
 * 一个不带任何 schema 约束的可选模型分组。
 *
 * 创作参数弹层要求先选模型才能打开（档位由模型 schema 决定），所以凡是要在
 * 弹层里选比例/时长的用例都得先有一个可选中的模型。
 */
function modelGroupsWith(models: Array<{ id: number; name: string; constraints?: Record<string, unknown> }>) {
  return [
    {
      key: 'hotCopyVideo',
      label: '生成视频',
      subgroups: [
        {
          key: 'video.replicate',
          label: '视频生成模型',
          required: true,
          models,
        },
      ],
    },
  ] as any
}

/**
 * 模型选择与爆款成片共用 CreativeModelSlots：一枚摘要胶囊，展开后每槽一个
 * 创作台选择器，在卡片列表里按名称点选，选完自动收起。
 */
async function pickModel(user: ReturnType<typeof userEvent.setup>, modelName: string) {
  await user.click(screen.getByRole('button', { name: /生成模型/ }))
  const triggers = screen.getAllByRole('button', { name: '选择生成模型' })
  for (const trigger of triggers) {
    await user.click(trigger)
    const option = screen.queryByRole('option', { name: new RegExp(modelName) })
    if (option) {
      await user.click(option)
      await user.keyboard('{Escape}')
      return
    }
    await user.click(trigger)
  }
  throw new Error(`未找到模型选项：${modelName}`)
}

/**
 * 比例 / 时长 / 分辨率 / 背景音都收进了「创作参数」弹窗（与爆款成片同一组件），
 * 底栏只留一枚 chip。以下工具与 SmartEntry.test.tsx 中的同名工具保持一致。
 */
function openCreativeParams() {
  return screen.getByRole('button', { name: /创作参数/ })
}

/** 打开弹层并点中某一档；时长是 radiogroup 里的 radio，其余行是 button。 */
async function pickCreativeParam(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(openCreativeParams())
  const panel = within(screen.getByRole('dialog', { name: '创作参数' }))
  const target = panel.queryByRole('radio', { name: value }) || panel.getByRole('button', { name: value })
  await user.click(target)
  await user.keyboard('{Escape}')
}

/** 读取时长档位条当前列出的秒数。 */
async function readDurationOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(openCreativeParams())
  const group = screen.getByRole('radiogroup', { name: '视频时长' })
  const options = within(group)
    .getAllByRole('radio')
    .map((radio) => radio.textContent?.trim())
  await user.keyboard('{Escape}')
  return options
}

describe('HotCopyEntry project asset access', () => {
  beforeEach(() => {
    mocks.listAiTasks.mockReset()
    mocks.listAiTasks.mockResolvedValue({ items: [] })
    mocks.listAssets.mockReset()
    mocks.listCreativeProjects.mockReset()
    mocks.showToast.mockReset()
    mocks.currentUserId = 7
    mocks.workspaceId = 21
  })

  it('disables creating on a new empty entry and does not show the next-step action', () => {
    render(<HotCopyEntry onSubmit={vi.fn()} />)

    expect(screen.getByRole('button', { name: '去制作' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '返回下一步' })).not.toBeInTheDocument()
  })

  it('shows unlinked and accessible-project videos but hides restricted and unknown linked videos', async () => {
    mocks.listCreativeProjects.mockResolvedValue([project(1, [7]), project(2, [9])])
    mocks.listAssets.mockResolvedValue({
      items: [
        asset(101, 'Unlinked video', 'video'),
        asset(102, 'Accessible video', 'video', 2),
        asset(103, 'Restricted video', 'video', 1),
        asset(104, 'Unknown video', 'video', 999),
      ],
    })

    render(<HotCopyEntry onSubmit={vi.fn()} />)
    openLibraryFor('上传爆款视频')

    expect(await screen.findByText('Unlinked video')).toBeInTheDocument()
    expect(await screen.findByText('Accessible video')).toBeInTheDocument()
    expect(screen.queryByText('Restricted video')).not.toBeInTheDocument()
    expect(screen.queryByText('Unknown video')).not.toBeInTheDocument()
  })

  it('keeps unlinked images and fails closed for linked images when project permissions fail', async () => {
    mocks.listCreativeProjects.mockRejectedValue(new Error('project list unavailable'))
    mocks.listAssets.mockResolvedValue({
      items: [asset(201, 'Unlinked image', 'image'), asset(202, 'Linked hidden image', 'image', 2)],
    })

    render(<HotCopyEntry onSubmit={vi.fn()} />)
    openLibraryFor('上传替换素材')

    expect(await screen.findByText('Unlinked image')).toBeInTheDocument()
    expect(screen.queryByText('Linked hidden image')).not.toBeInTheDocument()
  })

  it('does not request project-scoped materials before the user identity is known', () => {
    mocks.currentUserId = 0

    render(<HotCopyEntry onSubmit={vi.fn()} />)
    openLibraryFor('上传爆款视频')

    expect(mocks.listAssets).not.toHaveBeenCalled()
    expect(mocks.listCreativeProjects).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('登录身份尚未就绪，请稍后重试', 'error')
  })

  it('discards an in-flight material response when the user changes in the same workspace', async () => {
    let resolveAssets: (value: unknown) => void = () => {}
    let resolveProjects: (value: unknown) => void = () => {}
    mocks.listAssets.mockReturnValue(
      new Promise((resolve) => {
        resolveAssets = resolve
      }),
    )
    mocks.listCreativeProjects.mockReturnValue(
      new Promise((resolve) => {
        resolveProjects = resolve
      }),
    )

    const { rerender } = render(<HotCopyEntry onSubmit={vi.fn()} />)
    openLibraryFor('上传爆款视频')

    mocks.currentUserId = 9
    rerender(<HotCopyEntry onSubmit={vi.fn()} />)
    await act(async () => {
      resolveProjects([project(2, [9])])
      resolveAssets({ items: [asset(301, 'Previous user video', 'video', 2)] })
      await Promise.resolve()
    })

    expect(screen.queryByText('Previous user video')).not.toBeInTheDocument()
  })

  it('emits project-persistable entry changes without submitting a generation', async () => {
    const onSubmit = vi.fn()
    const onDraftChange = vi.fn()
    render(
      <HotCopyEntry
        onSubmit={onSubmit}
        onDraftChange={onDraftChange}
        initial={{
          tab: 'remake',
          videoSource: 'library',
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          videoPreview: '/101.mp4',
          products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
          ratio: '16:9',
          duration: '10s',
          modelVersionId: 220,
          text: '',
        }}
        modelGroups={modelGroupsWith([{ id: 220, name: '复制模型' }])}
        modelReady
      />,
    )

    await waitFor(() => expect(onDraftChange).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留节奏，突出产品' } })
    await pickCreativeParam(userEvent.setup(), '7s')

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          products: [expect.objectContaining({ assetId: 201 })],
          text: '保留节奏，突出产品',
          ratio: '16:9',
          duration: '7s',
          modelVersionId: 220,
        }),
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('lets the duration be chosen before any model, starting unselected', async () => {
    const user = userEvent.setup()
    render(
      <HotCopyEntry
        onSubmit={vi.fn()}
        initial={{ modelVersionId: 240 }}
        modelGroups={modelGroupsWith([{ id: 240, name: '不限时长的复制模型' }])}
        modelReady
      />,
    )

    // 时长默认未选（摘要里是占位文案），但不锁：秒数是需求、模型是实现选择，谁先定都合理。
    expect(openCreativeParams()).toHaveTextContent('选择时长')
    await user.click(openCreativeParams())
    expect(screen.getByRole('radiogroup', { name: '视频时长' })).toBeInTheDocument()
    expect(mocks.showToast).not.toHaveBeenCalledWith('请先选择视频模型', 'info')
  })

  it('offers the same 1s through 15s range once a model without duration constraints is selected', async () => {
    const user = userEvent.setup()
    render(
      <HotCopyEntry
        onSubmit={vi.fn()}
        initial={{ modelVersionId: 240 }}
        modelGroups={modelGroupsWith([{ id: 240, name: '不限时长的复制模型' }])}
        modelReady
      />,
    )

    expect(await readDurationOptions(user)).toEqual([
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

  it('restores and submits the exact duration saved in the entry draft', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <HotCopyEntry
        onSubmit={onSubmit}
        initial={{
          tab: 'remake',
          videoSource: 'library',
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          videoPreview: '/101.mp4',
          products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
          ratio: '16:9',
          duration: '7s',
          modelVersionId: 220,
          text: '',
        }}
        modelGroups={modelGroupsWith([{ id: 220, name: '复制模型' }])}
        modelReady
      />,
    )

    // 恢复出来的秒数直接出现在折叠态摘要里，不必展开弹层就能确认。
    expect(openCreativeParams()).toHaveTextContent('7s')
    await user.click(screen.getByRole('button', { name: '去制作' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ duration: '7s' }))
  })

  it('blocks submission until a video model is selected, then submits its backend id', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <HotCopyEntry
        onSubmit={onSubmit}
        initial={{
          tab: 'remake',
          videoSource: 'library',
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          videoPreview: '/101.mp4',
          products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
          ratio: '16:9',
          duration: '7s',
          text: '',
        }}
        modelGroups={[
          {
            key: 'hotCopyVideo',
            label: '生成视频',
            subgroups: [
              {
                key: 'video.replicate',
                label: '视频生成模型',
                required: true,
                models: [
                  { id: 220, name: 'Seedance 2.0', restrictions: ['仅支持 1 至 10 秒'] },
                  { id: 221, name: 'HappyHorse参考生视频' },
                ],
              },
            ],
          },
        ]}
        modelReady
        requireModelSelection
      />,
    )

    await user.click(screen.getByRole('button', { name: '去制作' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenLastCalledWith('请先选择本次爆款复制使用的视频模型', 'info')
    // 未选模型时胶囊自己就写着还差几个，不再依赖弹层自动展开与抖动提示。
    expect(screen.getByRole('button', { name: /生成模型，选择模型 0\/1/ })).toBeInTheDocument()

    await pickModel(user, 'Seedance 2.0')
    await user.click(screen.getByRole('button', { name: '去制作' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ modelVersionId: 220, duration: '7s' }))
  })

  /**
   * 换用 CreativeModelSlots 后，卡片列表展示后端下发的 restrictions 文案，
   * 不再由前端按 constraints 计算「最长 N 秒」的括注（那是 GenerationModelDropdown 的能力）。
   * 这里改为验证限制文案照常出现在卡片上，用户仍能在选之前看到差异。
   */
  it('在模型卡片上展示后端下发的限制文案，便于选之前比较', async () => {
    const user = userEvent.setup()
    render(
      <HotCopyEntry
        onSubmit={vi.fn()}
        modelGroups={[
          {
            key: 'hotCopyVideo',
            label: '生成视频',
            subgroups: [
              {
                key: 'video.replicate',
                label: '视频生成模型',
                required: true,
                models: [
                  { id: 301, name: '帧智汇 1.0', restrictions: ['最长 15 秒'] },
                  { id: 303, name: 'Seedance 2.0 Fast', restrictions: ['最长 10 秒'] },
                  // 后端没下发限制文案的模型不加括注，不能凭空写一个上限。
                  { id: 304, name: '未声明时长的模型' },
                ],
              },
            ],
          },
        ]}
        modelReady
      />,
    )

    await user.click(screen.getByRole('button', { name: /生成模型/ }))
    await user.click(screen.getByRole('button', { name: '选择生成模型' }))

    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('帧智汇 1.0'),
      expect.stringContaining('Seedance 2.0 Fast'),
      expect.stringContaining('未声明时长的模型'),
    ])
    expect(options[0]).toHaveTextContent('最长 15 秒')
    expect(options[1]).toHaveTextContent('最长 10 秒')
    expect(options[2]).not.toHaveTextContent('最长')
  })

  it('keeps creating a new video and returning to generation available outside submission preflight', async () => {
    const user = userEvent.setup()
    const onNewVideo = vi.fn()
    const onResume = vi.fn()
    render(
      <HotCopyEntry
        onSubmit={vi.fn()}
        onNewVideo={onNewVideo}
        canResume
        onResume={onResume}
        initial={{
          tab: 'remake',
          videoSource: 'library',
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          videoPreview: '/101.mp4',
          products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
          ratio: '16:9',
          duration: '7s',
          modelVersionId: 220,
        }}
        modelGroups={[
          {
            key: 'hotCopyVideo',
            label: '生成视频',
            subgroups: [
              {
                key: 'video.replicate',
                label: '视频生成模型',
                required: true,
                models: [{ id: 220, name: 'Seedance 2.0' }],
              },
            ],
          },
        ]}
        modelReady
        requireModelSelection
      />,
    )

    expect(screen.getByRole('button', { name: '创建新视频' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /生成模型/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: '返回下一步' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '返回下一步' }))
    await user.click(screen.getByRole('button', { name: '创建新视频' }))

    expect(onResume).toHaveBeenCalledOnce()
    expect(onNewVideo).toHaveBeenCalledOnce()
  })

  it('locks the selected model and disables creating a new video while generation preflight is busy', async () => {
    const user = userEvent.setup()
    const onNewVideo = vi.fn()
    render(
      <HotCopyEntry
        onSubmit={vi.fn()}
        onNewVideo={onNewVideo}
        submissionBusy
        initial={{
          tab: 'remake',
          videoSource: 'library',
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          videoPreview: '/101.mp4',
          products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
          ratio: '16:9',
          duration: '7s',
          modelVersionId: 220,
        }}
        modelGroups={[
          {
            key: 'hotCopyVideo',
            label: '生成视频',
            subgroups: [
              {
                key: 'video.replicate',
                label: '视频生成模型',
                required: true,
                models: [
                  { id: 220, name: 'Seedance 2.0' },
                  { id: 221, name: 'HappyHorse参考生视频' },
                ],
              },
            ],
          },
        ]}
        modelReady
        requireModelSelection
      />,
    )

    const createButton = screen.getByRole('button', { name: '创建新视频' })
    expect(createButton).toBeDisabled()
    expect(screen.getByRole('button', { name: '去制作' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('准备中…')).toBeInTheDocument()
    await user.click(createButton)
    expect(onNewVideo).not.toHaveBeenCalled()

    const modelTrigger = screen.getByRole('button', { name: /生成模型，.*处理中不可切换/ })
    await user.click(modelTrigger)
    expect(screen.getByRole('button', { name: '选择生成模型' })).toBeDisabled()
  })

  it('lets a resumable draft view its previous step without depending on the current model catalog', async () => {
    const user = userEvent.setup()
    const onResume = vi.fn()
    render(
      <HotCopyEntry
        onSubmit={vi.fn()}
        canResume
        onResume={onResume}
        initial={{
          tab: 'remake',
          videoSource: 'library',
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          videoPreview: '/101.mp4',
          products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
          ratio: '16:9',
          duration: '7s',
          text: '',
        }}
        modelGroups={[
          {
            key: 'hotCopyVideo',
            label: '生成视频',
            subgroups: [
              {
                key: 'video.replicate',
                label: '视频生成模型',
                required: true,
                models: [{ id: 220, name: 'Seedance 2.0' }],
              },
            ],
          },
        ]}
        modelReady
        requireModelSelection
      />,
    )

    const resumeButton = screen.getByRole('button', { name: '返回下一步' })
    await user.click(resumeButton)

    expect(onResume).toHaveBeenCalledOnce()
    expect(mocks.showToast).not.toHaveBeenCalledWith('请先选择本次爆款复制使用的视频模型', 'info')
  })

  it.each([
    {
      label: 'enabled audio',
      constraints: { audio: { options: [false] } },
      productCount: 1,
      expected: '视频生成模型「Seedance 2.0」：当前模型不支持生成音频',
    },
    {
      label: 'actual reference image count',
      constraints: { referenceImages: { maximum: 1 } },
      productCount: 2,
      expected: '视频生成模型「Seedance 2.0」：当前参考图数量 2 不符合最大 1 张',
    },
  ])(
    'blocks submission when $label conflicts with the selected model',
    async ({ constraints, productCount, expected }) => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(
        <HotCopyEntry
          onSubmit={onSubmit}
          initial={{
            tab: 'remake',
            videoSource: 'library',
            libraryVideo: { assetId: 101, src: '/101.mp4' },
            videoPreview: '/101.mp4',
            products: Array.from({ length: productCount }, (_, index) => ({
              assetId: 201 + index,
              url: `/${201 + index}.png`,
              file: null,
              isVideo: false,
            })),
            ratio: '16:9',
            duration: '7s',
            text: '',
            modelVersionId: 220,
          }}
          modelGroups={[
            {
              key: 'hotCopyVideo',
              label: '生成视频',
              subgroups: [
                {
                  key: 'video.replicate',
                  label: '视频生成模型',
                  required: true,
                  models: [{ id: 220, name: 'Seedance 2.0', constraints }],
                },
              ],
            },
          ]}
          modelReady
          requireModelSelection
        />,
      )

      await user.click(screen.getByRole('button', { name: '去制作' }))

      expect(onSubmit).not.toHaveBeenCalled()
      expect(mocks.showToast).toHaveBeenLastCalledWith(expected, 'info')
    },
  )

  it('收敛到所选模型支持的分辨率并按该档位提交', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <HotCopyEntry
        onSubmit={onSubmit}
        initial={{
          tab: 'remake',
          videoSource: 'library',
          libraryVideo: { assetId: 101, src: '/101.mp4' },
          videoPreview: '/101.mp4',
          products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
          ratio: '16:9',
          duration: '7s',
          text: '',
          modelVersionId: 220,
        }}
        modelGroups={[
          {
            key: 'hotCopyVideo',
            label: '生成视频',
            subgroups: [
              {
                key: 'video.replicate',
                label: '视频生成模型',
                required: true,
                models: [{ id: 220, name: 'Seedance 2.0', constraints: { resolution: { options: ['1080p'] } } }],
              },
            ],
          },
        ]}
        modelReady
        requireModelSelection
      />,
    )

    // 默认 720p 不在该模型支持范围内 → 自动吸附到 1080p，而不是把用户卡在必然失败的档位上。
    await waitFor(() => expect(openCreativeParams()).toHaveTextContent('1080p'))

    await user.click(screen.getByRole('button', { name: '去制作' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ resolution: '1080p' }))
  })

  it('does not silently switch to another model when the selected model disappears from the catalog', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const initial = {
      tab: 'remake' as const,
      videoSource: 'library' as const,
      libraryVideo: { assetId: 101, src: '/101.mp4' },
      videoPreview: '/101.mp4',
      products: [{ assetId: 201, url: '/201.png', file: null, isVideo: false }],
      ratio: '16:9',
      duration: '7s',
      text: '',
      modelVersionId: 220,
    }
    const catalog = (models: Array<{ id: number; name: string }>) => [
      {
        key: 'hotCopyVideo',
        label: '生成视频',
        subgroups: [
          {
            key: 'video.replicate',
            label: '视频生成模型',
            required: true,
            models,
          },
        ],
      },
    ]
    const { rerender } = render(
      <HotCopyEntry
        onSubmit={onSubmit}
        initial={initial}
        modelGroups={catalog([
          { id: 220, name: 'Seedance 2.0' },
          { id: 221, name: 'HappyHorse参考生视频' },
        ])}
        modelReady
        requireModelSelection
      />,
    )

    rerender(
      <HotCopyEntry
        onSubmit={onSubmit}
        initial={initial}
        modelGroups={catalog([{ id: 221, name: 'HappyHorse参考生视频' }])}
        modelReady
        requireModelSelection
      />,
    )
    await user.click(screen.getByRole('button', { name: '去制作' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenLastCalledWith('请先选择本次爆款复制使用的视频模型', 'info')
    // 目录里那条被下架后不会静默改选剩下的那个：胶囊退回「未选」，由用户自己重新挑。
    expect(screen.getByRole('button', { name: /生成模型，选择模型 0\/1/ })).toBeInTheDocument()
  })
})
