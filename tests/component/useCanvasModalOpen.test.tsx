import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useCanvasModalOpen } from '@/composables/useCanvasModalOpen'

describe('画布模态阻断', () => {
  it.each([
    '<div data-canvas-nonmodal="true"><div role="dialog" aria-modal="true"></div></div>',
    '<div role="dialog" aria-modal="true"><div data-canvas-nonmodal="true"></div></div>',
  ])('无遮罩的超分浮动窗口不阻断画布：%s', (html) => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    document.body.append(wrapper)
    try {
      const { result } = renderHook(() => useCanvasModalOpen())
      expect(result.current).toBe(false)
    } finally {
      wrapper.remove()
    }
  })
  it('感知子组件 Portal 弹窗，嵌套弹窗全部关闭后才恢复', async () => {
    const { result } = renderHook(() => useCanvasModalOpen())
    const first = document.createElement('div')
    first.setAttribute('aria-modal', 'true')
    const second = first.cloneNode() as HTMLElement
    try {
      expect(result.current).toBe(false)
      document.body.append(first, second)
      await waitFor(() => expect(result.current).toBe(true))
      first.remove()
      await waitFor(() => expect(result.current).toBe(true))
      second.remove()
      await waitFor(() => expect(result.current).toBe(false))
    } finally {
      first.remove()
      second.remove()
    }
  })

  it('保留 DOM 的弹窗关闭后不再阻断，重新打开能再次阻断', async () => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<div role="dialog" aria-modal="true"></div>'
    wrapper.style.display = 'none'
    document.body.append(wrapper)
    try {
      const { result } = renderHook(() => useCanvasModalOpen())
      expect(result.current).toBe(false)
      wrapper.style.display = 'block'
      await waitFor(() => expect(result.current).toBe(true))
      wrapper.style.display = 'none'
      await waitFor(() => expect(result.current).toBe(false))
      wrapper.style.display = 'block'
      await waitFor(() => expect(result.current).toBe(true))
      wrapper.setAttribute('aria-hidden', 'true')
      await waitFor(() => expect(result.current).toBe(false))
    } finally {
      wrapper.remove()
    }
  })
})
