import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GenerationModelPicker, {
  getMissingGenerationModelKeys,
  isGenerationModelSelectionComplete,
  type GenerationModelGroup,
} from '@/components/smart/GenerationModelPicker'

const groups: GenerationModelGroup[] = [
  {
    key: 'responses.multimodal',
    label: '生成脚本',
    models: [
      { id: 101, name: '后端脚本模型甲', description: '后端提供的模型说明' },
      { id: 102, name: '后端脚本模型乙', tags: ['快速'] },
    ],
  },
  {
    key: 'image',
    label: '生成图片',
    subgroups: [
      {
        key: 'image.text_to_image',
        label: '文生图',
        models: [{ id: 201, name: '后端图片模型甲' }],
      },
      {
        key: 'image.image_to_image',
        label: '图生图',
        models: [{ id: 202, name: '后端图片模型乙' }],
      },
    ],
  },
  {
    key: 'video.generate',
    label: '生成视频',
    models: [{ id: '301', name: '后端视频模型甲' }],
  },
  {
    key: 'video.edit',
    label: '修改视频',
    models: [{ id: 401, name: '后端编辑模型甲', disabled: true, unavailableReason: '当前空间不可用' }],
  },
  {
    key: 'empty.operation',
    label: '空模型类型',
    models: [],
  },
]

describe('GenerationModelPicker', () => {
  it('renders every non-empty backend group and its backend-provided model names', () => {
    render(<GenerationModelPicker groups={groups} selected={{}} onChange={vi.fn()} />)

    expect(screen.getByRole('list', { name: '生成模型流程' })).toBeInTheDocument()
    expect(screen.getAllByText('生成脚本').length).toBeGreaterThan(0)
    expect(screen.getAllByText('生成图片').length).toBeGreaterThan(0)
    expect(screen.getAllByText('生成视频').length).toBeGreaterThan(0)
    expect(screen.getAllByText('修改视频').length).toBeGreaterThan(0)
    expect(screen.queryByText('空模型类型')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /后端脚本模型甲/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /后端图片模型乙/ })).toBeInTheDocument()
  })

  it('uses subgroup operation codes for image choices and reports the owning stage', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<GenerationModelPicker groups={groups} selected={{}} onChange={onChange} />)

    const imageToImage = screen.getByRole('radiogroup', { name: '图生图模型选择' })
    await user.click(within(imageToImage).getByRole('radio', { name: /后端图片模型乙/ }))

    expect(onChange).toHaveBeenCalledWith('image', 202, 'image.image_to_image')
  })

  it('marks a selected backend model and exposes selection completeness helpers', () => {
    const selected = {
      'responses.multimodal': 101,
      'image.text_to_image': 201,
      'image.image_to_image': 202,
      'video.generate': 301,
    }
    render(<GenerationModelPicker groups={groups} selected={selected} onChange={vi.fn()} />)

    expect(screen.getByRole('radio', { name: /后端脚本模型甲/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('4/5 已选择')).toBeInTheDocument()
    expect(getMissingGenerationModelKeys(groups, selected)).toEqual(['video.edit'])
    expect(isGenerationModelSelectionComplete(groups, selected)).toBe(false)
    expect(isGenerationModelSelectionComplete(groups, { ...selected, 'video.edit': 401 })).toBe(false)
    expect(isGenerationModelSelectionComplete([], {})).toBe(false)
  })

  it('renders accessible loading and error states and retries the matching operation', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <GenerationModelPicker
        groups={groups}
        selected={{}}
        loading={{ 'responses.multimodal': true }}
        error={{ 'video.generate': '模型目录加载失败' }}
        onChange={vi.fn()}
        onRetry={onRetry}
      />,
    )

    expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('正在加载可用模型'))).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent('模型目录加载失败')
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: '重新加载' }))
    expect(onRetry).toHaveBeenCalledWith('video.generate', undefined)
  })

  it('keeps the complete track while compact mode shows only the active stage details', () => {
    render(
      <GenerationModelPicker
        groups={groups}
        selected={{}}
        onChange={vi.fn()}
        compact
        activeStageKey="video.generate"
      />,
    )

    const track = screen.getByRole('list', { name: '生成模型流程' })
    expect(within(track).getByText('生成脚本')).toBeInTheDocument()
    expect(within(track).getByText('生成视频')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: '生成视频' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: '生成脚本' })).not.toBeInTheDocument()
  })

  it('supports keyboard-accessible collapsing and keeps unavailable models disabled', async () => {
    const user = userEvent.setup()
    render(
      <GenerationModelPicker
        groups={groups}
        selected={{}}
        onChange={vi.fn()}
        collapsible
        activeStageKey="video.edit"
      />,
    )

    const editHeading = screen.getByRole('heading', { level: 3, name: '修改视频' })
    const editStage = editHeading.closest('section')!
    const collapse = within(editStage).getByRole('button', { name: '收起' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(within(editStage).getByRole('radio', { name: /后端编辑模型甲/ })).toBeDisabled()
    expect(within(editStage).getByText('当前空间不可用')).toBeInTheDocument()

    collapse.focus()
    await user.keyboard('{Enter}')
    expect(within(editStage).getByRole('button', { name: '展开' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(editStage).queryByRole('radio', { name: /后端编辑模型甲/ })).not.toBeInTheDocument()
  })

  it('returns no empty shell when the catalog contains no models', () => {
    const { container } = render(
      <GenerationModelPicker
        groups={[{ key: 'empty', label: '空类型', models: [] }]}
        selected={{}}
        onChange={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
