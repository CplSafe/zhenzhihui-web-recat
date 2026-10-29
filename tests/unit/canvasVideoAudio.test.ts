import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { composeVideoAudio, snapshotVideoAudio, needsVideoAudioComposition } from '@/utils/canvasVideoAudio'
import { nodeToMutation, collectCanvasElementAssetIds } from '@/utils/canvasElements'
import { restoreCanvasTaskState } from '@/utils/canvasTaskState'

const mocks = vi.hoisted(() => ({ upload: vi.fn(), mix: vi.fn(), demux: vi.fn(), duration: vi.fn() }))
vi.mock('@/api/business', async (original) => ({
  ...(await original<typeof import('@/api/business')>()),
  uploadAssetFile: mocks.upload,
}))
vi.mock('@/utils/audioMix', () => ({ mixAudioIntoMp4: mocks.mix }))
vi.mock('@/utils/mp4Demux', () => ({ demuxMp4: mocks.demux }))
vi.mock('@/utils/canvasAudio', async (original) => ({
  ...(await original<typeof import('@/utils/canvasAudio')>()),
  readAudioDuration: mocks.duration,
}))

const source = () => ({
  id: 'voice',
  position: { x: 0, y: 0 },
  data: {
    kind: 'audio',
    assetId: 55,
    title: '准确台词',
    audio: { durationSec: 2, inSec: 0.5, outSec: 2, volume: 0.8 },
  },
})
const snapshot = () =>
  snapshotVideoAudio(
    [{ kind: 'audio', sourceId: 'voice', assetId: 55, workspaceId: 21 }],
    [source()],
    21,
    'submission',
  )!

describe('生成视频保留原配音', () => {
  it('已成功但仍指向模型原片时补做配音，合成结果和无配音任务不重复处理', () => {
    const composition = snapshot()
    expect(needsVideoAudioComposition({ assetId: 701, videoAudioComposition: composition })).toBe(true)
    composition.result = { sourceAssetId: 701, assetId: 702 }
    expect(needsVideoAudioComposition({ assetId: 701, videoAudioComposition: composition })).toBe(true)
    expect(needsVideoAudioComposition({ assetId: 702, videoAudioComposition: composition })).toBe(false)
    expect(needsVideoAudioComposition({ assetId: 600, videoAudioComposition: composition })).toBe(false)
    expect(needsVideoAudioComposition({ assetId: 701 })).toBe(false)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.demux.mockReturnValue({ video: { duration: 5000, timescale: 1000 } })
    mocks.mix.mockResolvedValue(new Blob(['composed'], { type: 'video/mp4' }))
    mocks.upload.mockResolvedValue({ asset: { id: 702 } })
    mocks.duration.mockResolvedValue(2)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) })),
    )
  })
  afterEach(() => vi.unstubAllGlobals())
  it('固定提交时的资产、裁剪和音量，不随上游变化', () => {
    const node = source()
    const value = snapshotVideoAudio([{ kind: 'audio', sourceId: 'voice', assetId: 55 }], [node], 21, 'submission')!
    node.data.assetId = 99
    node.data.audio.volume = 0.1
    expect(value.clips[0]).toMatchObject({ assetId: 55, inSec: 0.5, outSec: 2, volume: 0.8 })
    expect(snapshotVideoAudio([], [], 21, 'empty')).toBeUndefined()
    expect(() => snapshotVideoAudio([{ kind: 'audio', assetId: 55, workspaceId: 22 }], [node], 21, 'x')).toThrow(
      '工作空间',
    )
    expect(() => snapshotVideoAudio([{ kind: 'audio', sourceId: 'voice', assetId: 55 }], [node], 21, 'x')).toThrow(
      '已更换',
    )
  })
  it('以原音频替换模型声轨，上传 MP4 并返回最终素材', async () => {
    const value = snapshot()
    expect(await composeVideoAudio(21, 701, value)).toBe(702)
    expect(mocks.mix).toHaveBeenCalledWith(expect.anything(), value.clips, 5, 21, 0)
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 21, file: expect.any(File) }))
    const file = mocks.upload.mock.calls[0][0].file as File
    expect(file.type).toBe('video/mp4')
    expect(file.name).toContain('701')
  })
  it('缓存已经入库的合成结果，刷新后不重复合成上传', async () => {
    expect(await composeVideoAudio(21, 701, { ...snapshot(), result: { sourceAssetId: 701, assetId: 702 } })).toBe(702)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('多段默认配音依次播放，避免角色台词从零秒重叠', async () => {
    const value = snapshot()
    value.clips.push({ ...value.clips[0], assetId: 56, sourceNodeId: 'voice-2' })
    await composeVideoAudio(21, 701, value)
    expect(mocks.mix.mock.calls[0][1].map((clip: { startSec: number }) => clip.startSec)).toEqual([0, 1.5])
  })
  it('长于视频的配音拒绝静默截断；短暂上传失败允许重试同一视频', async () => {
    mocks.demux.mockReturnValueOnce({ video: { duration: 1000, timescale: 1000 } })
    await expect(composeVideoAudio(21, 701, snapshot())).rejects.toThrow('避免截断台词')
    expect(mocks.mix).not.toHaveBeenCalled()
    mocks.upload.mockRejectedValueOnce(new Error('网络错误'))
    await expect(composeVideoAudio(21, 701, snapshot())).rejects.toThrow('不会重新生成视频')
    expect(await composeVideoAudio(21, 701, snapshot())).toBe(702)
  })
  it('切换工作空间或离开页面后取消，不再上传结果', async () => {
    const abort = new AbortController()
    mocks.mix.mockImplementationOnce(async () => {
      abort.abort()
      return new Blob()
    })
    await expect(composeVideoAudio(21, 701, snapshot(), abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('持久化素材快照，引用收集包含原配音和前后视频，合成失败不自动重新提交', () => {
    const value = { ...snapshot(), failed: true, result: { sourceAssetId: 701, assetId: 702 } }
    const mutation = nodeToMutation({
      id: 'video',
      position: { x: 0, y: 0 },
      data: { kind: 'video', videoAudioComposition: value },
    })
    expect(mutation.payload?.data).toMatchObject({ videoAudioComposition: value })
    expect([...collectCanvasElementAssetIds([mutation])]).toEqual(expect.arrayContaining([55, 701, 702]))
    const failed = { taskId: 123, taskStatus: 'result_sync_failed', videoAudioComposition: value }
    expect(restoreCanvasTaskState(failed)).toBe(failed)
  })
})
