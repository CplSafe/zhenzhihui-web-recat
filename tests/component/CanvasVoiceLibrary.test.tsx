import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CanvasVoiceLibrary from '@/components/canvas/CanvasVoiceLibrary'
import { saveVoiceSample } from '@/utils/voiceLibrary'

const defaults = () => ({
  userId: 'user',
  workspaceId: 21,
  modelName: '配音模型',
  fields: [
    {
      name: 'speaker',
      required: true,
      options: [
        { value: 7, label: '沉稳旁白' },
        { value: 'bright', label: '清亮旁白' },
      ],
    },
  ],
  values: { speaker: 7 },
  disabled: false,
  onApply: vi.fn(),
  onClose: vi.fn(),
  onUpload: vi.fn(),
  onReference: vi.fn(),
})

describe('音色库', () => {
  it('未选择模型且从声音样本打开时，仍展示三个分类并允许切换', () => {
    render(<CanvasVoiceLibrary {...defaults()} modelName="" fields={[]} initialTab="samples" />)
    expect(screen.getByRole('button', { name: '模型音色' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '声音样本' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '公共音色' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '模型音色' }))
    expect(screen.getByText('请先选择音频模型')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认使用' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '声音样本' }))
    expect(screen.getByRole('button', { name: '声音样本' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('选择保留为草稿，关闭不提交', () => {
    const props = defaults()
    render(<CanvasVoiceLibrary {...props} />)
    fireEvent.click(screen.getByRole('radio', { name: /清亮旁白/ }))
    expect(props.onApply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onApply).not.toHaveBeenCalled()
  })
  it('搜索不丢失选择，确认保持后端原始数值类型', () => {
    const props = defaults()
    render(<CanvasVoiceLibrary {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索模型音色' }), { target: { value: '不存在' } })
    expect(screen.getByRole('status')).toHaveTextContent('没有匹配的音色')
    fireEvent.click(screen.getByRole('button', { name: '确认使用' }))
    expect(props.onApply).toHaveBeenCalledWith({ speaker: 7 })
  })
  it('必填音色失效时必须重新选择，运行中不可提交', () => {
    const props = defaults()
    const { rerender } = render(<CanvasVoiceLibrary {...props} values={{ speaker: 'removed' }} />)
    expect(screen.getByRole('button', { name: '确认使用' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /沉稳旁白/ }))
    expect(screen.getByRole('button', { name: '确认使用' })).toBeEnabled()
    rerender(<CanvasVoiceLibrary {...props} disabled />)
    expect(screen.getByRole('button', { name: '确认使用' })).toBeDisabled()
  })
  it('模型没有音色目录时明确说明，不自动提供不存在的选项', () => {
    render(<CanvasVoiceLibrary {...defaults()} fields={[]} />)
    expect(screen.getByText('当前模型未提供可选音色列表')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认使用' })).toBeDisabled()
  })
  it('声音样本继续引用当前空间的素材，和模型音色分别操作', async () => {
    const props = defaults()
    props.onReference.mockResolvedValue(true)
    saveVoiceSample('user', 21, 55, '角色样本')
    render(<CanvasVoiceLibrary {...props} initialTab="samples" />)
    fireEvent.click(screen.getByRole('button', { name: '引用' }))
    expect(props.onReference).toHaveBeenCalledWith(55, '角色样本')
    expect(props.onApply).not.toHaveBeenCalled()
  })
})
