import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  GenerationModelDropdown,
  getGenerationModelSelectionConflicts,
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
  it('opens from one toolbar trigger and selects every operation with native dropdowns', async () => {
    const user = userEvent.setup()
    render(<StatefulDropdown />)

    const trigger = screen.getByRole('button', { name: '生成模型，0/3 已选择' })
    expect(screen.queryByRole('dialog', { name: '本次创作使用的模型' })).not.toBeInTheDocument()
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '本次创作使用的模型' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '脚本生成模型' }), '101')
    expect(screen.queryByText('每次最多生成 10 个镜头')).not.toBeInTheDocument()
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '图生图模型' }), '301')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '视频生成模型' }), '201')
    expect(screen.getByText('模型配置完成，空闲时可以随时切换')).toBeInTheDocument()
    expect(trigger).toHaveAccessibleName('生成模型，3/3 已选择')
  })

  it('keeps backend restrictions hidden while retaining selection validation and restores focus on Escape', async () => {
    const user = userEvent.setup()
    render(<StatefulDropdown initial={{ 'responses.multimodal': 101 }} />)

    const trigger = screen.getByRole('button', { name: '生成模型，1/3 已选择' })
    await user.click(trigger)
    expect(screen.queryByText('使用限制')).not.toBeInTheDocument()
    expect(screen.queryByText('每次最多生成 10 个镜头')).not.toBeInTheDocument()

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
    expect(screen.getByText('当前任务结束后可继续切换模型')).toBeInTheDocument()
    screen.getAllByRole('combobox').forEach((select) => expect(select).toBeDisabled())
  })

  it('explains that workflow models remain switchable when no task is running', async () => {
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
    expect(screen.getByText('流程中可以切换模型；已有对应产物时会先确认并重新生成')).toBeInTheDocument()
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
})
