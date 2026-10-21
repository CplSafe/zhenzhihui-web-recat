import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import ViewportFloatingPanel from '@/components/canvas/ViewportFloatingPanel'

it.each([0.5, 1, 2])('画布缩放 %s 时把越界菜单移回视口', (scale) => {
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const [x = 0, y = 0] = (this.style.translate || '').split(' ').map((value) => parseFloat(value) || 0)
    const left = -50 + x * scale
    const top = -30 + y * scale
    return {
      left,
      top,
      right: left + 200 * scale,
      bottom: top + 100 * scale,
      width: 200 * scale,
      height: 100 * scale,
      x: left,
      y: top,
      toJSON() {},
    }
  })
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100)
  const view = render(<ViewportFloatingPanel role="listbox">候选</ViewportFloatingPanel>)
  try {
    const bounds = screen.getByRole('listbox').getBoundingClientRect()
    expect(bounds.left).toBe(12)
    expect(bounds.top).toBe(12)
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth - 12)
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight - 12)
  } finally {
    view.unmount()
    rect.mockRestore()
    width.mockRestore()
    height.mockRestore()
  }
})
