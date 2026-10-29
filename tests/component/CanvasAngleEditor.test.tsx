import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CanvasAngleEditor from '@/components/canvas/CanvasAngleEditor'

function Editor({ disabled = false }: { disabled?: boolean }) {
  const [values, setValues] = useState<Record<string, unknown>>({ horizontal_angle: 0, vertical_angle: 0, zoom: 5 })
  return (
    <>
      <CanvasAngleEditor url="/image.png" values={values} onChange={setValues} disabled={disabled} />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  )
}
describe('球形机位编辑器', () => {
  it('预设联动，键盘环绕，提示词与重置', () => {
    render(<Editor />)
    fireEvent.click(screen.getByRole('button', { name: '背面视角' }))
    expect(screen.getByTestId('values')).toHaveTextContent('"horizontal_angle":180')
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight' })
    expect(screen.getByTestId('values')).toHaveTextContent('"horizontal_angle":185')
    fireEvent.click(screen.getByRole('checkbox', { name: '显示机位提示词' }))
    expect(screen.getByText(/水平环绕185°/)).toHaveTextContent('人物、背景、道具作为同一三维场景共同换机位')
    fireEvent.click(screen.getByRole('button', { name: '全景俯拍' }))
    expect(screen.getByTestId('values')).toHaveTextContent('"zoom":2')
    fireEvent.click(screen.getByRole('button', { name: '重置机位' }))
    expect(screen.getByTestId('values')).toHaveTextContent('"vertical_angle":0')
    expect(screen.getByTestId('values')).toHaveTextContent('"zoom":5')
  })
  it('禁用时不修改机位，键盘俯仰遵守范围', () => {
    const { unmount } = render(<Editor disabled />)
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight' })
    expect(screen.getByTestId('values')).toHaveTextContent('"horizontal_angle":0')
    expect(screen.getByRole('button', { name: '背面视角' })).toBeDisabled()
    unmount()
    render(<Editor />)
    for (let i = 0; i < 30; i++) fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowUp' })
    expect(screen.getByTestId('values')).toHaveTextContent('"vertical_angle":60')
  })
})
