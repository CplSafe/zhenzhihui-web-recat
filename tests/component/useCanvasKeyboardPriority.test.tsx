import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasKeyboardLockCodes, useCanvasKeyboardPriority } from '@/composables/useCanvasKeyboardPriority'
import { DEFAULT_CANVAS_SHORTCUTS } from '@/utils/canvasKeyboard'
import { showToast } from '@/stores/ui'

vi.mock('@/stores/ui', () => ({ showToast: vi.fn() }))
const originalKeyboard = Object.getOwnPropertyDescriptor(navigator, 'keyboard')
let fullscreen: Element | null
let root: HTMLDivElement
const lock = vi.fn<(_codes: string[]) => Promise<void>>()
const unlock = vi.fn()
const enter = vi.fn<() => Promise<void>>()
const exit = vi.fn<() => Promise<void>>()
function fullscreenChange(value: Element | null) {
  fullscreen = value
  document.dispatchEvent(new Event('fullscreenchange'))
}
function setup() {
  return renderHook(({ bindings }) => useCanvasKeyboardPriority({ current: root }, bindings), {
    initialProps: { bindings: DEFAULT_CANVAS_SHORTCUTS },
  })
}

beforeEach(() => {
  fullscreen = null
  root = document.createElement('div')
  root.tabIndex = -1
  document.body.append(root)
  lock.mockReset().mockResolvedValue(undefined)
  unlock.mockReset()
  enter.mockReset().mockImplementation(async () => fullscreenChange(document.documentElement))
  exit.mockReset().mockImplementation(async () => fullscreenChange(null))
  Object.defineProperty(navigator, 'keyboard', { configurable: true, value: { lock, unlock } })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: enter })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
})
afterEach(() => {
  cleanup()
  if (originalKeyboard) Object.defineProperty(navigator, 'keyboard', originalKeyboard)
  else Reflect.deleteProperty(navigator, 'keyboard')
  Reflect.deleteProperty(document, 'fullscreenElement')
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
  Reflect.deleteProperty(document, 'exitFullscreen')
  document.body.replaceChildren()
})

describe('画布全屏快捷键优先', () => {
  it('只申请命令涉及的键，不捕获 Esc、Tab、浏览器切页和关闭键', () => {
    const codes = canvasKeyboardLockCodes(DEFAULT_CANVAS_SHORTCUTS)
    expect(codes).toEqual(
      expect.arrayContaining([
        'KeyL',
        'KeyH',
        'KeyD',
        'Digit0',
        'Digit1',
        'Equal',
        'Minus',
        'NumpadAdd',
        'NumpadSubtract',
      ]),
    )
    for (const code of ['Escape', 'Tab', 'KeyW', 'KeyT', 'AltLeft']) expect(codes).not.toContain(code)
    expect(
      canvasKeyboardLockCodes({ ...DEFAULT_CANVAS_SHORTCUTS, add: 'Mod+K', fitView: 'F2', panTool: 'Space' }),
    ).toEqual(expect.arrayContaining(['KeyK', 'F2', 'Space']))
  })
  it('主动全屏后申请锁定、恢复画布焦点；按钮退出释放锁定', async () => {
    const { result } = setup()
    await act(() => result.current.toggle())
    expect(enter).toHaveBeenCalledOnce()
    expect(lock).toHaveBeenCalledOnce()
    expect(result.current.enabled).toBe(true)
    expect(root).toHaveFocus()
    await act(() => result.current.toggle())
    expect(unlock).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledOnce()
    expect(result.current.enabled).toBe(false)
  })
  it('Esc 或浏览器退出全屏后清除状态，卸载时不影响其它全屏', async () => {
    const { result, unmount } = setup()
    await act(() => result.current.toggle())
    act(() => fullscreenChange(null))
    expect(result.current.enabled).toBe(false)
    fullscreen = document.createElement('video')
    unmount()
    expect(exit).not.toHaveBeenCalled()
  })
  it('离开画布时释放自己持有的全屏和键盘锁定', async () => {
    const { result, unmount } = setup()
    await act(() => result.current.toggle())
    unmount()
    expect(unlock).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledOnce()
  })
  it('权限拒绝后回退普通模式并提示，不虚报成功', async () => {
    lock.mockRejectedValue(new Error('Permission denied'))
    const { result } = setup()
    await act(() => result.current.toggle())
    expect(result.current.enabled).toBe(false)
    expect(result.current.pending).toBe(false)
    expect(exit).toHaveBeenCalledOnce()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('键盘锁定权限'), 'error')
  })
  it('不支持接口或已有其它全屏时不会发起锁定', async () => {
    const { result } = setup()
    fullscreen = document.createElement('video')
    await act(() => result.current.toggle())
    expect(enter).not.toHaveBeenCalled()
    fullscreen = null
    Object.defineProperty(navigator, 'keyboard', { configurable: true, value: undefined })
    await act(() => result.current.toggle())
    expect(lock).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('不支持'), 'info')
  })
  it('全屏请求失败时不申请键盘锁定', async () => {
    enter.mockRejectedValue(new Error('Fullscreen denied'))
    const { result } = setup()
    await act(() => result.current.toggle())
    expect(lock).not.toHaveBeenCalled()
    expect(result.current.enabled).toBe(false)
    expect(result.current.pending).toBe(false)
  })
  it('更新自定义绑定时更新锁定范围', async () => {
    const { result, rerender } = setup()
    await act(() => result.current.toggle())
    rerender({ bindings: { ...DEFAULT_CANVAS_SHORTCUTS, connect: 'Mod+K' } })
    await waitFor(() => expect(lock).toHaveBeenCalledTimes(2))
    expect(lock.mock.lastCall?.[0]).toContain('KeyK')
    expect(lock.mock.lastCall?.[0]).not.toContain('KeyL')
  })
  it('等待授权期间重复点击只请求一次，退出全屏后不会迟到开启', async () => {
    let resolve!: () => void
    lock.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    const { result } = setup()
    let pending!: Promise<void>
    await act(async () => {
      pending = result.current.toggle()
      await Promise.resolve()
    })
    await act(() => result.current.toggle())
    expect(lock).toHaveBeenCalledOnce()
    act(() => fullscreenChange(null))
    await act(async () => {
      resolve()
      await pending
    })
    expect(result.current.enabled).toBe(false)
    expect(result.current.pending).toBe(false)
  })
  it('全屏请求晚于卸载完成时仍退出，不遗留全屏', async () => {
    let resolve!: () => void
    enter.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = () => {
            fullscreenChange(document.documentElement)
            done()
          }
        }),
    )
    const { result, unmount } = setup()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.toggle()
    })
    unmount()
    await act(async () => {
      resolve()
      await pending
    })
    expect(exit).toHaveBeenCalledOnce()
    expect(lock).not.toHaveBeenCalled()
  })
})
