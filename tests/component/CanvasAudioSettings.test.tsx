import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import CanvasAudioSettings from '@/components/canvas/CanvasAudioSettings'

const fields = [
  { name: 'speech_rate', type: 'number', minimum: -50, maximum: 100, default: 0 },
  { name: 'pitch_rate', type: 'number', default: 0 },
  { name: 'enable_subtitle', type: 'string', default: 'false' },
  { name: 'enabled', type: 'boolean', default: false },
  { name: 'sample_rate', type: 'integer', options: [24000, 48000], default: 48000 },
]

function Controlled({ change, close }: { change: (value: Record<string, unknown>) => void; close: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({
    speech_rate: 0,
    pitch_rate: 0,
    enable_subtitle: 'false',
    enabled: false,
    sample_rate: 48000,
  })
  return (
    <CanvasAudioSettings
      anchor={document.body}
      fields={fields}
      values={values}
      disabled={false}
      label={(field) => field.name}
      onChange={(value) => {
        setValues(value)
        change(value)
      }}
      onClose={close}
    />
  )
}

describe('声音设置参数契约', () => {
  it('只对已声明范围的字段显示滑块，恢复默认保持后端数值', () => {
    const change = vi.fn()
    render(<Controlled change={change} close={vi.fn()} />)
    expect(screen.queryByRole('slider', { name: 'pitch_rate滑块' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider', { name: 'speech_rate滑块' }), { target: { value: '25' } })
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ speech_rate: 25 }))
    fireEvent.click(screen.getByRole('button', { name: '恢复speech_rate默认值' }))
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ speech_rate: 0 }))
  })
  it('中文开关分别保留字符串与布尔提交类型，采样率格式化只改变文案', () => {
    const change = vi.fn()
    render(<Controlled change={change} close={vi.fn()} />)
    fireEvent.click(screen.getByText(/高级设置/))
    fireEvent.click(screen.getByRole('switch', { name: 'enable_subtitle' }))
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ enable_subtitle: 'true' }))
    fireEvent.click(screen.getByRole('switch', { name: 'enabled' }))
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }))
    fireEvent.change(screen.getByLabelText('sample_rate'), { target: { value: '24000' } })
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ sample_rate: 24000 }))
    expect(screen.getByRole('option', { name: '24 kHz' })).toBeInTheDocument()
  })
  it('Escape 关闭浮层', () => {
    const close = vi.fn()
    render(<Controlled change={vi.fn()} close={close} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
