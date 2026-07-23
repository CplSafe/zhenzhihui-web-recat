import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearHotCopyDraft,
  clearHotCopyDraftsForUser,
  loadHotCopyDraft,
  saveHotCopyDraft,
  setHotCopyDraftUserScope,
  type HotCopyDraft,
} from '@/utils/hotCopyDraft'

function draft(overrides: Partial<HotCopyDraft> = {}): HotCopyDraft {
  return {
    started: true,
    step: 1,
    maxReached: 1,
    basePrompt: '突出产品卖点',
    projectName: '夏日饮品短片',
    nameTouched: false,
    sourceVideo: { assetId: 101, url: '/api/v1/assets/101/download?workspace_id=21' },
    productAssetIds: [201, 202],
    fullVideo: { assetId: 0, url: '' },
    videoVersions: [],
    vidGenTaskId: 301,
    videoGenerating: true,
    videoGenerations: [
      {
        id: 'generation-1',
        status: 'processing',
        taskId: 301,
        note: '首次生成',
        createdAt: 1_800_000_000_000,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  setHotCopyDraftUserScope('')
})

describe('hot-copy 本地草稿隔离', () => {
  it('只在相同用户和工作空间中恢复完整生成凭据', () => {
    const saved = draft()
    setHotCopyDraftUserScope('user-7')

    saveHotCopyDraft(21, saved)

    expect(loadHotCopyDraft(21)).toEqual(saved)
    expect(loadHotCopyDraft(22)).toBeNull()

    setHotCopyDraftUserScope('user-8')
    expect(loadHotCopyDraft(21)).toBeNull()

    setHotCopyDraftUserScope('user-7')
    expect(loadHotCopyDraft(21)?.videoGenerations?.[0]).toMatchObject({
      id: 'generation-1',
      taskId: 301,
      status: 'processing',
    })

    saveHotCopyDraft(
      21,
      draft({
        entryInitial: { duration: '7s' },
        genDurationSec: 7,
      }),
    )
    expect(loadHotCopyDraft(21)).toMatchObject({
      entryInitial: { duration: '7s' },
      genDurationSec: 7,
    })
  })

  it('不同用户在同一工作空间保存各自的草稿', () => {
    setHotCopyDraftUserScope('user-a')
    saveHotCopyDraft(21, draft({ projectId: 11, projectName: '用户 A 项目' }))

    setHotCopyDraftUserScope('user-b')
    saveHotCopyDraft(21, draft({ projectId: 12, projectName: '用户 B 项目' }))

    expect(loadHotCopyDraft(21)?.projectName).toBe('用户 B 项目')
    setHotCopyDraftUserScope('user-a')
    expect(loadHotCopyDraft(21)?.projectName).toBe('用户 A 项目')
  })

  it('删除无归属的旧版工作空间键且不分配给任何会话', () => {
    window.localStorage.setItem('zzh_hotcopy_draft_v1_ws21', JSON.stringify(draft({ projectName: '旧版草稿' })))
    setHotCopyDraftUserScope('')

    expect(loadHotCopyDraft(21)).toBeNull()
    expect(window.localStorage.getItem('zzh_hotcopy_draft_v1_ws21')).toBeNull()
    expect(window.localStorage.getItem('zzh_hotcopy_draft_v1_uanon_ws21')).toBeNull()

    window.localStorage.setItem('zzh_hotcopy_draft_v1_ws22', JSON.stringify(draft({ projectName: '无归属草稿' })))
    setHotCopyDraftUserScope('user-7')

    expect(loadHotCopyDraft(22)).toBeNull()
    expect(window.localStorage.getItem('zzh_hotcopy_draft_v1_ws22')).toBeNull()
  })

  it('清理当前草稿时同时移除当前用户键和旧版键，不影响其他用户', () => {
    window.localStorage.setItem('zzh_hotcopy_draft_v1_ws21', JSON.stringify(draft({ projectName: '旧版草稿' })))
    setHotCopyDraftUserScope('user-a')
    saveHotCopyDraft(21, draft({ projectName: '用户 A 项目' }))
    setHotCopyDraftUserScope('user-b')
    saveHotCopyDraft(21, draft({ projectName: '用户 B 项目' }))

    clearHotCopyDraft(21)

    expect(loadHotCopyDraft(21)).toBeNull()
    expect(window.localStorage.getItem('zzh_hotcopy_draft_v1_ws21')).toBeNull()
    setHotCopyDraftUserScope('user-a')
    expect(loadHotCopyDraft(21)?.projectName).toBe('用户 A 项目')
  })

  it('登出清理当前用户的所有工作空间，但保留其他用户草稿', () => {
    setHotCopyDraftUserScope('user-a')
    saveHotCopyDraft(21, draft({ projectName: '用户 A / 21' }))
    saveHotCopyDraft(22, draft({ projectName: '用户 A / 22' }))
    setHotCopyDraftUserScope('user-b')
    saveHotCopyDraft(21, draft({ projectName: '用户 B / 21' }))

    clearHotCopyDraftsForUser('user-a')

    setHotCopyDraftUserScope('user-a')
    expect(loadHotCopyDraft(21)).toBeNull()
    expect(loadHotCopyDraft(22)).toBeNull()
    setHotCopyDraftUserScope('user-b')
    expect(loadHotCopyDraft(21)?.projectName).toBe('用户 B / 21')
  })

  it('清理用户时精确匹配作用域，不误删包含该用户名前缀的账号', () => {
    setHotCopyDraftUserScope('a')
    saveHotCopyDraft(21, draft({ projectName: '用户 a' }))
    setHotCopyDraftUserScope('a_ws7')
    saveHotCopyDraft(21, draft({ projectName: '用户 a_ws7' }))

    clearHotCopyDraftsForUser('a')

    setHotCopyDraftUserScope('a')
    expect(loadHotCopyDraft(21)).toBeNull()
    setHotCopyDraftUserScope('a_ws7')
    expect(loadHotCopyDraft(21)?.projectName).toBe('用户 a_ws7')
  })

  it('拒绝无效工作空间并安全忽略损坏的 JSON', () => {
    setHotCopyDraftUserScope('user-7')
    saveHotCopyDraft(0, draft())
    saveHotCopyDraft(Number.NaN, draft())

    expect(window.localStorage.length).toBe(0)

    window.localStorage.setItem('zzh_hotcopy_draft_v1_uuser-7_ws21', '{broken-json')
    expect(loadHotCopyDraft(21)).toBeNull()
  })

  it('不会把浏览器 File 的二进制内容写入 localStorage', () => {
    const localVideo = new File(['private-video-binary'], 'private-source.mp4', { type: 'video/mp4' })
    setHotCopyDraftUserScope('user-7')

    saveHotCopyDraft(
      21,
      draft({
        entryInitial: {
          videoFile: localVideo,
          videoPreview: '/api/v1/assets/101/download?workspace_id=21',
        },
      }),
    )

    const raw = window.localStorage.getItem('zzh_hotcopy_draft_v1_uuser-7_ws21') || ''
    expect(raw).not.toContain('private-video-binary')
    expect(raw).not.toContain('private-source.mp4')
    expect(JSON.parse(raw).entryInitial.videoFile).toBeNull()
  })

  it('保存前移除临时媒体地址，同时保留可恢复的 assetId 与持久地址', () => {
    const localFile = new File(['binary'], 'local.png', { type: 'image/png' })
    setHotCopyDraftUserScope('user-7')

    saveHotCopyDraft(
      21,
      draft({
        entryInitial: {
          videoSource: 'local',
          videoFile: localFile,
          videoFileName: 'source.mp4',
          videoPreview: 'blob:source-preview',
          libraryVideo: null,
          products: [
            { url: 'blob:local-only', file: localFile, isVideo: false },
            { url: 'blob:asset-backed', file: null, isVideo: false, assetId: 205 },
            { url: '/api/v1/assets/206/download', file: null, isVideo: false, assetId: 206 },
          ],
        },
        sourceVideo: { assetId: 101, url: 'blob:source-video' },
        fullVideo: { assetId: 501, url: 'data:video/mp4;base64,temporary' },
        videoVersions: [
          { assetId: 0, url: 'blob:discard-me' },
          { assetId: 502, url: 'blob:keep-id-only' },
          { assetId: 503, url: 'https://cdn.example.com/result.mp4' },
          { assetId: 0, url: 'https://cdn.example.com/public-result.mp4' },
        ],
      }),
    )

    const raw = window.localStorage.getItem('zzh_hotcopy_draft_v1_uuser-7_ws21') || ''
    expect(raw).not.toMatch(/(?:blob|data):/i)
    expect(raw).not.toContain('source.mp4')

    const restored = loadHotCopyDraft(21)
    expect(restored?.sourceVideo).toEqual({
      assetId: 101,
      url: '/api/v1/assets/101/download?workspace_id=21',
    })
    expect(restored?.fullVideo).toEqual({
      assetId: 501,
      url: '/api/v1/assets/501/download?workspace_id=21',
    })
    expect(restored?.videoVersions).toEqual([
      { assetId: 502, url: '/api/v1/assets/502/download?workspace_id=21' },
      { assetId: 503, url: '/api/v1/assets/503/download?workspace_id=21' },
      { assetId: 0, url: 'https://cdn.example.com/public-result.mp4' },
    ])
    expect(restored?.entryInitial).toMatchObject({
      videoSource: '',
      videoFile: null,
      videoFileName: '',
      videoPreview: '',
      libraryVideo: null,
    })
    expect(restored?.entryInitial.products).toEqual([
      { url: '/api/v1/assets/205/download?workspace_id=21', file: null, isVideo: false, assetId: 205 },
      { url: '/api/v1/assets/206/download?workspace_id=21', file: null, isVideo: false, assetId: 206 },
    ])
  })

  it('读取已有用户草稿时也屏蔽已经失效的 blob 地址', () => {
    window.localStorage.setItem(
      'zzh_hotcopy_draft_v1_uuser-7_ws21',
      JSON.stringify(
        draft({
          sourceVideo: { assetId: 101, url: 'blob:legacy-source' },
          fullVideo: { assetId: 0, url: 'blob:legacy-result' },
          videoVersions: [{ assetId: 0, url: 'blob:legacy-version' }],
        }),
      ),
    )
    setHotCopyDraftUserScope('user-7')

    const restored = loadHotCopyDraft(21)

    expect(restored?.sourceVideo).toEqual({
      assetId: 101,
      url: '/api/v1/assets/101/download?workspace_id=21',
    })
    expect(restored?.fullVideo).toEqual({ assetId: 0, url: '' })
    expect(restored?.videoVersions).toEqual([])
  })

  it('不会把供应商预签名凭证写入 localStorage', () => {
    setHotCopyDraftUserScope('user-7')
    const signedUrl = 'https://bucket.example.com/result.mp4?X-Amz-Credential=private&X-Amz-Signature=provider-secret'

    saveHotCopyDraft(
      21,
      draft({
        sourceVideo: { assetId: 101, url: signedUrl },
        fullVideo: { assetId: 501, url: signedUrl },
        videoVersions: [
          { assetId: 502, url: signedUrl },
          { assetId: 0, url: `${signedUrl}&version=orphan` },
        ],
      }),
    )

    const raw = window.localStorage.getItem('zzh_hotcopy_draft_v1_uuser-7_ws21') || ''
    expect(raw).not.toContain('provider-secret')
    expect(raw).not.toContain('X-Amz-Credential')
    expect(loadHotCopyDraft(21)?.videoVersions).toEqual([
      { assetId: 502, url: '/api/v1/assets/502/download?workspace_id=21' },
    ])
  })

  it('持久化未提交的视频修改范围，并按 assetId 恢复版本说明', () => {
    setHotCopyDraftUserScope('user-7')
    const videoModificationDraft = {
      overallNote: '整段节奏更紧凑',
      frameSlots: [
        { start: 1, end: 2.5, text: '突出产品特写' },
        { start: null, end: null, text: '' },
      ],
      noteByVersion: {
        'asset:501': '上一版已增强产品特写',
      },
      pendingNote: '正在生成的新版本说明',
    }

    saveHotCopyDraft(21, draft({ videoModificationDraft }))

    expect(loadHotCopyDraft(21)?.videoModificationDraft).toEqual(videoModificationDraft)
    expect(
      JSON.parse(window.localStorage.getItem('zzh_hotcopy_draft_v1_uuser-7_ws21') || '{}').videoModificationDraft,
    ).toEqual(videoModificationDraft)
  })
})
