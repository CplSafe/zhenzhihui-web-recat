import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  GenerationModelDropdown,
  getGenerationModelDurationOptions,
  getGenerationModelResolutionOptions,
  getGenerationModelSelectionConflicts,
  isDurationSupportedByGenerationModel,
  type GenerationModelGroup,
  type GenerationModelSelection,
} from '@/components/smart/GenerationModelPicker'

const groups: GenerationModelGroup[] = [
  {
    key: 'script',
    label: '生成脚本',
    subgroups: [
      {
        key: 'responses.multimodal',
        label: '脚本生成模型',
        models: [
          {
            id: 101,
            name: '后端脚本模型甲',
            restrictions: ['每次最多生成 10 个镜头'],
          },
          { id: 102, name: '后端脚本模型乙' },
        ],
      },
    ],
  },
  {
    key: 'image',
    label: '生成图片',
    subgroups: [
      {
        key: 'image.image_to_image',
        label: '图生图模型',
        models: [
          {
            id: 301,
            name: '后端图生图模型',
            constraints: { referenceImages: { minimum: 1, maximum: 2 } },
          },
        ],
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
        models: [
          {
            id: 201,
            name: '后端视频模型',
            restrictions: ['时长仅支持：5 秒、10 秒、15 秒'],
            constraints: { duration: { options: [5, 10, 15] }, ratios: ['16:9'] },
          },
        ],
      },
    ],
  },
]

function StatefulDropdown({ initial = {} }: { initial?: GenerationModelSelection }) {
  const [selected, setSelected] = useState(initial)
  return (
    <GenerationModelDropdown
      groups={groups}
      selected={selected}
      onChange={(groupKey, modelId, subgroupKey) => {
        setSelected((current) => ({ ...current, [subgroupKey || groupKey]: modelId }))
      }}
    />
  )
}

describe('GenerationModelDropdown', () => {
  it('refreshes the model catalog whenever an unlocked selector is opened', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<GenerationModelDropdown groups={groups} selected={{}} onChange={vi.fn()} onOpen={onOpen} />)

    const trigger = screen.getByRole('button', { name: '生成模型，0/3 已选择' })
    await user.click(trigger)
    expect(onOpen).toHaveBeenCalledTimes(1)
    await user.click(trigger)
    await user.click(trigger)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('opens from one toolbar trigger and selects every operation with native dropdowns', async () => {
    const user = userEvent.setup()
    render(<StatefulDropdown />)

    const trigger = screen.getByRole('button', { name: '生成模型，0/3 已选择' })
    expect(screen.queryByRole('dialog', { name: '本次创作使用的模型' })).not.toBeInTheDocument()
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '本次创作使用的模型' })
    // 面板里没有「确认」：选择在 onChange 当下就已生效，无需再点一次确认
    expect(within(dialog).queryByRole('button', { name: '确认' })).not.toBeInTheDocument()
    expect(screen.getByText('请完成全部 3 项模型选择。')).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '脚本生成模型' }), '101')
    // 选中即说明该模型的能力边界，用户不必等参数下拉变少或提交被拒才知道
    expect(screen.getByText('每次最多生成 10 个镜头')).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '图生图模型' }), '301')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '视频生成模型' }), '201')
    expect(screen.getByText('模型配置完成，将沿用本次选择')).toBeInTheDocument()
    expect(trigger).toHaveAccessibleName('生成模型，3/3 已选择')

    await user.click(within(dialog).getByRole('button', { name: '关闭模型选择' }))
    expect(screen.queryByRole('dialog', { name: '本次创作使用的模型' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('shows the selected model restrictions without a section header and restores focus on Escape', async () => {
    const user = userEvent.setup()
    render(<StatefulDropdown initial={{ 'responses.multimodal': 101 }} />)

    const trigger = screen.getByRole('button', { name: '生成模型，1/3 已选择' })
    await user.click(trigger)
    // 限制直接跟在模型下面，不再另起一个「使用限制」小标题占版面
    expect(screen.queryByText('使用限制')).not.toBeInTheDocument()
    expect(screen.getByText('每次最多生成 10 个镜头')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('repeatedly emphasizes and opens the selector when creation requests a missing model', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <GenerationModelDropdown
        groups={groups}
        selected={{}}
        onChange={onChange}
        attentionRequest={0}
        attentionMessage="请先完成本次创作的模型选择"
      />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(
      <GenerationModelDropdown
        groups={groups}
        selected={{}}
        onChange={onChange}
        attentionRequest={1}
        attentionMessage="请先完成本次创作的模型选择"
      />,
    )

    const firstTrigger = screen.getByRole('button', { name: '生成模型，0/3 已选择' })
    expect(screen.getByRole('dialog', { name: '本次创作使用的模型' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('请先完成本次创作的模型选择')
    expect(firstTrigger.closest('[data-attention]')).toHaveAttribute('data-attention', 'true')
    await waitFor(() => expect(firstTrigger).toHaveFocus())

    rerender(
      <GenerationModelDropdown
        groups={groups}
        selected={{}}
        onChange={onChange}
        attentionRequest={2}
        attentionMessage="请先完成本次创作的模型选择"
      />,
    )
    expect(screen.getByRole('button', { name: '生成模型，0/3 已选择' })).not.toBe(firstTrigger)
  })

  it('temporarily disables selectors while a generation task is running', async () => {
    const user = userEvent.setup()
    render(
      <GenerationModelDropdown
        groups={groups}
        selected={{ 'responses.multimodal': 101, 'image.image_to_image': 301, 'video.generate': 201 }}
        onChange={vi.fn()}
        locked
        context="generation"
        lockedReason="视频正在生成中，暂时不能切换模型"
      />,
    )

    await user.click(screen.getByRole('button', { name: /生成模型，3\/3 已选择，处理中不可切换/ }))
    expect(screen.getByText('视频正在生成中，暂时不能切换模型')).toBeInTheDocument()
    expect(screen.getByText('本次模型选择已锁定')).toBeInTheDocument()
    screen.getAllByRole('combobox').forEach((select) => expect(select).toBeDisabled())
  })

  it('explains that the homepage selection is reused after creation starts', async () => {
    const user = userEvent.setup()
    render(
      <GenerationModelDropdown
        groups={groups}
        selected={{ 'responses.multimodal': 101, 'image.image_to_image': 301, 'video.generate': 201 }}
        onChange={vi.fn()}
        context="generation"
      />,
    )

    await user.click(screen.getByRole('button', { name: '生成模型，3/3 已选择' }))
    expect(screen.getByText('请在首页完成模型选择；进入后续步骤后将始终沿用本次选择')).toBeInTheDocument()
    screen.getAllByRole('combobox').forEach((select) => expect(select).toBeEnabled())
  })

  it('portals and collision-positions the panel so overflow containers cannot clip it', async () => {
    const user = userEvent.setup()
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 430,
      y: 640,
      top: 640,
      right: 556,
      bottom: 684,
      left: 430,
      width: 126,
      height: 44,
      toJSON: () => ({}),
    } as DOMRect)

    try {
      render(
        <div style={{ overflow: 'hidden', width: 200 }}>
          <GenerationModelDropdown groups={groups} selected={{}} onChange={vi.fn()} placement="start" />
        </div>,
      )

      await user.click(screen.getByRole('button', { name: '生成模型，0/3 已选择' }))
      const dialog = screen.getByRole('dialog', { name: '本次创作使用的模型' })
      await waitFor(() => {
        expect(dialog.parentElement).toBe(document.body)
        expect(dialog).toHaveStyle({ position: 'fixed', left: '430px' })
      })
    } finally {
      rectSpy.mockRestore()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })

  it('keeps a failed operation visible and explains why it cannot be selected', async () => {
    const user = userEvent.setup()
    render(
      <GenerationModelDropdown
        groups={[
          {
            key: 'video',
            label: '生成视频',
            subgroups: [
              {
                key: 'video.generate',
                label: '视频生成模型',
                models: [
                  {
                    id: '__unavailable__:video.generate',
                    name: '暂无可用模型',
                    disabled: true,
                    unavailableReason: '视频生成模型加载失败，请重试',
                  },
                ],
              },
            ],
          },
        ]}
        selected={{}}
        onChange={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '生成模型，0/1 已选择' }))
    expect(screen.getByRole('combobox', { name: '视频生成模型' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('视频生成模型加载失败，请重试')
  })

  it('derives entry conflicts from the selected backend model constraints', () => {
    expect(
      getGenerationModelSelectionConflicts(
        groups,
        { 'responses.multimodal': 101, 'video.generate': 201 },
        { durationSec: 6, ratio: '9:16' },
      ),
    ).toEqual([
      '视频生成模型「后端视频模型」：当前 6 秒不在可选时长 5 秒、10 秒、15 秒 内',
      '视频生成模型「后端视频模型」：当前比例 9:16 不在支持范围 16:9 内',
    ])
  })

  it('validates backend reference-image limits for image operations', () => {
    expect(
      getGenerationModelSelectionConflicts(
        groups,
        { 'image.image_to_image': 301 },
        { ratio: '16:9', referenceImageCount: 3 },
      ),
    ).toEqual(['图生图模型「后端图生图模型」：当前参考图数量 3 不符合1–2 张'])
  })

  it('offers only the durations the selected video model declares', () => {
    const fallback = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    // 模型声明了 options：入口默认档位让位于模型，即便档位数变少。
    expect(getGenerationModelDurationOptions(groups, { 'video.generate': 201 }, 'video.generate', fallback)).toEqual([
      5, 10, 15,
    ])
    // 未选模型时保持入口默认档位，不凭空缩小可选范围。
    expect(getGenerationModelDurationOptions(groups, {}, 'video.generate', fallback)).toEqual(fallback)
    // operation 不存在时同样回落默认档位。
    expect(getGenerationModelDurationOptions(groups, { 'video.generate': 201 }, 'video.replicate', fallback)).toEqual(
      fallback,
    )
  })

  it('treats a duration as supported whenever the model has no say over it', () => {
    // 回归：用户选了模型支持的 20 秒，随后目录刷新/未命中模型时档位回落到入口默认（上限 15 秒）。
    // 若此时把「不在默认档位里」当成不支持，20 秒会被悄悄吸附成 15 秒。
    const longGroups: GenerationModelGroup[] = [
      {
        key: 'video',
        label: '生成视频',
        subgroups: [
          {
            key: 'video.replicate',
            label: '视频生成模型',
            models: [
              { id: 501, name: '支持长片的模型', constraints: { duration: { options: [10, 15, 20] } } },
              { id: 502, name: '未声明时长的模型' },
            ],
          },
        ],
      },
    ]
    // 模型声明支持 20 秒 → 不得纠正。
    expect(isDurationSupportedByGenerationModel(longGroups, { 'video.replicate': 501 }, 'video.replicate', 20)).toBe(
      true,
    )
    // 模型未选中 / operation 不匹配 / 模型没声明约束 → 都属于「不知道」，同样不得纠正。
    expect(isDurationSupportedByGenerationModel(longGroups, {}, 'video.replicate', 20)).toBe(true)
    expect(isDurationSupportedByGenerationModel([], { 'video.replicate': 501 }, 'video.replicate', 20)).toBe(true)
    expect(isDurationSupportedByGenerationModel(longGroups, { 'video.replicate': 502 }, 'video.replicate', 20)).toBe(
      true,
    )
    // 只有模型明确不支持时才返回 false，交由调用方就近吸附。
    expect(isDurationSupportedByGenerationModel(longGroups, { 'video.replicate': 501 }, 'video.replicate', 7)).toBe(
      false,
    )
  })

  it('filters the entry durations by a declared range and never yields an empty list', () => {
    const rangeGroups: GenerationModelGroup[] = [
      {
        key: 'video',
        label: '生成视频',
        subgroups: [
          {
            key: 'video.generate',
            label: '视频生成模型',
            models: [
              { id: 401, name: '范围模型', constraints: { duration: { minimum: 4, maximum: 8 } } },
              { id: 402, name: '越界模型', constraints: { duration: { minimum: 30 } } },
            ],
          },
        ],
      },
    ]
    expect(
      getGenerationModelDurationOptions(rangeGroups, { 'video.generate': 401 }, 'video.generate', [1, 5, 9, 12]),
    ).toEqual([5])
    // 上下限把默认档位全部排除：保留默认档位而不是给出空下拉，冲突提示负责解释原因。
    expect(
      getGenerationModelDurationOptions(rangeGroups, { 'video.generate': 402 }, 'video.generate', [1, 5, 9, 12]),
    ).toEqual([1, 5, 9, 12])
  })

  it('offers only the resolutions the selected video model declares', () => {
    const fallback = ['480p', '720p', '1080p']
    const resolutionGroups: GenerationModelGroup[] = [
      {
        key: 'video',
        label: '生成视频',
        subgroups: [
          {
            key: 'video.generate',
            label: '视频生成模型',
            models: [
              { id: 501, name: '声明 resolution 的模型', constraints: { resolution: { options: ['720p', '1080p'] } } },
              { id: 502, name: '只给简洁字段的模型', constraints: { resolutions: ['4k'] } },
              { id: 503, name: '未声明分辨率的模型' },
            ],
          },
        ],
      },
    ]

    expect(
      getGenerationModelResolutionOptions(resolutionGroups, { 'video.generate': 501 }, 'video.generate', fallback),
    ).toEqual(['720p', '1080p'])
    // 兼容只提供 resolutions 简洁字段的后端记录。
    expect(
      getGenerationModelResolutionOptions(resolutionGroups, { 'video.generate': 502 }, 'video.generate', fallback),
    ).toEqual(['4k'])
    // 模型未声明约束、未选模型或 operation 不匹配时，保持入口默认档位。
    expect(
      getGenerationModelResolutionOptions(resolutionGroups, { 'video.generate': 503 }, 'video.generate', fallback),
    ).toEqual(fallback)
    expect(getGenerationModelResolutionOptions(resolutionGroups, {}, 'video.generate', fallback)).toEqual(fallback)
    expect(
      getGenerationModelResolutionOptions(resolutionGroups, { 'video.generate': 501 }, 'video.replicate', fallback),
    ).toEqual(fallback)
  })
})

describe('video.edit duration is judged against the source video, not the target duration', () => {
  // 生成模型支持 30 秒、视频修改模型只支持到 15 秒：真实后端目录里的能力落差。
  const mixedGroups: GenerationModelGroup[] = [
    {
      key: 'video',
      label: '生成视频',
      subgroups: [
        {
          key: 'video.generate',
          label: '视频生成模型',
          models: [{ id: 201, name: '生成模型 2.5', constraints: { duration: { options: [5, 10, 15, 30] } } }],
        },
        {
          key: 'video.edit',
          label: '视频修改模型',
          models: [
            { id: 901, name: '修改模型', constraints: { duration: { minimum: 1, maximum: 15, required: true } } },
          ],
        },
      ],
    },
  ]
  const selection = { 'video.generate': 201, 'video.edit': 901 }

  it('lets a 30s generation start even though the edit model tops out at 15s', () => {
    // 源视频还不存在 → 修改模型本轮不参与时长校验，30 秒照常开工。
    // 修改模型声明了 duration.required，这里也不能误报「要求提供时长」。
    expect(getGenerationModelSelectionConflicts(mixedGroups, selection, { durationSec: 30 })).toEqual([])
  })

  it('reports the conflict once a real source video exceeds the edit model limit', () => {
    expect(getGenerationModelSelectionConflicts(mixedGroups, selection, { sourceVideoDurationSec: 30 })).toEqual([
      '视频修改模型「修改模型」：当前 30 秒不符合1–15 秒',
    ])
  })

  it('accepts a source video inside the edit model limit', () => {
    expect(
      getGenerationModelSelectionConflicts(mixedGroups, selection, { durationSec: 30, sourceVideoDurationSec: 10 }),
    ).toEqual([])
  })

  it('still validates the generation model against the target duration', () => {
    expect(getGenerationModelSelectionConflicts(mixedGroups, selection, { durationSec: 7 })).toEqual([
      '视频生成模型「生成模型 2.5」：当前 7 秒不在可选时长 5 秒、10 秒、15 秒、30 秒 内',
    ])
  })

  it('warns instead of erroring when an estimate fails, and never blocks creation', async () => {
    const user = userEvent.setup()
    render(
      <GenerationModelDropdown
        groups={groups}
        selected={{ 'responses.multimodal': 101 }}
        onChange={vi.fn()}
        estimateModelCost={() => Promise.reject(new Error('后端估价接口 500'))}
      />,
    )

    await user.click(screen.getByRole('button', { name: '生成模型，1/3 已选择' }))
    const badge = await screen.findByText('暂无法预估，不影响创作')
    // 具体报错留在悬浮提示里，面板上只给一句不吓人的说明
    expect(badge).toHaveAttribute('title', '后端估价接口 500')
    expect(screen.queryByText('预估失败')).not.toBeInTheDocument()
  })

  it('explains an unusable slot instead of estimating it', async () => {
    const user = userEvent.setup()
    const estimateModelCost = vi.fn().mockResolvedValue({ estimatedCost: 5, balance: 100, canAfford: true })
    render(
      <GenerationModelDropdown
        groups={mixedGroups}
        selected={selection}
        onChange={vi.fn()}
        estimateModelCost={estimateModelCost}
        slotNotices={{ 'video.edit': '当前 30s 不适用，生成后不能修改' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: '生成模型，2/2 已选择' }))
    expect(screen.getByText('当前 30s 不适用，生成后不能修改')).toBeInTheDocument()
    // 用不上的槽位不发预估请求，也就不会有「重新预估」这种需要用户处理的残留
    await waitFor(() => expect(estimateModelCost).toHaveBeenCalled())
    expect(estimateModelCost.mock.calls.every(([request]) => request.operationCode !== 'video.edit')).toBe(true)
    expect(screen.queryByRole('button', { name: '重新预估' })).not.toBeInTheDocument()
  })

  it('answers whether a duration keeps the edit capability available', () => {
    expect(isDurationSupportedByGenerationModel(mixedGroups, selection, 'video.edit', 30)).toBe(false)
    expect(isDurationSupportedByGenerationModel(mixedGroups, selection, 'video.edit', 15)).toBe(true)
    // 未选模型 / 时长未知 / operation 不存在时不替后端下结论，一律视为支持。
    expect(isDurationSupportedByGenerationModel(mixedGroups, {}, 'video.edit', 30)).toBe(true)
    expect(isDurationSupportedByGenerationModel(mixedGroups, selection, 'video.edit', null)).toBe(true)
    expect(isDurationSupportedByGenerationModel(mixedGroups, selection, 'video.replicate', 30)).toBe(true)
  })
})

describe('游客态的模型入口', () => {
  it('没有任何可选模型时也保留入口，让未登录用户看得见这项能力', () => {
    render(<GenerationModelDropdown groups={[]} selected={{}} onChange={vi.fn()} authRequired />)
    expect(screen.getByRole('button', { name: '生成模型，登录后可选择' })).toBeInTheDocument()
  })

  it('点击后交给登录引导，而不是展开一个空面板', async () => {
    const user = userEvent.setup()
    const onAuthRequired = vi.fn()
    const onChange = vi.fn()
    render(
      <GenerationModelDropdown
        groups={groups}
        selected={{}}
        onChange={onChange}
        authRequired
        onAuthRequired={onAuthRequired}
      />,
    )

    await user.click(screen.getByRole('button', { name: '生成模型，登录后可选择' }))
    expect(onAuthRequired).toHaveBeenCalledTimes(1)
    // 面板一旦展开，游客就会对着一个空列表反复点击，误以为功能坏了
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('已登录且目录为空时维持原行为：不渲染入口', () => {
    const { container } = render(<GenerationModelDropdown groups={[]} selected={{}} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('已登录时不受影响，入口照常展开', async () => {
    const user = userEvent.setup()
    render(<GenerationModelDropdown groups={groups} selected={{}} onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /生成模型/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
