import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CanvasRelightPreview from '@/components/canvas/CanvasRelightPreview'
import CanvasToolFields from '@/components/canvas/CanvasToolFields'

describe('照片打光预览', () => {
  it('灯位、亮度和颜色改变照片预览，原图对比可恢复', () => {
    const props = {
      src: '/photo.png',
      title: '人像',
      values: { light_azimuth: 90, light_elevation: 0, brightness: 50, color: '#ff0000' },
    }
    const { rerender } = render(<CanvasRelightPreview {...props} />)
    const before = screen.getByTestId('relight-overlay').innerHTML
    const brightness = screen.getByRole('img').style.filter
    rerender(
      <CanvasRelightPreview
        {...props}
        values={{ ...props.values, light_azimuth: 270, brightness: 90, color: '#0000ff' }}
      />,
    )
    expect(screen.getByTestId('relight-overlay').innerHTML).not.toBe(before)
    expect(screen.getByRole('img').style.filter).not.toBe(brightness)
    fireEvent.click(screen.getByRole('button', { name: '对比原图' }))
    expect(screen.getByRole('img', { name: '原图：人像' }).style.filter).toBe('')
    expect(screen.queryByTestId('relight-overlay')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回打光预览' }))
    expect(screen.getByTestId('relight-overlay')).toBeInTheDocument()
  })
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
