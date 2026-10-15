import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SmartEntry from '@/components/smart/SmartEntry/SmartEntry'

const mocks = vi.hoisted(() => ({
  estimateAiTaskCost: vi.fn(),
}))

vi.mock('@/api/business', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/business')>()),
  estimateAiTaskCost: mocks.estimateAiTaskCost,
}))
vi.mock('@/components/smart/EntryCanvasBg', () => ({ default: () => null }))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  useConfirmDialog: () => ({ requestConfirm: vi.fn() }),
}))

describe('SmartEntry 模型按钮文案', () => {
  it('随「制作视频 / 制作图片」Tab 切换', async () => {
    const user = userEvent.setup()
    render(
      <SmartEntry
        workspaceId={7}
        onSubmit={vi.fn()}
        modelGroups={[
          {
            key: 'video',
            label: '生成视频',
            subgroups: [{ key: 'video.generate', label: '视频生成模型', models: [{ id: 701, name: '视频模型' }] }],
          },
          {
            key: 'image',
            label: '生成图片',
            subgroups: [{ key: 'image.text_to_image', label: '文生图模型', models: [{ id: 801, name: '图片模型' }] }],
          },
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /生成模型/ })).toHaveTextContent('请选择视频模型')
    await user.click(screen.getByRole('tab', { name: '制作图片' }))
    expect(screen.getByRole('button', { name: /生成模型/ })).toHaveTextContent('请选择图片模型')
  })
})

describe('SmartEntry 切换创作类型确认', () => {
  it('空白入口切 Tab 不弹确认；即使分辨率被模型档位归一成大写也不弹', async () => {
    const user = userEvent.setup()
    const requestConfirm = vi.fn().mockResolvedValue(true)
    const toast = await import('@/composables/useToast')
    vi.spyOn(toast, 'useConfirmDialog').mockReturnValue({ requestConfirm } as any)
    render(<SmartEntry workspaceId={7} onSubmit={vi.fn()} initial={{ resolution: '720P' } as any} />)

    await user.click(screen.getByRole('tab', { name: '制作图片' }))
    expect(requestConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: '制作图片' })).toHaveAttribute('aria-selected', 'true')
  })

  it('填了文案再切 Tab 才弹确认', async () => {
    const user = userEvent.setup()
    const requestConfirm = vi.fn().mockResolvedValue(false)
    const toast = await import('@/composables/useToast')
    vi.spyOn(toast, 'useConfirmDialog').mockReturnValue({ requestConfirm } as any)
    render(<SmartEntry workspaceId={7} onSubmit={vi.fn()} initial={{ text: '已有文案' }} />)

    await user.click(screen.getByRole('tab', { name: '制作图片' }))
    expect(requestConfirm).toHaveBeenCalledOnce()
  })
})

describe('SmartEntry 积分预估的 input_assets', () => {
  /**
   * 素材库 / 真人库 / 上次创作带回来的参考图一开始就有真实 asset_id。
   * 预估曾把它们作为裸数字 [731, 732] 下发，后端 input_assets 要求 { asset_id, role } 对象，
   * 整个请求被判为「请求体格式不合法」（10001），入口显示「预估失败」。
   * 本地上传的图在入口阶段 id 为 0 会被过滤掉，所以这个失败看起来是偶发的。
   */
  it('带已有素材的参考图时，按 { asset_id, role } 对象下发，与正式提交同构', async () => {
    const user = userEvent.setup()
    mocks.estimateAiTaskCost.mockResolvedValue({ estimated_cost: 600, balance: 10000, can_afford: true })
    render(
      <SmartEntry
        workspaceId={7}
        onSubmit={vi.fn()}
        initial={{
          text: '三只猫在空间站打架',
          images: ['https://a/1.png', 'https://a/2.png'],
          imageAssetIds: [731, 732],
        }}
        modelGroups={[
          {
            key: 'video',
            label: '生成视频',
            subgroups: [{ key: 'video.generate', label: '视频生成模型', models: [{ id: 701, name: '预估测试模型' }] }],
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /生成模型/ }))
    await user.click(screen.getByRole('option', { name: /预估测试模型/ }))

    await waitFor(() => expect(mocks.estimateAiTaskCost).toHaveBeenCalled(), { timeout: 3000 })
    expect(mocks.estimateAiTaskCost).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operationCode: 'video.generate',
        inputAssets: [
          { asset_id: 731, role: 'image' },
          { asset_id: 732, role: 'image' },
        ],
      }),
    )
  })
})
