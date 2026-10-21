import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CanvasAnglePreview from '@/components/canvas/CanvasAnglePreview'

describe('多角度大图预览', () => {
  it('角度和景别改变透视，原图对比可恢复', () => {
    const props = { src: '/portrait.png', title: '人像', values: { horizontal_angle: 0, vertical_angle: 0, zoom: 5 } }
    const { rerender } = render(<CanvasAnglePreview {...props} />)
    const initial = screen.getByRole('img').style.transform
    rerender(<CanvasAnglePreview {...props} values={{ horizontal_angle: 90, vertical_angle: 30, zoom: 8 }} />)
    expect(screen.getByRole('img').style.transform).not.toBe(initial)
    expect(screen.getByRole('img').style.transform).toContain('rotateX(19.5deg)')
    expect(screen.getByRole('img').style.transform).toContain('rotateY(-34deg)')
    fireEvent.click(screen.getByRole('button', { name: '对比原图' }))
    expect(screen.getByRole('img', { name: '原图：人像' }).style.transform).toBe('none')
    fireEvent.click(screen.getByRole('button', { name: '返回角度预览' }))
    expect(screen.getByRole('img').style.transform).not.toBe('none')
  })
  it('背面角度不镜像伪造背面，提示单张图限制', () => {
    render(<CanvasAnglePreview src="/portrait.png" title="人像" values={{ horizontal_angle: 180 }} />)
    expect(screen.getByText(/单张图无法展示背面/)).toBeInTheDocument()
    expect(screen.getByRole('img').style.transform).not.toContain('rotateY(180deg)')
  })
})
