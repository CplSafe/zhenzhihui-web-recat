import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import CreativeParamsDropdown from '@/components/smart/CreativeParamsDropdown/CreativeParamsDropdown'

it('把 adaptive 显示为中文并解释含义，但仍回传模型原始值', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const options = {
    ratios: ['adaptive', '16:9'],
    durations: [],
    resolutions: ['720P'],
    counts: [],
    supportsAudio: false,
  }
  const value = { ratio: '16:9', durationSec: 0, resolution: '720P', count: 1, generateAudio: false }
  const { rerender } = render(<CreativeParamsDropdown value={value} options={options} onChange={onChange} />)

  await user.click(screen.getByRole('button', { name: /创作参数，当前/ }))
  const panel = screen.getByRole('dialog', { name: '创作参数' })
  const adaptive = within(panel).getByRole('button', { name: '自适应' })
  expect(adaptive).toHaveAccessibleDescription(/根据上传的参考素材确定画面比例/)
  expect(within(panel).queryByText('adaptive')).not.toBeInTheDocument()

  await user.click(adaptive)
  expect(onChange).toHaveBeenCalledWith({ ...value, ratio: 'adaptive' })

  rerender(<CreativeParamsDropdown value={{ ...value, ratio: 'adaptive' }} options={options} onChange={onChange} />)
  expect(screen.getByRole('button', { name: /创作参数，当前 自适应/ })).toBeInTheDocument()
})
