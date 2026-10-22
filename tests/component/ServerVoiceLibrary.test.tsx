import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ServerVoiceLibrary from '@/components/canvas/ServerVoiceLibrary'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  filters: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  favorite: vi.fn(),
  retry: vi.fn(),
  sync: vi.fn(),
  upload: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('@/api/voices', async (original) => ({
  ...(await original<typeof import('@/api/voices')>()),
  listVoices: mocks.list,
  getVoiceFilters: mocks.filters,
  getVoice: mocks.get,
  createVoice: mocks.create,
  updateVoice: mocks.edit,
  deleteVoice: mocks.remove,
  setVoiceFavorite: mocks.favorite,
  retryVoice: mocks.retry,
  syncVoice: mocks.sync,
}))
vi.mock('@/api/business', () => ({ uploadAssetFile: mocks.upload }))
vi.mock('@/composables/useToast', () => ({ useConfirmDialog: () => ({ requestConfirm: mocks.confirm }) }))
const voice = { id: 5, name: '角色旁白', source: 'cloned', status: 'ready', workspace_id: 21, is_favorite: false }
const props = () => ({
  userId: 'user',
  workspaceId: 21,
  modelVersionId: 91,
  canManage: true,
  disabled: false,
  onSelect: vi.fn(),
  onBusyChange: vi.fn(),
})
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.list.mockResolvedValue({ items: [voice], total: 1 })
  mocks.filters.mockResolvedValue({ sources: ['public', 'cloned'], languages: ['it', 'vi'] })
  mocks.get.mockResolvedValue(voice)
  mocks.sync.mockResolvedValue(voice)
  mocks.confirm.mockResolvedValue(true)
  mocks.upload.mockResolvedValue({ asset: { id: 55 } })
})

describe('公共音色库业务交互', () => {
  it('画布入口提供系统、我的和收藏分类，只在我的音色开放添加，不开放其他管理', async () => {
    render(<ServerVoiceLibrary {...props()} browseOnly />)
    await screen.findByRole('button', { name: '选用' })
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'public' }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索音色' }), { target: { value: '旁白' } })
    fireEvent.click(screen.getByRole('button', { name: '我的音色' }))
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: 'cloned', q: undefined, offset: 0 }),
      ),
    )
    expect(mocks.filters).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'cloned' }))
    expect(screen.getByRole('button', { name: '添加音色' })).toBeEnabled()
    for (const name of ['创建音色', '编辑', '删除', '重试训练', '同步'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收藏' }))
    expect(screen.queryByRole('button', { name: '添加音色' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: undefined, favorites: true, offset: 0 }),
      ),
    )
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
  })
  it('普通成员在我的音色看到禁用入口及权限说明', () => {
    render(<ServerVoiceLibrary {...props()} canManage={false} browseOnly />)
    fireEvent.click(screen.getByRole('button', { name: '我的音色' }))
    expect(screen.getByRole('button', { name: '添加音色' })).toBeDisabled()
    expect(screen.getByText(/添加音色需要空间所有者或管理员权限/)).toBeVisible()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('从我的音色添加后清除旧筛选以显示训练结果，取消可返回列表', async () => {
    mocks.create.mockResolvedValue({ ...voice, status: 'training' })
    render(<ServerVoiceLibrary {...props()} browseOnly />)
    fireEvent.click(screen.getByRole('button', { name: '我的音色' }))
    fireEvent.click(screen.getByRole('button', { name: '添加音色' }))
    expect(screen.getByLabelText('复刻供应商')).toHaveValue('minimax')
    expect(screen.getByLabelText('复刻供应商').querySelectorAll('option')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(await screen.findByRole('button', { name: '我的音色' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索音色' }), { target: { value: '旧筛选' } })
    fireEvent.click(screen.getByRole('button', { name: '添加音色' }))
    expect(screen.getByLabelText('复刻供应商')).toHaveValue('minimax')
    expect(screen.getByLabelText('复刻供应商').querySelectorAll('option')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: '新音色' } })
    fireEvent.change(screen.getByLabelText('上传训练录音'), {
      target: { files: [new File(['sound'], 'sample.wav', { type: 'audio/wav' })] },
    })
    Object.defineProperty(screen.getByLabelText('试听训练录音'), 'duration', { value: 12, configurable: true })
    fireEvent.loadedMetadata(screen.getByLabelText('试听训练录音'))
    fireEvent.click(screen.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' }))
    fireEvent.click(screen.getByRole('button', { name: '提交复刻' }))
    await screen.findByText(/音色创建请求已提交/)
    expect(screen.getByRole('textbox', { name: '搜索音色' })).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: '只看当前模型兼容音色' })).not.toBeChecked()
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          source: 'cloned',
          q: undefined,
          modelVersionId: undefined,
          offset: 0,
        }),
      ),
    )
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it('收藏失败保留列表并显示错误，重试成功后收藏分类按后端结果刷新', async () => {
    let favorite = false
    mocks.list.mockImplementation(async (options) => ({
      items: options.favorites && !favorite ? [] : [{ ...voice, is_favorite: favorite }],
      total: options.favorites && !favorite ? 0 : 1,
    }))
    mocks.favorite
      .mockRejectedValueOnce(new Error('收藏失败'))
      .mockImplementationOnce(async () => {
        favorite = true
      })
      .mockImplementationOnce(async () => {
        favorite = false
      })
    render(<ServerVoiceLibrary {...props()} browseOnly />)
    fireEvent.click(await screen.findByRole('button', { name: '收藏 角色旁白' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('收藏失败')
    expect(screen.getByRole('button', { name: '选用' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '收藏 角色旁白' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '收藏 角色旁白' }))
    await screen.findByRole('button', { name: '取消收藏 角色旁白' })
    expect(mocks.favorite).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 21 }), 5, true)
    fireEvent.click(screen.getByRole('button', { name: '收藏' }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ favorites: true })))
    fireEvent.click(await screen.findByRole('button', { name: '取消收藏 角色旁白' }))
    expect(await screen.findByText(/暂无符合条件的收藏/)).toBeInTheDocument()
    expect(mocks.favorite).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 21 }), 5, false)
  })
  it('通过筛选接口加载语种，选中后两接口使用相同条件，不扫描列表', async () => {
    render(<ServerVoiceLibrary {...props()} />)
    const select = await screen.findByRole('combobox', { name: '音色语种' })
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.mouseDown(select)
    fireEvent.click(await screen.findByText('越南语（vi）'))
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0, language: 'vi' })),
    )
    expect(mocks.filters).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 21, modelVersionId: 91, language: 'vi' }),
    )
    expect(mocks.list.mock.calls.every(([options]) => options.limit === 20)).toBe(true)
    expect(screen.queryByRole('combobox', { name: '音色情绪' })).not.toBeInTheDocument()
  })
  it('筛选接口失败仍能查询音色，独立重试后恢复真实选项', async () => {
    mocks.filters.mockRejectedValueOnce(new Error('筛选服务暂不可用'))
    render(<ServerVoiceLibrary {...props()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('筛选选项加载失败：筛选服务暂不可用')
    expect(await screen.findByRole('button', { name: '选用' })).toBeEnabled()
    expect(screen.queryByText('暂无符合条件的音色。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试筛选' }))
    expect(await screen.findByRole('combobox', { name: '音色语种' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })
  it('搜索和多选筛选回到第一页，清除后不再携带筛选值', async () => {
    mocks.filters.mockResolvedValue({ sources: ['public'], providers: ['minimax'], voice_features: ['温柔', '清亮'] })
    mocks.list.mockResolvedValue({ items: [{ ...voice, source: 'public' }], total: 60 })
    render(<ServerVoiceLibrary {...props()} publicOnly />)
    await screen.findByRole('button', { name: '选用' })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 })))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索公共音色' }), { target: { value: '旁白' } })
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: '旁白', offset: 0 })))
    const select = screen.getByRole('combobox', { name: '音色声音特征' })
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.mouseDown(select)
    fireEvent.click(await screen.findByTitle('温柔'))
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ voice_feature: ['温柔'], q: '旁白', offset: 0 }),
      ),
    )
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.mouseDown(select)
    fireEvent.click(await screen.findByTitle('清亮'))
    await waitFor(() =>
      expect(mocks.filters).toHaveBeenLastCalledWith(
        expect.objectContaining({ voice_feature: ['温柔', '清亮'], source: 'public' }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: undefined, source: 'public', offset: 0 }),
      ),
    )
    expect(mocks.list.mock.lastCall?.[0].voice_feature).toBeUndefined()
  })
  it('搜索切换会取消旧请求，迟到的列表和筛选选项不能覆盖新结果', async () => {
    let oldList!: (value: unknown) => void
    let oldFilters!: (value: unknown) => void
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldList = resolve
        }),
    )
    mocks.filters.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldFilters = resolve
        }),
    )
    render(<ServerVoiceLibrary {...props()} />)
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1))
    const listSignal = mocks.list.mock.calls[0][0].signal as AbortSignal
    const filterSignal = mocks.filters.mock.calls[0][0].signal as AbortSignal
    fireEvent.change(screen.getByRole('textbox', { name: '搜索公共音色' }), { target: { value: '新旁白' } })
    expect(listSignal.aborted).toBe(true)
    expect(filterSignal.aborted).toBe(true)
    await screen.findByRole('button', { name: '选用' })
    await act(async () => {
      oldList({ items: [{ ...voice, name: '过期音色' }], total: 1 })
      oldFilters({ languages: ['ja'] })
    })
    expect(screen.queryByText('过期音色')).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '音色语种' }))
    expect(await screen.findByText('越南语（vi）')).toBeInTheDocument()
    expect(screen.queryByText('日语（ja）')).not.toBeInTheDocument()
  })
  it('公共音色不显示手动同步，试听失败也不提示同步', async () => {
    mocks.list.mockResolvedValue({
      items: [{ ...voice, source: 'public', preview_url: 'https://example.com/preview.mp3' }],
      total: 1,
    })
    render(<ServerVoiceLibrary {...props()} publicOnly />)
    const preview = await screen.findByLabelText('试听 角色旁白')
    expect(screen.queryByRole('button', { name: '同步' })).not.toBeInTheDocument()
    fireEvent.error(preview)
    expect(screen.getByRole('alert')).toHaveTextContent('试听暂时不可用，请稍后重试')
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选用' })).toBeEnabled()
    expect(screen.queryByText(/同步/)).not.toBeInTheDocument()
  })
  it('公共音色没有语种和试听时隐藏空项并保留选用', async () => {
    mocks.list.mockResolvedValue({
      items: [{ ...voice, source: 'public', language: '', gender: '', tags: [] }],
      total: 1,
    })
    render(<ServerVoiceLibrary {...props()} publicOnly />)
    expect(await screen.findByRole('button', { name: '选用' })).toBeEnabled()
    expect(screen.queryByText('暂无试听。')).not.toBeInTheDocument()
    expect(screen.queryByText('语种未标注')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('试听 角色旁白')).not.toBeInTheDocument()
    expect(screen.queryByText(/同步/)).not.toBeInTheDocument()
  })
  it('训练中音色仍自动同步并更新为可用', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    mocks.list.mockResolvedValue({ items: [{ ...voice, status: 'training' }], total: 1 })
    const view = render(<ServerVoiceLibrary {...props()} />)
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      expect(screen.getByRole('button', { name: '选用' })).toBeDisabled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9700)
      })
      expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5)
      expect(screen.getByRole('button', { name: '选用' })).toBeEnabled()
    } finally {
      view.unmount()
      visibility.mockRestore()
      vi.useRealTimers()
    }
  })
  it('按模型读取并在选用时重新获取详情', async () => {
    const p = props()
    render(<ServerVoiceLibrary {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: '选用' }))
    await waitFor(() => expect(p.onSelect).toHaveBeenCalledWith(voice))
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 21, modelVersionId: 91, limit: 20, offset: 0 }),
    )
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5)
  })
  it('更新筛选时保留已加载下拉框的可操作状态', async () => {
    render(<ServerVoiceLibrary {...props()} browseOnly />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '音色语种' })).toBeEnabled())
    mocks.filters.mockImplementationOnce(() => new Promise(() => {}))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索音色' }), { target: { value: '旁白' } })
    await waitFor(() => expect(mocks.filters).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('combobox', { name: '音色语种' })).toBeEnabled()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '音色语种' }))
    expect(screen.getByRole('combobox', { name: '音色语种' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(await screen.findByText('越南语（vi）'))
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'vi' })))
  })
  it('只读成员不能创建，未就绪音色不可选用', async () => {
    mocks.list.mockResolvedValue({ items: [{ ...voice, status: 'training' }], total: 1 })
    render(<ServerVoiceLibrary {...props()} canManage={false} />)
    expect(screen.getByRole('button', { name: '创建音色' })).toBeDisabled()
    expect(await screen.findByRole('button', { name: '选用' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
  })
  it('移除收藏入口，详情和同步仍调用真实客户端', async () => {
    render(<ServerVoiceLibrary {...props()} />)
    await screen.findByRole('button', { name: '选用' })
    expect(screen.queryByRole('button', { name: /收藏/ })).not.toBeInTheDocument()
    expect(mocks.favorite).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: '详情' })).toBeEnabled())
    fireEvent.click(await screen.findByRole('button', { name: '详情' }))
    expect(await screen.findByLabelText('音色详情')).toHaveTextContent('角色旁白')
    await waitFor(() => expect(screen.getByRole('button', { name: '同步' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '同步' }))
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5))
  })
  it('创建失败后复用已上传录音及幂等键，不污染配音参考列表', async () => {
    mocks.create
      .mockRejectedValueOnce(
        Object.assign(new Error('音色参数或录音素材无效'), { status: 400, code: 10400, requestId: 'voice-check-123' }),
      )
      .mockResolvedValueOnce(voice)
    render(<ServerVoiceLibrary {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '创建音色' }))
    expect(screen.getByLabelText('复刻供应商')).toHaveValue('minimax')
    expect(screen.getByLabelText('复刻供应商').querySelectorAll('option')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: '角色旁白' } })
    fireEvent.change(screen.getByLabelText('上传训练录音'), {
      target: { files: [new File(['sound'], 'record.wav', { type: 'audio/wav' })] },
    })
    Object.defineProperty(screen.getByLabelText('试听训练录音'), 'duration', { value: 12, configurable: true })
    fireEvent.loadedMetadata(screen.getByLabelText('试听训练录音'))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '提交复刻' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '音色创建失败：音色参数或录音素材无效（HTTP 400；错误码 10400；请求编号 voice-check-123）',
    )
    fireEvent.click(screen.getByRole('button', { name: '提交复刻' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][1]).toMatchObject({
      sample_asset_id: 55,
      consent_confirmed: true,
      name: '角色旁白',
    })
    expect(mocks.create.mock.calls[0][1].idempotency_key).toBe(mocks.create.mock.calls[1][1].idempotency_key)
  })
  it.each([
    ['录音上传', { status: 400, code: 400 }, '录音上传失败：服务端拒绝'],
    [
      '音色创建',
      { status: 200, code: 10101, response: { code_string: 'UNAUTHORIZED' } },
      '音色创建失败：登录状态已失效，请重新登录后再提交',
    ],
  ])('%s 失败与登录失效分开反馈', async (stage, details, expected) => {
    const failure = Object.assign(new Error('服务端拒绝'), details)
    if (stage === '录音上传') mocks.upload.mockRejectedValueOnce(failure)
    else mocks.create.mockRejectedValueOnce(failure)
    render(<ServerVoiceLibrary {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '创建音色' }))
    expect(screen.getByLabelText('复刻供应商')).toHaveValue('minimax')
    expect(screen.getByLabelText('复刻供应商').querySelectorAll('option')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: '男生' } })
    fireEvent.change(screen.getByLabelText('上传训练录音'), {
      target: { files: [new File(['sound'], 'record.wav', { type: 'audio/wav' })] },
    })
    Object.defineProperty(screen.getByLabelText('试听训练录音'), 'duration', { value: 12, configurable: true })
    fireEvent.loadedMetadata(screen.getByLabelText('试听训练录音'))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '提交复刻' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(expected)
    expect(screen.getByLabelText('音色名称')).toHaveValue('男生')
    if (stage === '录音上传') expect(mocks.create).not.toHaveBeenCalled()
  })
  it('MiniMax默认选择并在提交前拒绝短录音，合规录音携带供应商', async () => {
    mocks.create.mockResolvedValue(voice)
    render(<ServerVoiceLibrary {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '创建音色' }))
    expect(screen.getByLabelText('复刻供应商')).toHaveValue('minimax')
    fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: '你好' } })
    fireEvent.change(screen.getByLabelText('上传训练录音'), {
      target: { files: [new File(['sound'], 'sample.wav', { type: 'audio/wav' })] },
    })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: '提交复刻' })).toBeDisabled()
    const audio = screen.getByLabelText('试听训练录音')
    Object.defineProperty(audio, 'duration', { value: 5, configurable: true })
    fireEvent.loadedMetadata(audio)
    expect(screen.getByRole('alert')).toHaveTextContent('当前为 5.0 秒')
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    Object.defineProperty(audio, 'duration', { value: 12, configurable: true })
    fireEvent.durationChange(audio)
    fireEvent.click(screen.getByRole('button', { name: '提交复刻' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ provider: 'minimax', sample_asset_id: 55 }),
      ),
    )
  })
  it('编辑元信息及确认删除，删除不操作素材资产', async () => {
    render(<ServerVoiceLibrary {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: '新旁白' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() =>
      expect(mocks.edit).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 21 }),
        5,
        expect.objectContaining({ name: '新旁白' }),
      ),
    )
    await waitFor(() => expect(mocks.list.mock.calls.filter(([options]) => options.limit === 20)).toHaveLength(2))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('不会回收'), expect.anything())
  })
  it('失败训练可沿用样本重试，错误不会显示为可用', async () => {
    mocks.list.mockResolvedValue({
      items: [{ ...voice, status: 'failed', last_error: '录音不清晰', remaining_training_times: 2 }],
      total: 1,
    })
    mocks.retry.mockResolvedValue({ ...voice, status: 'training' })
    render(<ServerVoiceLibrary {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: '重试训练' }))
    fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
    await waitFor(() =>
      expect(mocks.retry).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21 }), 5, undefined),
    )
  })
  it('列表异常显示可重试错误，不伪装为空列表或无权限', async () => {
    mocks.list.mockRejectedValue(new Error('权限不足'))
    render(<ServerVoiceLibrary {...props()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('权限不足')
    expect(screen.queryByText('暂无符合条件的音色。')).not.toBeInTheDocument()
  })
})
