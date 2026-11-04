import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('节点样式变化不扫描弹窗，真正的弹窗及其可见状态仍可更新', async () => {
    const node = document.createElement('div')
    document.body.append(node)
    const query = vi.spyOn(document, 'querySelectorAll')
    const { result } = renderHook(() => useCanvasModalOpen())
    const initialScans = query.mock.calls.length
    try {
      await act(async () => {
        node.style.transform = 'translate(10px, 10px)'
        node.style.transform = 'translate(20px, 20px)'
      })
      expect(query.mock.calls.length).toBe(initialScans)
      const dialog = document.createElement('div')
      dialog.setAttribute('aria-modal', 'true')
      node.append(dialog)
      await waitFor(() => expect(result.current).toBe(true))
      node.hidden = true
      await waitFor(() => expect(result.current).toBe(false))
      node.hidden = false
      await waitFor(() => expect(result.current).toBe(true))
      dialog.setAttribute('data-canvas-nonmodal', 'true')
      await waitFor(() => expect(result.current).toBe(false))
    } finally {
      node.remove()
      query.mockRestore()
    }
  })
})
