import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import StudioDurationPicker from '@/components/studio/StudioDurationPicker/StudioDurationPicker'

/** 4~30 秒逐秒档位：图1 里滑块被挤爆的那种密集场景。 */
const DENSE_OPTIONS = Array.from({ length: 27 }, (_, i) => i + 4)

describe('StudioDurationPicker', () => {
  it('把每个合法档位渲染成可点选项，不自造中间秒数', () => {
    render(<StudioDurationPicker options={[5, 10]} value={5} onChange={() => {}} />)

    const radios = screen.getAllByRole('radio')
    expect(radios.map((node) => node.textContent)).toEqual(['5s', '10s'])
  })

  it('密集档位全部渲染出来，靠滚动承载而不是丢弃', () => {
    render(<StudioDurationPicker options={DENSE_OPTIONS} value={17} onChange={() => {}} />)

    expect(screen.getAllByRole('radio')).toHaveLength(DENSE_OPTIONS.length)
    expect(screen.getByRole('radio', { name: '30s' })).toBeInTheDocument()
  })

  it('当前档位标记为选中，供读屏与样式识别', () => {
    render(<StudioDurationPicker options={DENSE_OPTIONS} value={17} onChange={() => {}} />)

    expect(screen.getByRole('radio', { name: '17s' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '16s' })).toHaveAttribute('aria-checked', 'false')
  })

  it('点击档位回传该档的秒数', async () => {
    const onChange = vi.fn()
    render(<StudioDurationPicker options={DENSE_OPTIONS} value={5} onChange={onChange} />)

    await userEvent.click(screen.getByRole('radio', { name: '12s' }))

    expect(onChange).toHaveBeenCalledWith(12)
  })

  it('不可滚动时两端箭头都禁用', () => {
    // jsdom 里 scrollWidth === clientWidth，等价于「一屏放得下」。
    render(<StudioDurationPicker options={[5, 10]} value={5} onChange={() => {}} />)

    expect(screen.getByLabelText('查看更短的时长')).toBeDisabled()
    expect(screen.getByLabelText('查看更长的时长')).toBeDisabled()
  })

  it('禁用态下档位不可点击', async () => {
    const onChange = vi.fn()
    render(<StudioDurationPicker options={[5, 10]} value={5} onChange={onChange} disabled />)

    await userEvent.click(screen.getByRole('radio', { name: '10s' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('没有可选档位时不渲染（模型未声明时长）', () => {
    const { container } = render(<StudioDurationPicker options={[]} value={0} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
