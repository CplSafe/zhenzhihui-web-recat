import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useStudioCostEstimate } from '@/composables/useStudioCostEstimate'
import { estimateShotImageCost } from '@/api/smartShotImage'

vi.mock('@/api/smartShotImage', () => ({ estimateShotImageCost: vi.fn() }))

it('带着参考图和提示词给图生图估价，并向界面提供后端的结算说明', async () => {
  const estimate = vi.mocked(estimateShotImageCost)
  estimate.mockResolvedValue({
    estimated_cost: 20,
    can_afford: true,
    balance: 100,
    estimate_note: '完成后按实际用量结算。',
  })
  const input = {
    workspaceId: 7,
    mode: 'image' as const,
    modelVersionId: 26,
    ratio: '1:1',
    resolution: '',
    count: 1,
    prompt: '只替换背景',
    resolveReferenceAssets: async () => ({ imageAssetIds: [101], sourceVideoAssetIds: [] }),
    enabled: true,
  }
  const { result } = renderHook(() => useStudioCostEstimate(input))
  await waitFor(() => expect(result.current.estimate?.total).toBe(20))
  expect(estimate).toHaveBeenCalledWith(
    expect.objectContaining({ modelVersionId: 26, prompt: '只替换背景', refAssetIds: [101] }),
  )
  expect(result.current.estimate?.note).toBe('完成后按实际用量结算。')
})
