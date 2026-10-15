import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CanvasAudioNode from '@/components/canvas/CanvasAudioNode'

const mocks = vi.hoisted(() => ({ waveform: vi.fn(), update: vi.fn(), upload: vi.fn(), renderMix: vi.fn() }))
vi.mock('@/utils/audioWaveform', () => ({ loadAudioWaveform: mocks.waveform }))
vi.mock('@/utils/audioMix', () => ({ renderAudioMix: mocks.renderMix, audioBufferToWav: () => new Blob(['wav']) }))
vi.mock('@/api/business', () => ({ uploadAssetFile: mocks.upload }))
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ updateNodeData: mocks.update }) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/components/canvas/CanvasAudioGenerator', () => ({ default: () => null }))

describe('画布音频节点波形加载', () => {
  let reveal: () => void
  beforeEach(() => {
    mocks.waveform.mockReset()
    mocks.update.mockReset()
    mocks.upload.mockReset()
    mocks.renderMix.mockReset()
    mocks.waveform.mockResolvedValue([0.2, 0.8])
    reveal = () => undefined
    vi.stubGlobal(
      'IntersectionObserver',
      class implements IntersectionObserver {
        readonly root = null
        readonly rootMargin = '0px'
        readonly thresholds = [0]
        constructor(callback: IntersectionObserverCallback) {
          reveal = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this)
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords(): IntersectionObserverEntry[] {
          return []
        }
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('远离视口的音频不提前解码，进入视口后才加载波形', async () => {
    render(<CanvasAudioNode nodeId="audio-1" data={{}} workspaceId={21} src="/sample.wav" selected={false} />)
    expect(mocks.waveform).not.toHaveBeenCalled()
    act(() => reveal())
    await waitFor(() => expect(mocks.waveform).toHaveBeenCalledTimes(1))
  })

  it('选中的音频节点立即加载波形', async () => {
    render(<CanvasAudioNode nodeId="audio-1" data={{}} workspaceId={21} src="/sample.wav" selected />)
    await waitFor(() => expect(mocks.waveform).toHaveBeenCalledTimes(1))
  })

  it('卡片空白区域可拖动，播放、进度与参数操作不会触发拖动', () => {
    const { container } = render(
      <CanvasAudioNode nodeId="audio-1" data={{}} workspaceId={21} src="/sample.wav" selected />,
    )
    expect(container.firstElementChild).not.toHaveClass('nodrag')
    expect(screen.getByRole('button', { name: '播放音频' })).toHaveClass('nodrag')
    expect(screen.getByRole('slider', { name: '音频播放进度' })).toHaveClass('nodrag')
    expect(screen.getByRole('region', { name: '音频参数' })).toHaveClass('nodrag')
  })

  it('待生成与已有音频展示不同的节点主体', () => {
    const { rerender } = render(<CanvasAudioNode nodeId="audio-1" data={{}} workspaceId={21} src="" selected />)
    expect(screen.getByText('输入描述，选择模型生成声音')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '播放音频' })).not.toBeInTheDocument()

    rerender(<CanvasAudioNode nodeId="audio-1" data={{}} workspaceId={21} src="/sample.wav" selected />)
    expect(screen.getByRole('button', { name: '播放音频' })).toBeInTheDocument()
    expect(screen.queryByText('输入描述，选择模型生成声音')).not.toBeInTheDocument()
  })

  it('生成后的独立编辑节点仅展示音频编辑操作', () => {
    render(
      <CanvasAudioNode
        nodeId="audio-editor"
        data={{ audioRole: 'editor', assetId: 42, audio: { durationSec: 8, outSec: 8 } }}
        workspaceId={21}
        src="/sample.wav"
        selected
      />,
    )
    expect(screen.getByRole('region', { name: '音频编辑' })).toBeInTheDocument()
    expect(screen.getByText('裁剪起点')).toBeInTheDocument()
    expect(screen.getByText('裁剪终点')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出裁剪与音量设置 WAV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存为新素材并用于下游' })).toBeInTheDocument()
    expect(screen.queryByText('生成历史')).not.toBeInTheDocument()
  })

  it('编辑音频可一键恢复完整裁剪范围，并显示片段时长', () => {
    render(
      <CanvasAudioNode
        nodeId="audio-editor"
        data={{ audioRole: 'editor', assetId: 42, audio: { durationSec: 8, inSec: 2, outSec: 6 } }}
        workspaceId={21}
        src="/sample.wav"
        selected
      />,
    )
    expect(screen.getByText(/当前片段 4\.0 秒/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重置裁剪' }))
    expect(mocks.update).toHaveBeenCalledWith(
      'audio-editor',
      expect.objectContaining({ audio: expect.objectContaining({ inSec: 0, outSec: 8 }) }),
    )
  })

  it('拖动音量时即时显示数值，松开后才写入画布', () => {
    render(
      <CanvasAudioNode
        nodeId="audio-editor"
        data={{ audioRole: 'editor', assetId: 42, audio: { durationSec: 8, outSec: 8, volume: 1 } }}
        workspaceId={21}
        src="/sample.wav"
        selected
      />,
    )
    const slider = screen.getByRole('slider', { name: '编辑音频音量' })
    fireEvent.change(slider, { target: { value: '0.43' } })
    expect(screen.getByText('43%')).toBeInTheDocument()
    expect(mocks.update).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider)
    expect(mocks.update).toHaveBeenCalledWith(
      'audio-editor',
      expect.objectContaining({ audio: expect.objectContaining({ volume: 0.43 }) }),
    )
  })

  it('保存裁剪结果后，下游引用新的音频素材 ID', async () => {
    mocks.renderMix.mockResolvedValue({})
    mocks.upload.mockResolvedValue({ asset: { id: 99 } })
    render(
      <CanvasAudioNode
        nodeId="audio-editor"
        data={{ audioRole: 'editor', assetId: 42, audio: { durationSec: 8, inSec: 2, outSec: 6 } }}
        workspaceId={21}
        src="/sample.wav"
        selected
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '保存为新素材并用于下游' }))
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled())
    expect(mocks.update).toHaveBeenCalledWith(
      'audio-editor',
      expect.objectContaining({ assetId: 99, audio: expect.objectContaining({ inSec: 0, outSec: 4 }) }),
    )
  })
})
