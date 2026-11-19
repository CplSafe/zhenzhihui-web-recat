import { describe, expect, it, vi } from 'vitest'
import { verifySavedReservation } from '@/composables/useCanvasReservation'

describe('节点提交前持久化', () => {
  it('等待保存完成后才允许提交', async () => {
    let saved = ''
    let finish!: () => void
    const flush = () =>
      new Promise<void>((resolve) => {
        finish = () => {
          saved = 'request'
          resolve()
        }
      })
    const submit = vi.fn()
    const pending = verifySavedReservation(flush, () => saved, 'request').then(submit)
    await Promise.resolve()
    expect(submit).not.toHaveBeenCalled()
    finish()
    await pending
    expect(submit).toHaveBeenCalledOnce()
  })
  it('自动保存吸收网络错误或发生冲突时不付费提交', async () => {
    const submit = vi.fn()
    await expect(
      verifySavedReservation(
        async () => undefined,
        () => 'old',
        'new',
      ).then(submit),
    ).rejects.toThrow('未提交生成')
    expect(submit).not.toHaveBeenCalled()
  })
})
