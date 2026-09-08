import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceInputButton from '@/components/common/VoiceInputButton'
import { server } from '../mocks/server'

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

const ENDPOINT = '/api/v1/ai/speech/transcriptions'

/** jsdom 没有 MediaRecorder;这个替身把 stop() 直接当成「最后一块数据到齐」。 */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = vi.fn((type: string) => type.startsWith('audio/webm'))
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(
    public stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType || 'audio/webm'
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['opus'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

const trackStop = vi.fn()
const fakeStream = () => ({ getTracks: () => [{ stop: trackStop }] }) as unknown as MediaStream
const getUserMedia = vi.fn(async () => fakeStream())

/** 组件根元素上的 data-state:空闲是 button,展开后是 role=group,所以不能盯着同一个节点。 */
const state = () => document.querySelector('.voice-input')?.getAttribute('data-state')
const trigger = () => screen.getByRole('button', { name: '语音输入' })

beforeEach(() => {
  mocks.showToast.mockReset()
  trackStop.mockReset()
  getUserMedia.mockClear()
  FakeMediaRecorder.instances = []
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
})

describe('VoiceInputButton', () => {
  it('expands into the recording pill, transcribes on the mic click, and hands the text to onText', async () => {
    let uploadedType = ''
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        uploadedType = ((await request.formData()).get('file') as File).type
        return HttpResponse.json({ code: 0, data: { text: '做一条带货视频', language: 'zh', seconds: 3 } })
      }),
    )
    const user = userEvent.setup()
    const onText = vi.fn()
    render(<VoiceInputButton onText={onText} className="pill" />)

    expect(trigger()).toHaveClass('voice-input', 'pill')
    expect(state()).toBe('idle')

    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(FakeMediaRecorder.instances[0].mimeType).toBe('audio/webm;codecs=opus')
    // 展开后的胶囊:麦克风 + 波形 + 计时 + 取消。
    expect(screen.getByRole('group', { name: '正在录音' })).toBeInTheDocument()
    expect(document.querySelectorAll('.voice-input__wave span').length).toBeGreaterThan(0)
    expect(screen.getByText('0:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消录音' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '停止录音并识别' }))
    await waitFor(() => expect(onText).toHaveBeenCalledWith('做一条带货视频'))
    await waitFor(() => expect(state()).toBe('idle'))
    expect(uploadedType).toBe('audio/webm;codecs=opus')
    // 麦克风必须在识别前就放掉,否则识别期间指示灯还亮着。
    expect(trackStop).toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('drives the waveform from the microphone level while recording', async () => {
    // jsdom 没有 Web Audio;假的 AnalyserNode 一直返回一个响亮的样本,波形条就该被顶起来。
    const close = vi.fn(() => Promise.resolve())
    class FakeAudioContext {
      state = 'running'
      resume = vi.fn(() => Promise.resolve())
      close = close
      createAnalyser() {
        return {
          fftSize: 2048,
          getByteTimeDomainData(buffer: Uint8Array) {
            buffer.fill(200)
          },
        }
      }
      createMediaStreamSource() {
        return { connect: vi.fn() }
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)

    const user = userEvent.setup()
    render(<VoiceInputButton onText={vi.fn()} />)
    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))
    const bars = () => [...document.querySelectorAll<HTMLElement>('.voice-input__wave span')]
    expect(bars()).toHaveLength(28)
    // (200-128)/128 ≈ 0.56 的峰值 ×3 后封顶为 1:最新的一根条必须是满高。
    // 仓库 lib 锁定 ES2021，Array.prototype.at 不可用，用 slice(-1) 取最后一根条。
    await waitFor(() => expect(bars().slice(-1)[0]?.style.getPropertyValue('--level')).toBe('1'))
    // 采样是持续的,不是只跑一次:再等一会儿应该有更多条被填上。
    await waitFor(() =>
      expect(bars().filter((b) => b.style.getPropertyValue('--level') === '1').length).toBeGreaterThan(2),
    )

    await user.click(screen.getByRole('button', { name: '取消录音' }))
    await waitFor(() => expect(state()).toBe('idle'))
    // 停止后关掉 AudioContext,不留后台分析器。
    expect(close).toHaveBeenCalled()
  })

  it('reports silence as a toast when the server hears nothing', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json({ code: 0, data: { text: '' } })))
    const user = userEvent.setup()
    render(<VoiceInputButton onText={vi.fn()} />)
    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))
    await user.click(screen.getByRole('button', { name: '停止录音并识别' }))
    // 空文本不是错误,但要告诉用户没听到。
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('没听到声音，请靠近麦克风再说一次', 'error'))
    await waitFor(() => expect(state()).toBe('idle'))
  })

  it('discards the recording when × is clicked while recording', async () => {
    let called = false
    server.use(
      http.post(ENDPOINT, () => {
        called = true
        return HttpResponse.json({ code: 0, data: { text: '不该出现' } })
      }),
    )
    const user = userEvent.setup()
    const onText = vi.fn()
    render(<VoiceInputButton onText={onText} />)
    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))
    await user.click(screen.getByRole('button', { name: '取消录音' }))
    await waitFor(() => expect(state()).toBe('idle'))
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive')
    expect(trackStop).toHaveBeenCalled()
    expect(called).toBe(false)
    expect(onText).not.toHaveBeenCalled()
  })

  it('shows the transcribing state and lets the user cancel a stalled upload', async () => {
    let release: () => void = () => {}
    server.use(
      http.post(ENDPOINT, async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return HttpResponse.json({ code: 0, data: { text: '迟到的结果' } })
      }),
    )
    const user = userEvent.setup()
    const onText = vi.fn()
    render(<VoiceInputButton onText={onText} />)
    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))
    await user.click(screen.getByRole('button', { name: '停止录音并识别' }))
    await waitFor(() => expect(state()).toBe('transcribing'))
    expect(screen.getByRole('button', { name: '正在识别语音' })).toBeDisabled()
    expect(screen.getByText('识别中')).toBeInTheDocument()

    // 代理挂起时用户不该被锁在「识别中」:点 × 就取消,晚到的结果也不回填。
    await user.click(screen.getByRole('button', { name: '取消识别' }))
    await waitFor(() => expect(state()).toBe('idle'))
    await act(async () => release())
    expect(onText).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('surfaces server errors as a toast and returns to idle', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          { code: 10503, code_string: 'SPEECH_NOT_CONFIGURED', message: '语音识别服务未配置,请联系管理员' },
          { status: 503 },
        ),
      ),
    )
    const user = userEvent.setup()
    const onText = vi.fn()
    render(<VoiceInputButton onText={onText} />)
    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))
    await user.click(screen.getByRole('button', { name: '停止录音并识别' }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('语音识别服务未配置,请联系管理员', 'error'))
    await waitFor(() => expect(state()).toBe('idle'))
    expect(onText).not.toHaveBeenCalled()
  })

  it('ignores a second click while the microphone permission prompt is still open', async () => {
    let grant: (stream: MediaStream) => void = () => {}
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          grant = resolve
        }),
    )
    const user = userEvent.setup()
    render(<VoiceInputButton onText={vi.fn()} />)
    await user.click(trigger())
    await user.click(trigger())
    await act(async () => grant(fakeStream()))
    await waitFor(() => expect(state()).toBe('recording'))
    // 双击只能开一路流,否则第一路永远没人 stop,麦克风指示灯一直亮。
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(FakeMediaRecorder.instances).toHaveLength(1)
  })

  it('stops automatically when the recording reaches maxSeconds', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json({ code: 0, data: { text: '到点了' } })))
    const user = userEvent.setup()
    const onText = vi.fn()
    render(<VoiceInputButton onText={onText} maxSeconds={1} />)
    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))
    await waitFor(() => expect(onText).toHaveBeenCalledWith('到点了'), { timeout: 3000 })
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive')
    expect(trackStop).toHaveBeenCalled()
  })

  it('recovers when the recorder errors after already going inactive', async () => {
    const user = userEvent.setup()
    render(<VoiceInputButton onText={vi.fn()} />)
    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))

    // Chrome 在 start() 异步失败时会先把 state 置 inactive 再派发 error,此后不会再有 onstop。
    const broken = FakeMediaRecorder.instances[0]
    act(() => {
      broken.state = 'inactive'
      broken.onerror?.()
    })
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('录音中断，请重试', 'error'))
    await waitFor(() => expect(state()).toBe('idle'))
    expect(trackStop).toHaveBeenCalled()

    // 出错后再点必须能正常开新一段,而不是被静默丢弃。
    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(FakeMediaRecorder.instances).toHaveLength(2)
  })

  it('explains a denied microphone permission without starting a recording', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const user = userEvent.setup()
    render(<VoiceInputButton onText={vi.fn()} />)
    await user.click(trigger())
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('麦克风权限被拒绝，请在浏览器地址栏右侧允许后重试', 'error'),
    )
    expect(state()).toBe('idle')
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  it('routes guests to login instead of opening the microphone', async () => {
    const user = userEvent.setup()
    const onAuthRequired = vi.fn()
    render(<VoiceInputButton onText={vi.fn()} authRequired onAuthRequired={onAuthRequired} />)
    await user.click(trigger())
    expect(onAuthRequired).toHaveBeenCalledTimes(1)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('renders nothing when the browser cannot record', () => {
    vi.unstubAllGlobals()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    const { container } = render(<VoiceInputButton onText={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('releases the microphone when unmounted mid-recording', async () => {
    const user = userEvent.setup()
    const view = render(<VoiceInputButton onText={vi.fn()} />)
    await user.click(trigger())
    await waitFor(() => expect(state()).toBe('recording'))
    view.unmount()
    expect(trackStop).toHaveBeenCalled()
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive')
  })
})
