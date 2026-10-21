import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CanvasToolFields from '@/components/canvas/CanvasToolFields'

describe('CanvasToolFields', () => {
  it('兼容后端 bool 类型的轮廓光开关', () => {
    const change = vi.fn()
    const { rerender } = render(
      <CanvasToolFields
        fields={[{ name: 'rim_light', display_name: '轮廓光', type: 'bool' }]}
        values={{ rim_light: false }}
        onChange={change}
      />,
    )
    const toggle = screen.getByRole('switch', { name: '轮廓光' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(change).toHaveBeenCalledWith({ rim_light: true })
    rerender(
      <CanvasToolFields
        fields={[{ name: 'rim_light', display_name: '轮廓光', type: 'bool' }]}
        values={{ rim_light: true }}
        onChange={change}
      />,
    )
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(change).toHaveBeenLastCalledWith({ rim_light: false })
  })
})
