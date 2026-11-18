import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import ViewportFloatingPanel from '@/components/canvas/ViewportFloatingPanel'

it.each([0.5, 1, 2])('画布缩放 %s 时把越界菜单移回视口', (scale) => {
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    // Portal panels use fixed screen coordinates; only the canvas anchor is scaled.
    const panel = this.getAttribute('role') === 'listbox'
    const left = panel ? parseFloat(this.style.left) || 0 : -50 * scale
    const top = panel ? parseFloat(this.style.top) || 0 : -250 * scale

    return {
      left,
      top,
      right: left + 200,
      bottom: top + 100,
      width: 200,
      height: 100,
      x: left,
      y: top,
      toJSON() {},
    }
  })
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100)
  const view = render(<ViewportFloatingPanel role="listbox">候选</ViewportFloatingPanel>)
  try {
    const panel = screen.getByRole('listbox')
    expect(panel.parentElement).toBe(document.body)
    expect(panel).toHaveStyle({ position: 'fixed' })
    const bounds = panel.getBoundingClientRect()
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
