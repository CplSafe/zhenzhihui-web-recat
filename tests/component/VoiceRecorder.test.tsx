import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceRecorder from '@/components/canvas/VoiceRecorder'

let seconds = 12
let silence = false
const track = { stop: vi.fn(), onended: null as (() => void) | null }
const stream = { getTracks: () => [track] } as unknown as MediaStream
const getUserMedia = vi.fn(async () => stream)
const decoded = () => ({
  duration: seconds,
  length: seconds * 24000,
  sampleRate: 24000,
  numberOfChannels: 1,
  getChannelData: () => new Float32Array(seconds * 24000).fill(silence ? 0 : 0.2),
})
class Recorder {
  static instances: Recorder[] = []
  static isTypeSupported = () => true
  mimeType = 'audio/webm'
  state = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    Recorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['sound']) })
    this.onstop?.()
  }
}
const props = () => ({ disabled: false, onRecorded: vi.fn(), onActiveChange: vi.fn(), onDraftChange: vi.fn() })

beforeEach(() => {
  vi.useFakeTimers()
  seconds = 12
  silence = false
  track.stop.mockClear()
  track.onended = null
  Recorder.instances = []
  getUserMedia.mockReset().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices: async () => [] },
  })
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      decodeAudioData = async () => decoded()
    },
  )
  vi.spyOn(Blob.prototype, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(8))
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
})
async function begin() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100)
  })
}
async function finish() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '结束录音' }))
  })
}
describe('现场训练录音', () => {
  it('录音先试听，不上传；采用时输出真实WAV文件并关闭麦克风', async () => {
    const p = props()
    render(<VoiceRecorder {...p} />)
    expect(getUserMedia).not.toHaveBeenCalled()
    await begin()
    await finish()
    expect(track.stop).toHaveBeenCalled()
    expect(screen.getByLabelText('试听现场录音')).toBeInTheDocument()
    expect(p.onRecorded).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '使用这段录音' }))
    expect(p.onRecorded).toHaveBeenCalledWith(expect.objectContaining({ name: '现场录音.wav', type: 'audio/wav' }), 12)
  })
  it('不足10秒可以结束和试听，但不能采用；基本无声时提示重录', async () => {
    seconds = 5
    render(<VoiceRecorder {...props()} />)
    await begin()
    await finish()
    expect(screen.getByRole('button', { name: '使用这段录音' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('至少 10 秒')
    fireEvent.click(screen.getByRole('button', { name: '重新录音' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    silence = true
    await finish()
    expect(screen.getByRole('alert')).toHaveTextContent('基本无声')
    expect(screen.queryByRole('button', { name: '使用这段录音' })).not.toBeInTheDocument()
  })
  it('授权被拒绝时保留上传替代提示', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('', 'NotAllowedError'))
    render(<VoiceRecorder {...props()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('网站权限')
    expect(Recorder.instances).toHaveLength(0)
  })
  it('等待授权时取消，迟到授权立即释放，不开始录音', async () => {
    let resolve!: (value: MediaStream) => void
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    render(<VoiceRecorder {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
    expect(screen.getByRole('status')).toHaveTextContent('等待麦克风授权')
    fireEvent.click(screen.getByRole('button', { name: '取消录音' }))
    await act(async () => {
      resolve(stream)
    })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(Recorder.instances).toHaveLength(0)
  })
  it('卸载或用户取消时停止采集且不采用录音', async () => {
    const p = props()
    const view = render(<VoiceRecorder {...p} />)
    await begin()
    view.unmount()
    expect(track.stop).toHaveBeenCalled()
    expect(Recorder.instances[0].state).toBe('inactive')
    expect(p.onRecorded).not.toHaveBeenCalled()
  })
  it('60秒自动结束并允许试听', async () => {
    render(<VoiceRecorder {...props()} />)
    await begin()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60100)
    })
    expect(screen.getByLabelText('试听现场录音')).toBeInTheDocument()
    expect(screen.getByText(/已达到 60 秒上限/)).toBeInTheDocument()
    expect(track.stop).toHaveBeenCalled()
  })
})
