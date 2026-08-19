import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CanvasNodePanel from '@/components/canvas/CanvasNodePanel'

/** 一个接了参考图的图片节点：走 image.image_to_image。 */
function imageNodeWithReference() {
  return {
    id: 'node-image',
    kind: 'image',
    prompt: '保留参考图中的年轻男性主体',
    sourceRefs: [{ kind: 'image', sourceId: 'node-ref', edgeId: 'e-ref', slotIndex: 0, assetId: 77 }],
  }
}

/** models 按节点类型分组，且每个模型要声明它支持的 operation_code。 */
function renderPanel(imageModels: any[], node: any = imageNodeWithReference(), extraProps: Record<string, any> = {}) {
  render(
    <CanvasNodePanel
      node={node as any}
      workspaceId={7}
      models={{ text: [], image: imageModels, video: [] } as any}
      modelsLoading={false}
      onGenerate={vi.fn()}
      onModelChange={vi.fn()}
      {...extraProps}
    />,
  )
}

/** 带 params_schema 的模型：面板据此渲染参数菜单。 */
function modelWithFields(fields: any[]) {
  return {
    modelVersionId: 31,
    displayName: '参数模型',
    operationCodes: IMAGE_OPERATIONS,
    source: { params_schema: { fields } },
  }
}

/** 同时支持文生图与图生图，用例只关心可用性而不是能力划分。 */
const IMAGE_OPERATIONS = ['image.text_to_image', 'image.image_to_image']

describe('CanvasNodePanel 模型选择器', () => {
  it('模型被会员/余额挡住时说明原因，而不是显示一句点不开的「暂无可用模型」', async () => {
    const user = userEvent.setup()
    renderPanel([
      {
        modelVersionId: 12,
        displayName: 'Seedream 图生图',
        operationCodes: IMAGE_OPERATIONS,
        unavailableReason: '当前套餐暂无该模型，请充值或开通会员后使用',
      },
    ])

    // 控件本身先给出「不可用」而不是「不存在」
    const selector = screen.getByRole('button', { name: '模型暂不可用' })
    expect(selector).toHaveAttribute('title', '当前套餐暂无该模型，请充值或开通会员后使用')

    // 而且必须点得开：展开后逐条写明为什么用不了
    await user.click(selector)
    expect(screen.getByText('Seedream 图生图')).toBeInTheDocument()
    expect(screen.getByText('当前套餐暂无该模型，请充值或开通会员后使用')).toBeInTheDocument()
  })

  it('目录里确实没有这类模型时，指名道姓说清缺的是哪种能力', () => {
    renderPanel([])
    // 接了参考图走图生图；笼统说「暂无可用模型」会让人以为是素材或连线出了问题
    expect(screen.getByRole('button', { name: '暂无可用的图生图模型' })).toBeInTheDocument()
  })

  it('没接参考图时缺的是文生图模型，两种能力在后端是各自独立的', () => {
    renderPanel([], { id: 'node-image', kind: 'image', prompt: '一只猫', sourceRefs: [] })
    expect(screen.getByRole('button', { name: '暂无可用的文生图模型' })).toBeInTheDocument()
  })

  it('缺模型时生成按钮的提示直接说明被什么挡住', () => {
    renderPanel([])
    // 选择器和生成按钮给的是同一句原因：用户看向哪一个都能拿到答案，
    // 而不是对着一个灰掉的按钮和一句「发送生成」自己猜
    const explained = screen.getAllByTitle('暂无可用的图生图模型')
    expect(explained).toHaveLength(2)
    expect(explained.some((el) => (el as HTMLButtonElement).disabled)).toBe(true)
  })

  it('有可用模型时正常显示模型名并可切换', async () => {
    const user = userEvent.setup()
    renderPanel([
      { modelVersionId: 21, displayName: '可用模型 A', operationCodes: IMAGE_OPERATIONS },
      { modelVersionId: 22, displayName: '可用模型 B', operationCodes: IMAGE_OPERATIONS },
    ])

    const selector = screen.getByRole('button', { name: '可用模型 A' })
    await user.click(selector)
    expect(screen.getByRole('button', { name: '可用模型 B' })).toBeInTheDocument()
  })
})

describe('CanvasNodePanel 视频生视频用的是视频生成模型', () => {
  const VIDEO_GENERATE = ['video.generate']
  const VIDEO_EDIT = ['video.edit']

  /** 一个接了源视频的视频节点：视频生视频。 */
  const videoToVideoNode = {
    id: 'node-video',
    kind: 'video',
    prompt: '把镜头推近一点',
    sourceRefs: [{ kind: 'video', sourceId: 'node-src', edgeId: 'e-src', slotIndex: 0, assetId: 91 }],
  }

  function renderVideoPanel(videoModels: any[], node: any = videoToVideoNode, extraProps: Record<string, any> = {}) {
    render(
      <CanvasNodePanel
        node={node as any}
        workspaceId={7}
        models={{ text: [], image: [], video: videoModels } as any}
        modelsLoading={false}
        onGenerate={vi.fn()}
        onModelChange={vi.fn()}
        {...extraProps}
      />,
    )
  }

  it('接了源视频时列出的是视频生成模型，而不是只声明 video.edit 的编辑模型', () => {
    renderVideoPanel([
      { modelVersionId: 41, displayName: 'Seedance 视频生成', operationCodes: VIDEO_GENERATE },
      { modelVersionId: 42, displayName: 'happyhorse 视频编辑', operationCodes: VIDEO_EDIT },
    ])

    // 以前这里会切成 video.edit，下拉里只剩编辑模型，用户选不到自己想用的生成模型
    expect(screen.getByRole('button', { name: 'Seedance 视频生成' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'happyhorse 视频编辑' })).not.toBeInTheDocument()
  })

  it('改自己那条视频时同样走视频生成模型', () => {
    renderVideoPanel([{ modelVersionId: 41, displayName: 'Seedance 视频生成', operationCodes: VIDEO_GENERATE }], {
      id: 'node-video',
      kind: 'video',
      prompt: '调暖一点',
      resultUrl: 'https://example.com/a.mp4',
      assetId: 77,
      sourceRefs: [],
    })

    expect(screen.getByRole('button', { name: 'Seedance 视频生成' })).toBeInTheDocument()
  })

  it('节点上存着历史的 video.edit 也不会把用户拽回编辑模型', () => {
    renderVideoPanel(
      [
        { modelVersionId: 41, displayName: 'Seedance 视频生成', operationCodes: VIDEO_GENERATE },
        { modelVersionId: 42, displayName: 'happyhorse 视频编辑', operationCodes: VIDEO_EDIT },
      ],
      { ...videoToVideoNode, operationCode: 'video.edit' },
    )

    expect(screen.getByRole('button', { name: 'Seedance 视频生成' })).toBeInTheDocument()
  })

  /**
   * 只按 operation 过滤是不够的：「参考生视频」这类同样声明 video.generate，
   * 但输入只认参考图。选中提交后要等后端回一句「素材类型不适用于当前操作」才知道，
   * 而那一步已经付过费了。
   */
  it('接了源视频时，不吃视频的模型标为不可用并写明原因', async () => {
    const user = userEvent.setup()
    renderVideoPanel([
      { modelVersionId: 41, displayName: 'Seedance 图生视频', operationCodes: VIDEO_GENERATE },
      { modelVersionId: 43, displayName: 'HappyHorse 参考生视频', operationCodes: VIDEO_GENERATE },
    ])

    // 默认选中的必须是收视频的那个，而不是排在后面的参考生视频
    const selector = screen.getByRole('button', { name: 'Seedance 图生视频' })
    await user.click(selector)
    expect(screen.getByText('该模型不支持把视频作为输入素材，请改用图生视频类模型，或去掉视频连线')).toBeInTheDocument()
  })

  it('没有视频输入时不做这道筛选：参考生视频照常可选', () => {
    renderVideoPanel([{ modelVersionId: 43, displayName: 'HappyHorse 参考生视频', operationCodes: VIDEO_GENERATE }], {
      id: 'node-video',
      kind: 'video',
      prompt: '一只猫',
      sourceRefs: [],
    })

    expect(screen.getByRole('button', { name: 'HappyHorse 参考生视频' })).toBeInTheDocument()
  })

  it('提交时带出去的是 video.generate 与那条源视频来源', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    renderVideoPanel(
      [{ modelVersionId: 41, displayName: 'Seedance 视频生成', operationCodes: VIDEO_GENERATE }],
      undefined,
      { onGenerate },
    )

    await user.click(screen.getByTitle('发送生成'))
    // 素材角色由 buildCanvasInputAssets 按来源类型决定（视频来源恒为 role:'video'），与 operation 无关；
    // 这里只确认面板交出去的 operation 和来源是对的
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        operationCode: 'video.generate',
        sourceRefs: [expect.objectContaining({ kind: 'video', assetId: 91 })],
      }),
    )
  })
})

describe('CanvasNodePanel 参数字段', () => {
  it('随机种子整条不暴露，其余字段照常渲染', async () => {
    const user = userEvent.setup()
    renderPanel([
      modelWithFields([
        { name: 'resolution', display_name: '分辨率', type: 'select', options: ['720P', '1080P'], default: '1080P' },
        { name: 'seed', display_name: '随机种子', type: 'number', min: 0, max: 2147483647 },
      ]),
    ])

    await user.click(screen.getByRole('button', { name: /1080P/ }))
    expect(screen.getByText('分辨率')).toBeInTheDocument()
    // 种子对使用者没有可理解含义，菜单里不该出现
    expect(screen.queryByText('随机种子')).not.toBeInTheDocument()
  })

  it('random_seed / noise_seed 等别名同样被剔除', async () => {
    const user = userEvent.setup()
    renderPanel([
      modelWithFields([
        { name: 'resolution', display_name: '分辨率', type: 'select', options: ['720P'], default: '720P' },
        { name: 'random_seed', display_name: '随机种子', type: 'number' },
        { name: 'noise_seed', display_name: '噪声种子', type: 'number' },
      ]),
    ])

    await user.click(screen.getByRole('button', { name: /720P/ }))
    expect(screen.queryByText('随机种子')).not.toBeInTheDocument()
    expect(screen.queryByText('噪声种子')).not.toBeInTheDocument()
  })
})

describe('CanvasNodePanel 继承自文本节点的提示词', () => {
  const textNode = {
    id: 'node-image',
    kind: 'image',
    prompt: '再加一点暖光',
    sourceRefs: [{ kind: 'text', sourceId: 'node-text', edgeId: 'e-text', slotIndex: 0 }],
  }

  it('把继承来的文本显示出来，并说明它会拼在输入框之前', () => {
    renderPanel([{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }], textNode, {
      inheritedTexts: [{ sourceId: 'node-text', edgeId: 'e-text', text: '一只橘猫坐在窗台上' }],
    })

    // 以前这段内容只在提交时被静默前置，界面上毫无痕迹，用户只会以为文本没跟过来
    expect(screen.getByText('一只橘猫坐在窗台上')).toBeInTheDocument()
    expect(screen.getByText('来自文本节点')).toBeInTheDocument()
    expect(screen.getByText('提交时这段内容会拼在下方输入框之前')).toBeInTheDocument()
    // 自己的提示词仍在输入框里独立编辑
    expect(screen.getByDisplayValue('再加一点暖光')).toBeInTheDocument()
  })

  it('提交时按「继承文本 → 自己的提示词」顺序拼接，与界面展示同源', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    renderPanel([{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }], textNode, {
      onGenerate,
      inheritedTexts: [{ sourceId: 'node-text', edgeId: 'e-text', text: '一只橘猫坐在窗台上' }],
    })

    await user.click(screen.getByTitle('发送生成'))

    // 展示的那段和发出去的那段必须是同一份数据，中间不再各自去读全局 Map
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ prompt: '一只橘猫坐在窗台上\n\n再加一点暖光' }))
  })

  it('自己的提示词为空时也能提交，只发继承来的那段', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    renderPanel(
      [{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }],
      { ...textNode, prompt: '' },
      { onGenerate, inheritedTexts: [{ sourceId: 'node-text', edgeId: 'e-text', text: '一只橘猫坐在窗台上' }] },
    )

    await user.click(screen.getByTitle('发送生成'))
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ prompt: '一只橘猫坐在窗台上' }))
  })

  it('输入框为空时自动填入上游文本，改完即可直接生成', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    const onPromptChange = vi.fn()
    renderPanel(
      [{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }],
      { ...textNode, prompt: '' },
      {
        onGenerate,
        onPromptChange,
        inheritedTexts: [{ sourceId: 'node-text', edgeId: 'e-text', text: '一只橘猫坐在窗台上' }],
      },
    )

    // 不用再点一次「转为可编辑」：文本已经在输入框里，可以直接改
    const textarea = screen.getByPlaceholderText(/描述你想要生成的/) as HTMLTextAreaElement
    expect(textarea.value).toBe('一只橘猫坐在窗台上')
    // 同时写回节点，切走再切回来 / 刷新后不会丢
    expect(onPromptChange).toHaveBeenCalledWith('一只橘猫坐在窗台上')
    // 已经进了输入框就不再单独展示，免得同一段内容在面板上出现两份
    expect(screen.queryByText(/来自文本节点/)).not.toBeInTheDocument()

    await user.type(textarea, '，暖色调')
    await user.click(screen.getByTitle('发送生成'))
    // 连线仍在，但这段内容不能因此被拼两遍
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ prompt: '一只橘猫坐在窗台上，暖色调' }))
  })

  it('输入框已有内容时不覆盖，剩下的继承文本仍照旧拼在前面', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    renderPanel([{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }], textNode, {
      onGenerate,
      inheritedTexts: [{ sourceId: 'node-text', edgeId: 'e-text', text: '一只橘猫坐在窗台上' }],
    })

    // 自动填入唯一会出问题的方向就是覆盖用户已经写下的字，这里守住它
    const textarea = screen.getByPlaceholderText(/描述你想要生成的/) as HTMLTextAreaElement
    expect(textarea.value).toBe('再加一点暖光')
    await user.click(screen.getByTitle('发送生成'))
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ prompt: '一只橘猫坐在窗台上\n\n再加一点暖光' }))
  })

  it('多段继承文本按连线顺序全部展示', () => {
    renderPanel([{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }], textNode, {
      inheritedTexts: [
        { sourceId: 'node-text-1', edgeId: 'e1', text: '第一段' },
        { sourceId: 'node-text-2', edgeId: 'e2', text: '第二段' },
      ],
    })

    expect(screen.getByText('来自文本节点 · 2 段')).toBeInTheDocument()
    expect(screen.getByText('第一段')).toBeInTheDocument()
    expect(screen.getByText('第二段')).toBeInTheDocument()
  })

  it('没有文本来源时不出现这块区域，输入框保持原样', () => {
    renderPanel([{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }])
    expect(screen.queryByText(/来自文本节点/)).not.toBeInTheDocument()
  })

  it('默认收起，展开后可再收起——长提示词不该一上来就把输入框挤出面板', async () => {
    const user = userEvent.setup()
    renderPanel([{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }], textNode, {
      inheritedTexts: [{ sourceId: 'node-text', edgeId: 'e-text', text: '很长的一段提示词'.repeat(20) }],
    })

    const toggle = screen.getByRole('button', { name: '展开' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    const collapse = screen.getByRole('button', { name: '收起' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')

    // 收起态下正文仍在 DOM 里（只是被裁剪显示），拼接不受展开与否影响
    await user.click(collapse)
    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument()
  })

  it('收起状态不影响提交内容：发出去的仍是完整文本', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    const long = '很长的一段提示词'.repeat(20)
    renderPanel([{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }], textNode, {
      onGenerate,
      inheritedTexts: [{ sourceId: 'node-text', edgeId: 'e-text', text: long }],
    })

    // 不展开直接提交
    await user.click(screen.getByTitle('发送生成'))
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ prompt: `${long}\n\n再加一点暖光` }))
  })

  it('「转为可编辑」把内容交给调用方转移，不是就地复制成第二份', async () => {
    const user = userEvent.setup()
    const onAdoptInheritedText = vi.fn()
    renderPanel([{ modelVersionId: 21, displayName: '可用模型', operationCodes: IMAGE_OPERATIONS }], textNode, {
      inheritedTexts: [{ sourceId: 'node-text', edgeId: 'e-text', text: '一只橘猫坐在窗台上' }],
      onAdoptInheritedText,
    })

    await user.click(screen.getByRole('button', { name: '转为可编辑' }))
    expect(onAdoptInheritedText).toHaveBeenCalledTimes(1)
  })
})
