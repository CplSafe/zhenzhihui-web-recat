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
describe('剪辑节点一期双轨混音', () => {
  beforeEach(() => renderMix.mockReset())
  it('可在剪辑器内直接选择画布音频加入音轨', () => {
    const onAddAudio = vi.fn()
    render(
      <CanvasAudioMixer
        clips={[]}
        onChange={vi.fn()}
        workspaceId={21}
        duration={5}
        playheadSec={0}
        playing={false}
        addableSources={[{ nodeId: 'audio-1', label: '生成的配音' }]}
        onAddAudio={onAddAudio}
      />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: '添加画布音频' }), { target: { value: 'audio-1' } })
    expect(onAddAudio).toHaveBeenCalledWith('audio-1')
  })
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
    expect(screen.queryByText('音效')).not.toBeInTheDocument()
  })
  it('原视频声音可以在时间线上静音，并回传给合成状态', () => {
    const onVolumeChange = vi.fn()
    render(
      <CanvasAudioMixer
        clips={[]}
        onChange={vi.fn()}
        workspaceId={21}
        duration={15}
        playheadSec={0}
        playing={false}
        originalAudioVolume={1}
        onOriginalAudioVolumeChange={onVolumeChange}
      />,
    )
    expect(screen.getByText('15.0 秒')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '静音原声' }))
    expect(onVolumeChange).toHaveBeenCalledWith(0)
  })
  it('独听只作用于试听，导出仍保留全部音轨', async () => {
    renderMix.mockResolvedValue({})
    render(
      <CanvasAudioMixer
        clips={[clip, { ...clip, lane: 'bgm', sourceNodeId: 'b', assetId: 2, title: '音乐' }]}
        onChange={vi.fn()}
        workspaceId={21}
        duration={5}
        playheadSec={0}
        playing={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '独听人声' }))
    fireEvent.click(screen.getByRole('button', { name: '准备混音试听' }))
    await waitFor(() => expect(renderMix).toHaveBeenCalled())
    expect(renderMix.mock.calls[0][0][1].muted).toBe(true)
    await waitFor(() => expect(screen.getByRole('button', { name: '导出混音 WAV' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '导出混音 WAV' }))
    await waitFor(() => expect(renderMix).toHaveBeenCalledTimes(2))
    expect(renderMix.mock.calls[1][0][1].muted).toBe(false)
  })
  it('失败恢复按钮，不产生成功提示', async () => {
    renderMix.mockRejectedValueOnce(new Error('音频加载失败'))
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: '准备混音试听' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('音频加载失败', 'error'))
    expect(screen.getByRole('button', { name: '准备混音试听' })).toBeEnabled()
  })
  it('音轨编辑使已准备的试听失效，并提示重新准备', async () => {
    renderMix.mockResolvedValue({})
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: '准备混音试听' }))
    await screen.findByText(/试听已就绪/)
    fireEvent.change(screen.getByLabelText('旁白音量'), { target: { value: '0.4' } })
    expect(screen.getByRole('status')).toHaveTextContent('当前试听已失效')
    expect(screen.getByRole('button', { name: '准备混音试听' })).toBeEnabled()
  })
})
