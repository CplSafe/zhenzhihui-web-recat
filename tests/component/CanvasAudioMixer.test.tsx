import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
async function waitForPreview() {
  await screen.findByText(/试听文件已生成/)
  const audio = document.querySelector('audio')!
  fireEvent.canPlay(audio)
  await screen.findByText(/试听已就绪/)
  return audio
}
describe('剪辑节点一期双轨混音', () => {
  beforeEach(() => {
    renderMix.mockReset()
    toast.mockClear()
  })
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
    const onSoloChange = vi.fn()
    render(
      <CanvasAudioMixer
        clips={[clip, { ...clip, lane: 'bgm', sourceNodeId: 'b', assetId: 2, title: '音乐' }]}
        onChange={vi.fn()}
        workspaceId={21}
        duration={5}
        playheadSec={0}
        playing={false}
        onSoloChange={onSoloChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '独听人声' }))
    expect(onSoloChange).toHaveBeenLastCalledWith(true)
    await waitFor(() => expect(renderMix).toHaveBeenCalled())
    expect(renderMix.mock.calls[0][0][1].muted).toBe(true)
    await waitFor(() => expect(screen.getByRole('button', { name: '导出混音 WAV' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '导出混音 WAV' }))
    await waitFor(() => expect(renderMix).toHaveBeenCalledTimes(2))
    expect(renderMix.mock.calls[1][0][1].muted).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '取消独听' }))
    expect(onSoloChange).toHaveBeenLastCalledWith(false)
  })
  it('音频实际可播放后通知就绪，并从用户点击入口启动音频', async () => {
    renderMix.mockResolvedValue({})
    const ready = vi.fn()
    const register = vi.fn()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const { container } = render(
      <CanvasAudioMixer
        clips={[clip]}
        onChange={vi.fn()}
        workspaceId={21}
        duration={5}
        playheadSec={2}
        playing={false}
        onPreviewReadyChange={ready}
        onPreviewPlay={register}
      />,
    )
    expect(ready).toHaveBeenLastCalledWith(false)
    await screen.findByText(/试听文件已生成/)
    expect(ready).toHaveBeenLastCalledWith(false)
    const audio = container.querySelector('audio')!
    fireEvent.canPlay(audio)
    expect(ready).toHaveBeenLastCalledWith(true)
    const start = register.mock.calls[register.mock.calls.length - 1][0]
    expect(await start()).toBe(true)
    expect(audio.currentTime).toBe(2)
    expect(play.mock.instances).toContain(audio)
    play.mockRejectedValueOnce(new Error('blocked'))
    await act(async () => {
      expect(await start()).toBe(false)
    })
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('音频未能播放'), 'info')
    expect(screen.getByRole('button', { name: '重试试听' })).toBeEnabled()
    expect(ready).toHaveBeenLastCalledWith(false)
    await userEvent.click(screen.getByRole('button', { name: '重试试听' }))
    await waitForPreview()
    expect(ready).toHaveBeenLastCalledWith(true)
    await act(async () => {
      expect(await start()).toBe(true)
    })
  })
  it('失败恢复按钮，不产生成功提示', async () => {
    renderMix.mockRejectedValueOnce(new Error('音频加载失败'))
    render(<Controlled />)
    await waitFor(() => expect(toast).toHaveBeenCalledWith('音频加载失败', 'error'))
    expect(screen.getByRole('button', { name: '重试试听' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('音频加载失败')
    renderMix.mockResolvedValueOnce({})
    fireEvent.click(screen.getByRole('button', { name: '重试试听' }))
    await waitForPreview()
  })
  it('添加音轨后自动准备试听，音轨编辑后自动更新', async () => {
    renderMix.mockResolvedValue({})
    render(<Controlled />)
    expect(screen.queryByRole('button', { name: /试听/ })).not.toBeInTheDocument()
    await waitForPreview()
    expect(screen.queryByRole('button', { name: /试听/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('旁白音量'), { target: { value: '0.4' } })
    expect(screen.getByRole('status')).toHaveTextContent('正在自动准备')
    await waitForPreview()
    expect(renderMix.mock.calls[renderMix.mock.calls.length - 1][0][0].volume).toBe(0.4)
  })
  it('无原声视频播放时，新增音频自动跟随播放、定位和暂停', async () => {
    renderMix.mockResolvedValue({})
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const props = {
      clips: [clip],
      onChange: vi.fn(),
      workspaceId: 21,
      duration: 5,
      originalAudioVolume: 0,
    }
    const { container, rerender, unmount } = render(<CanvasAudioMixer {...props} playheadSec={2} playing={true} />)
    await waitForPreview()
    const audio = container.querySelector('audio')!
    expect(play.mock.instances).toContain(audio)
    expect(audio.currentTime).toBe(2)
    expect(audio.muted).toBe(false)
    rerender(<CanvasAudioMixer {...props} playheadSec={3} playing={false} />)
    expect(audio.currentTime).toBe(3)
    expect(pause.mock.instances).toContain(audio)
    unmount()
    play.mockRestore()
    pause.mockRestore()
  })
  it('音轨改变时丢弃旧的异步试听结果', async () => {
    let resolveOld!: (buffer: object) => void
    renderMix.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    renderMix.mockResolvedValueOnce({})
    const { container } = render(<Controlled />)
    await waitFor(() => expect(renderMix).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('旁白音量'), { target: { value: '0.4' } })
    await waitForPreview()
    const src = container.querySelector('audio')!.src
    resolveOld({})
    await waitFor(() => expect(renderMix).toHaveBeenCalledTimes(2))
    expect(container.querySelector('audio')!.src).toBe(src)
  })
  it('加载超时后可重试，迟到的可播放事件不会掩盖失败', async () => {
    renderMix.mockResolvedValue({})
    vi.useFakeTimers()
    const { unmount } = render(<Controlled />)
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(screen.getByText(/试听文件已生成/)).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(screen.getByRole('alert')).toHaveTextContent('加载超时')
      fireEvent.canPlay(document.querySelector('audio')!)
      expect(screen.getByRole('button', { name: '重试试听' })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
    await userEvent.click(screen.getByRole('button', { name: '重试试听' }))
    await waitForPreview()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    unmount()
  })
  it('准备超时会取消请求，丢弃迟到的结果并允许重试', async () => {
    let resolveOld!: (buffer: object) => void
    renderMix.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    vi.useFakeTimers()
    const { unmount } = render(<Controlled />)
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(screen.getByRole('alert')).toHaveTextContent('准备超时')
      expect(renderMix.mock.calls[0][5].signal.aborted).toBe(true)
      await act(async () => {
        resolveOld({})
      })
      expect(document.querySelector('audio')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
    renderMix.mockResolvedValue({})
    await userEvent.click(screen.getByRole('button', { name: '重试试听' }))
    await waitForPreview()
    unmount()
  })
})
