import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CanvasAudioGenerator from '@/components/canvas/CanvasAudioGenerator'
import { setCopiedCanvasAudioReference } from '@/utils/canvasClipboard'
import { saveVoiceSample } from '@/utils/voiceLibrary'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  estimate: vi.fn(),
  submit: vi.fn(),
  confirm: vi.fn(),
  update: vi.fn(),
  wait: vi.fn(),
  result: vi.fn(),
  findActive: vi.fn(),
  duration: vi.fn(),
  edges: vi.fn(),
  nodes: vi.fn(),
  node: vi.fn(),
  upload: vi.fn(),
  voiceDetail: vi.fn(),
}))
vi.mock('@/stores/workspaceSession', () => ({
  useWorkspaceSessionStore: (selector: any) => selector({ authSession: { user: { id: 'test-user' } } }),
}))
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({
    updateNodeData: mocks.update,
    getEdges: mocks.edges,
    getNode: mocks.node,
    getNodes: mocks.nodes,
  }),
}))
vi.mock('@/utils/taskMedia', () => ({
  resolveVerifiedResultAssetId: mocks.result,
  findActiveWorkspaceAssetIds: mocks.findActive,
}))
vi.mock('@/utils/canvasAudio', async (original) => ({
  ...(await original<typeof import('@/utils/canvasAudio')>()),
  readAudioDuration: mocks.duration,
}))
vi.mock('@/api/business', () => ({
  listAiModels: mocks.list,
  estimateAiTaskCost: mocks.estimate,
  createAiTask: mocks.submit,
  getAiTaskId: (task: any) => task.id,
  waitForAiTask: mocks.wait,
  uploadAssetFile: mocks.upload,
}))
vi.mock('@/api/voices', async (original) => ({
  ...(await original<typeof import('@/api/voices')>()),
  getVoice: mocks.voiceDetail,
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  useConfirmDialog: () => ({ requestConfirm: mocks.confirm }),
}))

const model = {
  id: 91,
  display_name: '配音模型',
  operation_codes: ['audio.tts'],
  params_schema: { properties: { speed: { type: 'number', default: 1 }, enabled: { type: 'boolean', default: true } } },
}
describe('音频生成任务提交', () => {
  it('从音色库确认的参数同时用于报价和生成，恢复其他参数默认不清除音色', async () => {
    mocks.list.mockResolvedValue([
      {
        ...model,
        params_schema: {
          properties: {
            speaker: { type: 'integer', enum: [7, 8], default: 7 },
            speed: { type: 'number', default: 1 },
          },
        },
      },
    ])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '音色库' }))
    fireEvent.click(await screen.findByRole('button', { name: '模型音色' }))
    fireEvent.click(await screen.findByRole('radio', { name: /^8/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认使用' }))
    fireEvent.click(screen.getByRole('button', { name: '生成参数' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复全部默认' }))
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.submit.mock.calls[0][0].params).toMatchObject({ speaker: 8, speed: 1 })
    expect(mocks.estimate).toHaveBeenCalledWith(expect.objectContaining({ params: { speaker: 8, speed: 1 } }))
  })
  beforeEach(() => {
    localStorage.clear()
    setCopiedCanvasAudioReference(null, 21)
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.list.mockResolvedValue([model])
    mocks.estimate.mockResolvedValue({ estimated_cost: 100, can_afford: true })
    mocks.confirm.mockResolvedValue(true)
    mocks.submit.mockResolvedValue({ id: 71 })
    mocks.findActive.mockImplementation(async (_workspaceId, ids) => new Set(ids))
    mocks.edges.mockReturnValue([])
    mocks.nodes.mockReturnValue([])
    mocks.node.mockReturnValue(null)
    mocks.voiceDetail.mockResolvedValue({
      id: 5,
      name: '在线旁白',
      status: 'ready',
      source: 'cloned',
      workspace_id: 21,
    })
  })
  it('声音样本库引用校验当前空间素材并接入参考列表', async () => {
    mocks.list.mockResolvedValue([{ ...model, operation_codes: ['audio.clone'] }])
    saveVoiceSample('test-user', 21, 55, '角色声音')
    render(
      <CanvasAudioGenerator nodeId="a" data={{ modelVersionId: 91, operationCode: 'audio.clone' }} workspaceId={21} />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '音频生成模型' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '音色库' }))
    fireEvent.click(await screen.findByRole('button', { name: '引用' }))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({ audioReferences: [{ assetId: 55, workspaceId: 21, title: '角色声音' }] }),
      ),
    )
    expect(mocks.findActive).toHaveBeenCalledWith(21, [55], 'audio')
  })
  it('声音样本素材失效时保留收藏并提示，不写入节点', async () => {
    mocks.list.mockResolvedValue([{ ...model, operation_codes: ['audio.clone'] }])
    mocks.findActive.mockResolvedValue(new Set())
    saveVoiceSample('test-user', 21, 55, '角色声音')
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    fireEvent.click(screen.getByRole('button', { name: '音色库' }))
    fireEvent.click(await screen.findByRole('button', { name: '引用' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('样本素材已失效')
    expect(mocks.update.mock.calls.some((call) => call[1]?.audioReferences)).toBe(false)
  })
  const choose = async () => {
    await waitFor(() => expect(screen.getByRole('button', { name: '音频生成模型' })).toBeEnabled())
    if (screen.getByRole('button', { name: '音频生成模型' }).getAttribute('aria-expanded') !== 'true')
      fireEvent.click(screen.getByRole('button', { name: '音频生成模型' }))
    await screen.findByRole('option', { name: /配音模型/ })
    fireEvent.click(screen.getByRole('option', { name: /配音模型/ }))
    fireEvent.change(screen.getByLabelText('配音文案或音乐描述'), { target: { value: '你好，欢迎使用帧智汇' } })
  }
  it('服务端音色 ID 持久化后重新核验，并传入报价及生成', async () => {
    render(
      <CanvasAudioGenerator
        nodeId="a"
        data={{ params: { voice_id: 5 }, modelVersionId: 91, operationCode: 'audio.tts' }}
        workspaceId={21}
      />,
    )
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.voiceDetail).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5)
    expect(mocks.submit.mock.calls[0][0].params.voice_id).toBe(5)
    expect(mocks.estimate).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ voice_id: 5 }) }),
    )
  })
  it('在文案中用 @ 引用已有画布音频，引用作为素材提交而不混入文案', async () => {
    mocks.nodes.mockReturnValue([
      { id: 'source', type: 'audio', data: { kind: 'audio', assetId: 55, assetWorkspaceId: 21, title: '旁白样音' } },
    ])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.change(screen.getByLabelText('配音文案或音乐描述'), { target: { value: '你好 @旁白' } })
    expect(screen.getByRole('option', { name: '旁白样音' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByLabelText('配音文案或音乐描述'), { key: 'Enter' })
    expect(mocks.update).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({
        audioReferences: [{ assetId: 55, workspaceId: 21, title: '旁白样音' }],
        prompt: '你好 ',
      }),
    )
  })
  it('按实际目录下发模型、操作码和 schema 默认值，并持久化任务 ID', async () => {
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.submit.mock.calls[0][0]).toMatchObject({
      workspaceId: 21,
      modelVersionId: 91,
      operationCode: 'audio.tts',
      prompt: '你好，欢迎使用帧智汇',
      params: { speed: 1, enabled: true },
    })
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith('a', expect.objectContaining({ taskId: 71, taskStatus: 'processing' })),
    )
  })
  it('生成参数显示中文名称，提交仍使用后端字段名', async () => {
    mocks.list.mockResolvedValue([
      {
        ...model,
        params_schema: {
          properties: {
            speaker: { type: 'string', default: 'voice-1' },
            context_text: { type: 'string' },
            output_format: { type: 'string', enum: ['mp3', 'wav'], default: 'mp3' },
            sample_rate: { type: 'integer', default: 48000 },
            speech_rate: { type: 'number', default: 1 },
          },
        },
      },
    ])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByText('生成参数'))
    expect(screen.queryByLabelText('配音音色')).not.toBeInTheDocument()
    expect(screen.queryByText(/当前模型未提供可选音色列表/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('上下文文本')).toBeInTheDocument()
    expect(screen.getByLabelText('输出格式')).toBeInTheDocument()
    expect(screen.getByLabelText('采样率')).toBeInTheDocument()
    expect(screen.getByLabelText('语速')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.submit.mock.calls[0][0].params).toMatchObject({
      speaker: 'voice-1',
      output_format: 'mp3',
      sample_rate: 48000,
      speech_rate: 1,
    })
  })
  it('取消费用确认不提交任务', async () => {
    mocks.estimate.mockResolvedValueOnce({ estimated_cost: 500, can_afford: true })
    mocks.confirm.mockResolvedValueOnce(false)
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('尚未选模型时仍显示生成按钮，提示选择模型且不能提交', async () => {
    render(<CanvasAudioGenerator nodeId="a" data={{ prompt: '生成对话' }} workspaceId={21} />)
    expect(screen.getByRole('button', { name: '生成音频' })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: '音频生成模型' })).toBeEnabled())
    expect(screen.getByRole('button', { name: '生成音频' })).toHaveAttribute('title', '请先选择配音 / 音乐模型')
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    expect(mocks.submit).not.toHaveBeenCalled()
    await choose()
    expect(screen.getByRole('button', { name: '生成音频' })).toBeEnabled()
  })
  it('没有目录能力时不展示可提交的模拟模型', async () => {
    mocks.list.mockResolvedValue([])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    expect(await screen.findByRole('button', { name: '音频生成模型' })).toHaveTextContent('暂无可用音频生成模型')
    expect(await screen.findByRole('status')).toHaveTextContent('切换到已开放音频模型的工作空间')
    expect(screen.getByRole('button', { name: '生成音频' })).toBeDisabled()
  })
  it('混合目录只展示生成操作，不将识别和转写标成配音', async () => {
    mocks.list.mockResolvedValue([
      { ...model, operation_codes: ['audio.tts', 'audio.transcribe', 'audio.asr'] },
      { id: 92, display_name: '通义千问 3 语音识别', operation_codes: ['audio.transcription'] },
    ])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '音频生成模型' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '音频生成模型' }))
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.queryByRole('option', { name: /语音识别/ })).not.toBeInTheDocument()
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.submit.mock.calls[0][0].operationCode).toBe('audio.tts')
  })
  it.each(['audio.generate', 'audio.music'])(
    '%s 隐藏音色库并清理旧音色参数，保留参考音频入口',
    async (operationCode) => {
      mocks.list.mockResolvedValue([{ ...model, operation_codes: [operationCode] }])
      render(
        <CanvasAudioGenerator
          nodeId="a"
          data={{ modelVersionId: 91, operationCode, params: { voice_id: 5, speaker: 'old', volume: 1 } }}
          workspaceId={21}
        />,
      )
      await waitFor(() => expect(screen.getByRole('button', { name: '音频生成模型' })).toBeEnabled())
      expect(screen.queryByRole('button', { name: '音色库' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ 参考音频' })).toBeInTheDocument()
      await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('a', { params: { volume: 1 } }))
    },
  )

  it('识别后端目录实际使用的 audio.text_to_speech 和 audio.generate 操作码', async () => {
    mocks.list.mockResolvedValue([
      {
        id: 37,
        display_name: 'Seed TTS 2.0',
        operation_codes: ['audio.text_to_speech'],
        result_schema: { output_types: ['audio'] },
      },
      {
        id: 36,
        display_name: 'Seed Audio 1.0',
        operation_codes: ['audio.generate'],
        result_schema: { output_types: ['audio'] },
      },
    ])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '音频生成模型' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '音频生成模型' }))
    expect(screen.getByRole('option', { name: /Seed TTS 2\.0.*配音/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Seed Audio 1\.0.*音频生成/ })).toBeInTheDocument()
  })
  it('旧草稿的识别模型不能继续提交，重新选择生成模型后恢复', async () => {
    render(
      <CanvasAudioGenerator
        nodeId="a"
        data={{ modelVersionId: 92, operationCode: 'audio.asr', prompt: '欢迎' }}
        workspaceId={21}
      />,
    )
    await screen.findByText('原选模型不可用于音频生成，请重新选择配音或音乐生成模型。')
    expect(screen.getByRole('button', { name: '生成音频' })).toBeDisabled()
    expect(mocks.estimate).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
  })
  it('只有识别模型时提示无可用生成模型，不请求费用或提交', async () => {
    mocks.list.mockResolvedValue([{ ...model, operation_codes: ['audio.asr'] }])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    expect(await screen.findByRole('button', { name: '音频生成模型' })).toHaveTextContent('暂无可用音频生成模型')
    expect(screen.getByRole('button', { name: '生成音频' })).toBeDisabled()
    expect(mocks.estimate).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('低于 500 积分直接提交，高额生成才二次确认', async () => {
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
  it('预估回显费用但不创建任务，编辑文案后清除旧报价', async () => {
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    await screen.findByText('预计 约2元')
    expect(screen.queryByText(/积分/)).not.toBeInTheDocument()
    expect(mocks.submit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('配音文案或音乐描述'), { target: { value: '新文案' } })
    expect(screen.queryByText('预计 约2元')).not.toBeInTheDocument()
  })
  it('已保存的参考音频传入预估和任务，不持久化媒体地址', async () => {
    mocks.list.mockResolvedValue([
      {
        ...model,
        input_constraints: { 'audio.tts': { roles: [{ role: 'reference_audio', min_count: 1, max_count: 1 }] } },
      },
    ])
    render(
      <CanvasAudioGenerator
        nodeId="a"
        data={{ audioReferences: [{ assetId: 88, workspaceId: 21, title: '样音.wav' }] }}
        workspaceId={21}
      />,
    )
    await choose()
    expect(screen.getByTitle('样音.wav')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.submit.mock.calls[0][0].inputAssets).toEqual([{ asset_id: 88, role: 'reference_audio' }])
    expect(mocks.estimate.mock.calls[0][0].inputAssets).toEqual(mocks.submit.mock.calls[0][0].inputAssets)
    expect(mocks.findActive).toHaveBeenCalledWith(21, [88], 'audio')
  })
  it('参考音频不在当前团队音频列表时拦截报价和提交', async () => {
    mocks.findActive.mockResolvedValue(new Set())
    mocks.list.mockResolvedValue([
      {
        ...model,
        input_constraints: { 'audio.tts': { roles: [{ role: 'reference_audio', min_count: 1, max_count: 1 }] } },
      },
    ])
    render(
      <CanvasAudioGenerator
        nodeId="a"
        data={{ audioReferences: [{ assetId: 88, workspaceId: 21, title: '已删除.wav' }] }}
        workspaceId={21}
      />,
    )
    await choose()
    expect(await screen.findByText(/参考音频（素材 ID 88）已不可用/)).toBeInTheDocument()
    expect(mocks.estimate).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('无需先切换生成方式即可选择全部真实模型，并自动同步生成方式', async () => {
    mocks.list.mockResolvedValue([
      model,
      { ...model, id: 92, display_name: '音乐模型', operation_codes: ['audio.music'] },
    ])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '音频生成模型' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '音频生成模型' }))
    expect(screen.getByRole('option', { name: /音乐模型.*背景音乐/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '音频生成方式' })).toHaveTextContent('请选择配音类型')
    fireEvent.click(screen.getByRole('button', { name: '音频生成方式' }))
    fireEvent.click(screen.getByRole('option', { name: '背景音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '音频生成模型' }))
    expect(screen.getByRole('option', { name: /音乐模型.*背景音乐/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /配音模型.*配音/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('描述音乐风格、节奏与氛围')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /配音模型.*配音/ }))
    expect(screen.getByRole('button', { name: '音频生成方式' })).toHaveTextContent('文字配音')
    expect(mocks.update).toHaveBeenCalledWith('a', expect.objectContaining({ operationCode: 'audio.tts' }))
  })
  it('跨空间参考音频不能预估或生成', async () => {
    render(
      <CanvasAudioGenerator
        nodeId="a"
        data={{ audioReferences: [{ assetId: 88, workspaceId: 22, title: '样音.wav' }] }}
        workspaceId={21}
      />,
    )
    await choose()
    await screen.findByRole('alert')
    expect(mocks.estimate).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('上传参考音频只保存素材 ID、工作空间与名称', async () => {
    mocks.list.mockResolvedValue([
      {
        ...model,
        input_constraints: { 'audio.tts': { roles: [{ role: 'reference_audio', min_count: 0, max_count: 1 }] } },
      },
    ])
    mocks.upload.mockResolvedValue({ asset: { id: 89, url: 'https://example.com/audio?signature=temporary' } })
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.change(screen.getByLabelText('上传参考音频'), {
      target: { files: [new File(['sample'], 'sample.wav', { type: 'audio/wav' })] },
    })
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith('a', {
        audioReferences: [{ assetId: 89, workspaceId: 21, title: 'sample.wav' }],
      }),
    )
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('未选择模型时也能从参考音频入口上传文件', async () => {
    mocks.upload.mockResolvedValue({ asset: { id: 90 } })
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    const upload = screen.getByRole('button', { name: '+ 参考音频' })
    expect(upload).toBeEnabled()
    fireEvent.change(screen.getByLabelText('上传参考音频'), {
      target: { files: [new File(['sample'], 'voice.wav', { type: 'audio/wav' })] },
    })
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith('a', {
        audioReferences: [{ assetId: 90, workspaceId: 21, title: 'voice.wav' }],
      }),
    )
  })
  it('复制的画布音频节点可以粘贴为参考音频', () => {
    setCopiedCanvasAudioReference(
      {
        nodes: [{ id: 'source', kind: 'audio', dx: 0, dy: 0, data: { assetId: 88, title: '参考.wav' } }],
        edges: [],
        width: 100,
        height: 100,
      },
      21,
    )
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    fireEvent.paste(screen.getByLabelText(/参考音频，可粘贴/), { clipboardData: { files: [] } })
    expect(mocks.update).toHaveBeenCalledWith('a', {
      audioReferences: [{ assetId: 88, workspaceId: 21, title: '参考.wav' }],
    })
  })
  it('参考音频超出模型声明的大小限制时不发起上传', async () => {
    mocks.list.mockResolvedValue([
      {
        ...model,
        input_constraints: {
          'audio.tts': { roles: [{ role: 'reference_audio', min_count: 0, max_count: 1, max_size_bytes: 2 }] },
        },
      },
    ])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.change(screen.getByLabelText('上传参考音频'), {
      target: { files: [new File(['large'], 'large.wav', { type: 'audio/wav' })] },
    })
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('异步报价在文案变化后返回也不会显示过期金额', async () => {
    let resolveQuote!: (value: any) => void
    mocks.estimate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuote = resolve
        }),
    )
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    await waitFor(() => expect(mocks.estimate).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('配音文案或音乐描述'), { target: { value: '新文案' } })
    resolveQuote({ estimated_cost: 777, can_afford: true })
    await waitFor(() => expect(mocks.estimate).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/约15\.54元/)).not.toBeInTheDocument()
  })
  it('上游文案也计入 2000 字限制，超限不产生生成费用', async () => {
    mocks.edges.mockReturnValue([{ source: 'text', target: 'a' }])
    mocks.node.mockReturnValue({ data: { kind: 'text', text: '文'.repeat(2000) } })
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await screen.findByRole('alert')
    expect(mocks.estimate).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('音色克隆必须先声明授权', async () => {
    mocks.list.mockResolvedValue([{ ...model, operation_codes: ['audio.clone'] }])
    render(<CanvasAudioGenerator nodeId="a" data={{ assetId: 81 }} workspaceId={21} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '音频生成模型' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '音频生成模型' }))
    fireEvent.click(screen.getByRole('option', { name: /音色克隆/ }))
    fireEvent.change(screen.getByLabelText('配音文案或音乐描述'), { target: { value: '欢迎' } })
    expect(screen.getByRole('button', { name: '重新生成' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('我确认该声音属于本人或已取得音色克隆授权'))
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.submit.mock.calls[0][0].inputAssets).toEqual([{ asset_id: 81, role: 'audio' }])
  })
  it('按后端声明的 role 提交已连线的参考音频，预估与提交素材一致', async () => {
    mocks.list.mockResolvedValue({
      data: [
        {
          ...model,
          input_constraints: { 'audio.tts': { roles: [{ role: 'reference_audio', min_count: 1, max_count: 2 }] } },
        },
      ],
    })
    mocks.edges.mockReturnValue([{ source: 'sample', target: 'a' }])
    mocks.node.mockReturnValue({ type: 'audio', data: { assetId: 82, assetWorkspaceId: 21 } })
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    expect(mocks.estimate.mock.calls[0][0].inputAssets).toEqual([{ asset_id: 82, role: 'reference_audio' }])
    expect(mocks.submit.mock.calls[0][0].inputAssets).toEqual(mocks.estimate.mock.calls[0][0].inputAssets)
  })
  it('缺少必需参考音频时不预估也不提交', async () => {
    mocks.list.mockResolvedValue([
      { ...model, input_constraints: { 'audio.tts': { roles: [{ role: 'audio', min_count: 1, max_count: 1 }] } } },
    ])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await screen.findByRole('alert')
    expect(mocks.estimate).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('恢复原任务并读取结构化输出，元数据失败仍保留成功素材', async () => {
    const completed = { id: 71, status: 'succeeded', outputs: [{ asset_id: 82, type: 'audio' }] }
    mocks.wait.mockResolvedValue(completed)
    mocks.result.mockResolvedValue(82)
    mocks.duration.mockRejectedValue(new Error('临时无法读取时长'))
    render(<CanvasAudioGenerator nodeId="a" data={{ taskId: 71, taskStatus: 'processing' }} workspaceId={21} />)
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith('a', expect.objectContaining({ assetId: 82, taskStatus: 'succeeded' })),
    )
    expect(mocks.result).toHaveBeenCalledWith({ workspaceId: 21, task: completed, type: 'audio', fallbackTaskId: 71 })
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('音频入库成功后通知画布创建独立编辑节点', async () => {
    mocks.wait.mockResolvedValue({ id: 71, status: 'succeeded' })
    mocks.result.mockResolvedValue(82)
    mocks.duration.mockResolvedValue(8)
    const onGenerated = vi.fn()
    render(
      <CanvasAudioGenerator
        nodeId="a"
        data={{ taskId: 71, taskStatus: 'processing' }}
        workspaceId={21}
        onGenerated={onGenerated}
      />,
    )
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith('a', 82, 8))
  })
  it('任务完成时合并节点最新的编辑和历史，不用轮询开始时的旧数据覆盖', async () => {
    mocks.wait.mockResolvedValue({ id: 71, status: 'succeeded' })
    mocks.result.mockResolvedValue(82)
    mocks.duration.mockResolvedValue(8)
    mocks.node.mockReturnValue({
      data: {
        prompt: '更新后的文案',
        audio: { lane: 'bgm', volume: 0.4 },
        resultHistory: [{ assetId: 80, kind: 'audio', prompt: '旧版本' }],
      },
    })
    render(
      <CanvasAudioGenerator
        nodeId="a"
        data={{ taskId: 71, taskStatus: 'processing', prompt: '旧文案', audio: { volume: 1 } }}
        workspaceId={21}
      />,
    )
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('a', expect.objectContaining({ assetId: 82 })))
    expect(mocks.update).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({
        audio: expect.objectContaining({ lane: 'bgm', volume: 0.4 }),
        resultHistory: [
          expect.objectContaining({ assetId: 80 }),
          expect.objectContaining({ assetId: 82, prompt: '更新后的文案' }),
        ],
      }),
    )
  })
  it('schema 数值越界时阻止提交', async () => {
    mocks.list.mockResolvedValue([
      { ...model, params_schema: { properties: { speed: { type: 'number', default: 1, minimum: 0.5, maximum: 2 } } } },
    ])
    render(<CanvasAudioGenerator nodeId="a" data={{}} workspaceId={21} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: '生成参数' }))
    fireEvent.change(screen.getByLabelText('speed'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '生成音频' }))
    await screen.findByRole('alert')
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})
