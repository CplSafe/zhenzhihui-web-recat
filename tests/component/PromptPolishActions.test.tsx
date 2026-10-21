import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import PromptPolishActions from '@/components/common/PromptPolishActions'

const mocks = vi.hoisted(() => ({ polish: vi.fn(), toast: vi.fn() }))
vi.mock('@/api/entryPromptPolish', () => ({ polishEntryPrompt: mocks.polish }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
const base = { workspaceId: 21, scopeKey: '7:21:video', kind: 'video', images: ['image.png'], imageAssetIds: [9] }
beforeEach(() => vi.clearAllMocks())

it('携带当前参考图润色、回填，并可逐次复原', async () => {
  mocks.polish.mockResolvedValueOnce('优化一').mockResolvedValueOnce('优化二')
  function Entry() {
    const [value, setValue] = useState('原文 @图片1')
    return (
      <>
        <output>{value}</output>
        <PromptPolishActions {...base} value={value} onChange={setValue} />
      </>
    )
  }
  render(<Entry />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '我帮你写' }))
  expect(mocks.polish).toHaveBeenCalledWith('原文 @图片1', 21, 'video', {
    images: ['image.png'],
    imageAssetIds: [9],
    signal: expect.any(AbortSignal),
  })
  expect(screen.getByRole('status')).toHaveTextContent('优化一')
  await user.click(screen.getByRole('button', { name: '我帮你写' }))
  await user.click(screen.getByRole('button', { name: '复原' }))
  expect(screen.getByRole('status')).toHaveTextContent('优化一')
  await user.click(screen.getByRole('button', { name: '复原' }))
  expect(screen.getByRole('status')).toHaveTextContent('原文 @图片1')
  expect(screen.queryByRole('button', { name: '复原' })).not.toBeInTheDocument()
})

it('游客先登录，空文案不可润色', async () => {
  const login = vi.fn()
  const { rerender } = render(
    <PromptPolishActions {...base} value="主题" onChange={vi.fn()} authRequired onAuthRequired={login} />,
  )
  await userEvent.click(screen.getByRole('button', { name: '我帮你写' }))
  expect(login).toHaveBeenCalledOnce()
  expect(mocks.polish).not.toHaveBeenCalled()
  rerender(<PromptPolishActions {...base} value=" " onChange={vi.fn()} />)
  expect(screen.getByRole('button', { name: '我帮你写' })).toBeDisabled()
})

it('失败保留原文并提示，发送给模型的文本可去除技能标记', async () => {
  mocks.polish.mockRejectedValueOnce(new Error('接口不可用'))
  const change = vi.fn()
  render(<PromptPolishActions {...base} value="主题\n技能标记" inputText="主题" onChange={change} />)
  await userEvent.click(screen.getByRole('button', { name: '我帮你写' }))
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('接口不可用', 'error'))
  expect(mocks.polish.mock.calls[0][0]).toBe('主题')
  expect(change).not.toHaveBeenCalled()
})

it.each(['文字', '素材', '模式'] as const)('润色中更换%s，旧结果不会覆盖，且不能重复发起', async (field) => {
  let resolve!: (value: string) => void
  mocks.polish.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done
    }),
  )
  const change = vi.fn()
  const { rerender } = render(<PromptPolishActions {...base} value="原文" onChange={change} />)
  await userEvent.click(screen.getByRole('button', { name: '我帮你写' }))
  expect(screen.getByRole('button', { name: '润色中…' })).toBeDisabled()
  rerender(
    <PromptPolishActions
      {...base}
      value={field === '文字' ? '新文案' : '原文'}
      images={field === '素材' ? ['other.png'] : base.images}
      scopeKey={field === '模式' ? 'new-mode' : base.scopeKey}
      onChange={change}
    />,
  )
  await act(async () => resolve('旧结果'))
  expect(change).not.toHaveBeenCalled()
  expect(mocks.polish).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: '我帮你写' })).toBeEnabled()
})

it('卸载取消进行中的请求', async () => {
  mocks.polish.mockReturnValue(new Promise(() => {}))
  const { unmount } = render(<PromptPolishActions {...base} value="原文" onChange={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: '我帮你写' }))
  const signal = mocks.polish.mock.calls[0][3].signal as AbortSignal
  unmount()
  expect(signal.aborted).toBe(true)
})
