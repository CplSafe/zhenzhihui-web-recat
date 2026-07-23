import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiSubmitFeedback: vi.fn(),
  guideKeyForPath: vi.fn(),
  guideLabelForPath: vi.fn(),
  listFeedbackTypes: vi.fn(),
  listMyFeedback: vi.fn(),
  openGuide: vi.fn(),
  showToast: vi.fn(),
  uploadAssetFile: vi.fn(),
}))

vi.mock('@/api/business', () => ({ uploadAssetFile: mocks.uploadAssetFile }))
vi.mock('@/api/feedback', () => ({
  listFeedbackTypes: mocks.listFeedbackTypes,
  listMyFeedback: mocks.listMyFeedback,
  submitFeedback: mocks.apiSubmitFeedback,
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('@/stores/workspaceSession', () => ({ useWorkspaceId: () => 21 }))
vi.mock('@/stores/guide', () => ({
  guideKeyForPath: mocks.guideKeyForPath,
  guideLabelForPath: mocks.guideLabelForPath,
  openGuide: mocks.openGuide,
}))

import HelpCenter from '@/components/common/HelpCenter'

const POSITION_KEY = 'zzh_help_ball_pos'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function renderHelpCenter(path = '/home') {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <HelpCenter />
    </MemoryRouter>,
  )
  const ball = await screen.findByRole('button', { name: 'AI 助手' })
  Object.defineProperty(ball, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(ball, 'releasePointerCapture', { configurable: true, value: vi.fn() })
  return { ...result, ball }
}

function pointerClick(ball: HTMLElement, pointerId = 1) {
  fireEvent.pointerDown(ball, { clientX: 730, clientY: 530, pointerId })
  fireEvent.pointerUp(ball, { clientX: 730, clientY: 530, pointerId })
}

async function openFeedback(user: ReturnType<typeof userEvent.setup>) {
  const ball = screen.getByRole('button', { name: 'AI 助手' })
  pointerClick(ball)
  await user.click(screen.getByRole('button', { name: '意见反馈' }))
  await waitFor(() => expect(mocks.listFeedbackTypes).toHaveBeenCalledTimes(1))
}

describe('HelpCenter interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800, writable: true })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600, writable: true })
    mocks.guideKeyForPath.mockReturnValue('home')
    mocks.guideLabelForPath.mockReturnValue('首页新手引导')
    mocks.listFeedbackTypes.mockResolvedValue([{ id: 7, name: '功能反馈' }])
    mocks.listMyFeedback.mockResolvedValue([])
    mocks.apiSubmitFeedback.mockResolvedValue({ id: 1 })
    mocks.uploadAssetFile.mockResolvedValue({ asset: { id: 31 } })
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  it('starts as a closed floating control and supports keyboard open, Escape close, and focus restoration', async () => {
    const user = userEvent.setup()
    const { ball } = await renderHelpCenter()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    ball.focus()
    await user.keyboard('{Enter}')

    const dialog = screen.getByRole('dialog', { name: 'AI 助手' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('textbox', { name: '搜索帮助内容' })).toHaveFocus()
    expect(ball).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ball).toHaveFocus()
    expect(ball).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not double-toggle when pointer click events are delivered once per gesture', async () => {
    const { ball } = await renderHelpCenter()

    pointerClick(ball, 1)
    expect(screen.getByRole('dialog', { name: 'AI 助手' })).toBeInTheDocument()
    pointerClick(ball, 2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('clamps dragging to the viewport, persists the position, and restores it on remount', async () => {
    const first = await renderHelpCenter()

    fireEvent.pointerDown(first.ball, { clientX: 730, clientY: 530, pointerId: 1 })
    fireEvent.pointerMove(first.ball, { clientX: -1_000, clientY: 1_000, pointerId: 1 })
    expect(first.ball).toHaveStyle({ left: '8px', top: '536px' })
    fireEvent.pointerUp(first.ball, { clientX: -1_000, clientY: 1_000, pointerId: 1 })
    expect(JSON.parse(window.localStorage.getItem(POSITION_KEY) || '{}')).toEqual({ x: 8, y: 536 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    first.unmount()
    const second = await renderHelpCenter()
    expect(second.ball).toHaveStyle({ left: '8px', top: '536px' })
  })

  it('runs guide and tutorial shortcuts with the expected route and safe window features', async () => {
    const user = userEvent.setup()
    const { ball } = await renderHelpCenter('/home')
    pointerClick(ball)

    await user.click(screen.getByRole('button', { name: '首页新手引导' }))
    expect(mocks.guideKeyForPath).toHaveBeenCalledWith('/home')
    expect(mocks.openGuide).toHaveBeenCalledWith('home')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    pointerClick(ball, 2)
    await user.click(screen.getByRole('button', { name: '2分钟学会使用帧智汇' }))
    expect(window.open).toHaveBeenCalledWith(
      'https://zcnyqlah2rse.feishu.cn/wiki/LeMwwtrRQiJyxKkMepOcnbIDnvg',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('validates empty feedback and submits its selected category only once while pending', async () => {
    const user = userEvent.setup()
    const pending = deferred<any>()
    mocks.apiSubmitFeedback.mockReturnValue(pending.promise)
    await renderHelpCenter()
    await openFeedback(user)

    await user.click(screen.getByRole('button', { name: '提交反馈' }))
    expect(mocks.showToast).toHaveBeenCalledWith('请先填写反馈内容', 'info')
    await user.type(screen.getByRole('textbox', { name: '反馈内容' }), '导出按钮点击后没有响应')
    await user.type(screen.getByRole('textbox', { name: '联系方式' }), '17633125265')
    await user.click(screen.getByRole('button', { name: '人物脸部崩坏' }))
    await user.dblClick(screen.getByRole('button', { name: '提交反馈' }))

    expect(mocks.apiSubmitFeedback).toHaveBeenCalledTimes(1)
    expect(mocks.apiSubmitFeedback).toHaveBeenCalledWith({
      assetIds: [],
      contact: '17633125265',
      content: '【功能反馈 / 生成效果不佳】 人物脸部崩坏\n导出按钮点击后没有响应',
      feedbackType: 7,
    })
    expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled()

    await act(async () => {
      pending.resolve({ id: 1 })
      await pending.promise
    })
    expect(mocks.showToast).toHaveBeenCalledWith('感谢反馈,我们会尽快处理', 'success')
  })

  it('revokes attachment URLs and ignores a late feedback result after unmount', async () => {
    const user = userEvent.setup()
    const pending = deferred<any>()
    const createObjectURL = vi.fn(() => 'blob:feedback-preview')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    mocks.apiSubmitFeedback.mockReturnValue(pending.promise)
    const result = await renderHelpCenter()
    await openFeedback(user)

    await user.upload(screen.getByLabelText('上传反馈附件'), new File(['image'], 'proof.png', { type: 'image/png' }))
    await user.type(screen.getByRole('textbox', { name: '反馈内容' }), '上传后提交反馈')
    await user.click(screen.getByRole('button', { name: '提交反馈' }))
    await waitFor(() => expect(mocks.apiSubmitFeedback).toHaveBeenCalledTimes(1))
    result.unmount()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:feedback-preview')
    await act(async () => {
      pending.resolve({ id: 2 })
      await pending.promise
    })
    expect(mocks.showToast).not.toHaveBeenCalledWith('感谢反馈,我们会尽快处理', 'success')
  })

  it('removes resize, pointer, and keyboard listeners when unmounted', async () => {
    const addWindow = vi.spyOn(window, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const result = await renderHelpCenter()
    pointerClick(result.ball)

    const resizeHandler = addWindow.mock.calls.find(([name]) => name === 'resize')?.[1]
    const pointerHandler = addDocument.mock.calls.find(([name]) => name === 'pointerdown')?.[1]
    const keyboardHandler = addDocument.mock.calls.find(([name]) => name === 'keydown')?.[1]
    expect(resizeHandler).toBeTypeOf('function')
    expect(pointerHandler).toBeTypeOf('function')
    expect(keyboardHandler).toBeTypeOf('function')

    result.unmount()
    expect(removeWindow).toHaveBeenCalledWith('resize', resizeHandler)
    expect(removeDocument).toHaveBeenCalledWith('pointerdown', pointerHandler)
    expect(removeDocument).toHaveBeenCalledWith('keydown', keyboardHandler)
  })
})
