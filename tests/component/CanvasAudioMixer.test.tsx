import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import CanvasAudioMixer from '@/components/canvas/CanvasAudioMixer'
import { normalizeAudioSettings, type TimelineAudioClip } from '@/utils/canvasAudio'

const { renderMix, toast } = vi.hoisted(() => ({ renderMix: vi.fn(), toast: vi.fn() }))
vi.mock('@/utils/audioMix', () => ({ renderAudioMix: renderMix, audioBufferToWav: () => new Blob(['wave']) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: toast }) }))
const clip = { ...normalizeAudioSettings({ durationSec: 10 }), assetId: 1, sourceNodeId: 'a', title: '旁白' }
function Controlled() {
  const [clips, setClips] = useState<TimelineAudioClip[]>([clip])
  return (
    <CanvasAudioMixer clips={clips} onChange={setClips} workspaceId={21} duration={5} playheadSec={0} playing={false} />
  )
}
describe('剪辑节点三轨混音', () => {
  beforeEach(() => renderMix.mockReset())
  it('修改轨道和音量只修改混音，BGM 提供循环，长人声有提示', () => {
    render(<Controlled />)
    expect(screen.getByText(/音频长于剩余画面/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('旁白音量'), { target: { value: '0.4' } })
    expect(screen.getByLabelText('旁白音量')).toHaveValue('0.4')
    expect(clip.volume).toBe(1)
    fireEvent.change(screen.getByLabelText('旁白轨道'), { target: { value: 'bgm' } })
    expect(screen.getByLabelText('循环铺满')).toBeChecked()
    expect(screen.queryByText(/音频长于剩余画面/)).not.toBeInTheDocument()
  })
  it('空轨道不允许导出或试听', () => {
    render(
      <CanvasAudioMixer clips={[]} onChange={vi.fn()} workspaceId={21} duration={5} playheadSec={0} playing={false} />,
    )
    expect(screen.getByRole('button', { name: '导出混音 WAV' })).toBeDisabled()
  })
  it('失败恢复按钮，不产生成功提示', async () => {
    renderMix.mockRejectedValueOnce(new Error('音频加载失败'))
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: '准备混音试听' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('音频加载失败', 'error'))
    expect(screen.getByRole('button', { name: '准备混音试听' })).toBeEnabled()
  })
})
