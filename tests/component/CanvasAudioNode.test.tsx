import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CanvasAudioNode from '@/components/canvas/CanvasAudioNode'

const mocks = vi.hoisted(() => ({
  selection: [] as { id: string; selected: boolean }[],
  waveform: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  renderMix: vi.fn(),
  getNode: vi.fn(),
  getEdges: vi.fn(),
}))
vi.mock('@/utils/audioWaveform', () => ({ loadAudioWaveform: mocks.waveform }))
vi.mock('@/utils/audioMix', () => ({ renderAudioMix: mocks.renderMix, audioBufferToWav: () => new Blob(['wav']) }))
vi.mock('@/api/business', () => ({ uploadAssetFile: mocks.upload }))
vi.mock('@xyflow/react', () => ({
  useStore: (selector: any) => selector({ nodes: mocks.selection }),
  useReactFlow: () => ({ updateNodeData: mocks.update, getNode: mocks.getNode, getEdges: mocks.getEdges }),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/components/canvas/CanvasAudioGenerator', () => ({ default: () => null }))

describe('画布音频节点波形加载', () => {
  let reveal: () => void
  beforeEach(() => {
    mocks.selection = []
    mocks.waveform.mockReset()
    mocks.update.mockReset()
    mocks.getNode.mockReset()
    mocks.getEdges.mockReset().mockReturnValue([])
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

  it.each([undefined, 'editor'])('多选隐藏面板、恢复单选显示且不卸载：%s', (audioRole) => {
    const props = { nodeId: 'audio-1', data: { audioRole }, workspaceId: 21, src: '', selected: true }
    const { container, rerender } = render(<CanvasAudioNode {...props} />)
    const panel = container.querySelector('.canvas-audio-panel')!
    expect(panel).toBeVisible()
    mocks.selection = [
      { id: 'audio-1', selected: true },
      { id: 'other', selected: true },
    ]
    rerender(<CanvasAudioNode {...props} />)
    expect(panel).not.toBeVisible()
    expect(container.querySelector('.canvas-audio-panel')).toBe(panel)
    mocks.selection = [{ id: 'audio-1', selected: true }]
    rerender(<CanvasAudioNode {...props} />)
    expect(panel).toBeVisible()
    rerender(<CanvasAudioNode {...props} selected={false} />)
    expect(panel).not.toBeVisible()
  })

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

  it('生成完成后展示结果波形、时长和播放状态', async () => {
    const { container, rerender } = render(
      <CanvasAudioNode nodeId="audio-1" data={{ taskStatus: 'processing' }} workspaceId={21} src="" selected />,
    )
    expect(screen.getByText('音频生成中')).toBeInTheDocument()

    rerender(
      <CanvasAudioNode
        nodeId="audio-1"
        data={{ taskStatus: 'succeeded', assetId: 42, audio: { durationSec: 8, outSec: 8 } }}
        workspaceId={21}
        src="/sample.wav"
        selected
      />,
    )
    await waitFor(() => expect(container.querySelectorAll('i')).toHaveLength(2))
    expect(screen.getByText('/ 00:08')).toBeInTheDocument()
    expect(screen.queryByText('音频生成中')).not.toBeInTheDocument()
    const audio = container.querySelector('audio')!
    expect(audio).toHaveAttribute('src', '/sample.wav')
    fireEvent.play(audio)
    expect(screen.getByRole('button', { name: '暂停音频' })).toBeInTheDocument()
    fireEvent.pause(audio)
    expect(screen.getByRole('button', { name: '播放音频' })).toBeInTheDocument()
  })

  it('手动创建的空编辑节点提示连接或上传音频', () => {
    render(<CanvasAudioNode nodeId="editor" data={{ audioRole: 'editor' }} workspaceId={21} src="" selected />)
    expect(screen.getByText('连接音频节点或上传音频')).toBeInTheDocument()
    expect(screen.getByText('上传 MP3 / WAV / M4A / AAC')).toBeInTheDocument()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('源素材改变不会覆盖编辑结果，用户点击后才载入最新音频并重置参数', () => {
    mocks.getEdges.mockReturnValue([{ source: 'source', target: 'editor' }])
    mocks.getNode.mockReturnValue({
      id: 'source',
      data: { kind: 'audio', assetId: 99, assetWorkspaceId: 21, audio: { durationSec: 12 } },
    })
    render(
      <CanvasAudioNode
        nodeId="editor"
        data={{ audioRole: 'editor', assetId: 42, audio: { durationSec: 8, inSec: 2, outSec: 6, volume: 0.5 } }}
        workspaceId={21}
        src="/sample.wav"
        selected
      />,
    )
    expect(mocks.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '使用源节点最新音频' }))
    expect(mocks.update).toHaveBeenCalledWith(
      'editor',
      expect.objectContaining({
        sourceAudioNodeId: 'source',
        assetId: 99,
        audio: expect.objectContaining({ durationSec: 12, inSec: 0, outSec: 12, volume: 1 }),
      }),
    )
  })

  it('独立编辑节点仅展示音频编辑操作', () => {
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
    expect(screen.queryByRole('button', { name: '导出裁剪与音量设置 WAV' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '下载音频' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '下载源音频' })).not.toBeInTheDocument()
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
