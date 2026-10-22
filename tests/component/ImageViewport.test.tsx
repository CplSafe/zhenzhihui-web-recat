import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ImageViewport from '@/components/common/ImageViewport'

function loaded(width = 1000, height = 500) {
  const image = screen.getByRole('img', { name: '测试图' })
  Object.defineProperties(image, {
    naturalWidth: { value: width, configurable: true },
    naturalHeight: { value: height, configurable: true },
  })
  fireEvent.load(image)
  return image
}

describe('ImageViewport', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(250)
  })
  afterEach(() => vi.restoreAllMocks())

  it('初始适应窗口，百分比基于原图像素，支持按钮与输入缩放', () => {
    render(<ImageViewport src="/test.png" alt="测试图" />)
    const image = loaded()
    const percent = screen.getByRole('spinbutton', { name: '图片缩放百分比' })
    expect(percent).toHaveValue(50)
    fireEvent.click(screen.getByRole('button', { name: '放大图片' }))
    expect(percent).toHaveValue(60)
    fireEvent.click(screen.getByRole('button', { name: '缩小图片' }))
    expect(percent).toHaveValue(50)
    fireEvent.change(percent, { target: { value: '200' } })
    fireEvent.blur(percent)
    expect(image.style.transform).toContain('scale(2)')
    fireEvent.click(screen.getByRole('button', { name: '原始大小' }))
    expect(percent).toHaveValue(100)
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }))
    expect(percent).toHaveValue(50)
  })

  it('小尺寸本地图片适应窗口时放大，100%恢复原始像素尺寸', () => {
    render(<ImageViewport src="blob:local-upload" alt="测试图" />)
    const image = loaded(200, 100)
    const percent = screen.getByRole('spinbutton', { name: '图片缩放百分比' })
    expect(percent).toHaveValue(250)
    expect(image.style.transform).toContain('scale(2.5)')
    fireEvent.click(screen.getByRole('button', { name: '原始大小' }))
    expect(percent).toHaveValue(100)
    expect(image.style.transform).toContain('scale(1)')
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }))
    expect(percent).toHaveValue(250)
    expect(image.style.transform).toContain('scale(2.5)')
  })

  it('滚轮阻止背景滚动，以鼠标位置为中心缩放', () => {
    render(<ImageViewport src="/test.png" alt="测试图" />)
    const image = loaded()
    const area = screen.getByRole('region', { name: '图片缩放区域' })
    const wheel = new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 50, bubbles: true, cancelable: true })
    fireEvent(area, wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(Number((screen.getByRole('spinbutton') as HTMLInputElement).value)).toBeGreaterThan(50)
    expect(image.style.transform).not.toContain('translate(0px, 0px)')
  })

  it('缩放值限制在1%到800%，无效值恢复原值', () => {
    render(<ImageViewport src="/test.png" alt="测试图" />)
    loaded()
    const percent = screen.getByRole('spinbutton')
    fireEvent.change(percent, { target: { value: '9999' } })
    fireEvent.blur(percent)
    expect(percent).toHaveValue(800)
    expect(screen.getByRole('button', { name: '放大图片' })).toBeDisabled()
    fireEvent.change(percent, { target: { value: '' } })
    fireEvent.blur(percent)
    expect(percent).toHaveValue(800)
  })

  it('指针拖拽移动图片，结束拖拽后不再移动', () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    render(<ImageViewport src="/test.png" alt="测试图" />)
    const image = loaded()
    const area = screen.getByRole('region')
    fireEvent.pointerDown(area, { button: 0, clientX: 20, clientY: 30 })
    fireEvent.pointerMove(area, { clientX: 70, clientY: 90 })
    expect(image.style.transform).toContain('translate(50px, 60px)')
    fireEvent.pointerUp(area)
    fireEvent.pointerMove(area, { clientX: 100, clientY: 100 })
    expect(image.style.transform).toContain('translate(50px, 60px)')
    vi.unstubAllGlobals()
  })
})
