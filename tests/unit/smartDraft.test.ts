import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSmartSnapshot,
  canPersistSmartProjectDraft,
  clearSmartDraftsForUser,
  computeVideoContentSig,
  loadSmartDraft,
  mergeCompletedVideoGenerationIds,
  parseSmartSnapshot,
  saveSmartDraft,
  setSmartDraftUserScope,
  setSmartDraftWorkspaceScope,
  type SmartDraft,
} from '@/utils/smartDraft'

describe('smart project draft write guard', () => {
  it('blocks the empty mount and hydration window from overwriting a project', () => {
    expect(canPersistSmartProjectDraft({ applied: false, started: true, projectId: 170, workspaceId: 61 })).toBe(false)
    expect(canPersistSmartProjectDraft({ applied: true, started: false, projectId: 170, workspaceId: 61 })).toBe(false)
  })

  it('allows a bound project only after creation has actually started', () => {
    expect(canPersistSmartProjectDraft({ applied: true, started: true, projectId: 170, workspaceId: 61 })).toBe(true)
    expect(canPersistSmartProjectDraft({ applied: true, started: true, projectId: 0, workspaceId: 61 })).toBe(false)
    expect(canPersistSmartProjectDraft({ applied: true, started: true, projectId: 170, workspaceId: 0 })).toBe(false)
  })
})

describe('mergeCompletedVideoGenerationIds', () => {
  it('merges scalar and array sources, trims IDs, deduplicates, and ignores empty values', () => {
    expect(
      mergeCompletedVideoGenerationIds('gen-1', [' gen-2 ', '', 'gen-1'], undefined, null, ['   ', 'gen-3', null, 42]),
    ).toEqual(['gen-1', 'gen-2', 'gen-3'])
  })

  it('keeps only the most recent 50 IDs when the merged history exceeds the limit', () => {
    const ids = Array.from({ length: 55 }, (_, index) => `gen-${index + 1}`)

    const merged = mergeCompletedVideoGenerationIds(ids.slice(0, 25), ...ids.slice(25))

    expect(merged).toHaveLength(50)
    expect(merged).toEqual(ids.slice(-50))
  })
})

describe('smartDraft 本地持久化', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setSmartDraftUserScope('')
    setSmartDraftWorkspaceScope(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    setSmartDraftUserScope('')
    setSmartDraftWorkspaceScope(0)
  })

  it('按账户和工作空间隔离草稿', () => {
    setSmartDraftUserScope(101)
    saveSmartDraft({ requirement: '用户 101 / 空间 11', projectId: 1 }, 11)
    saveSmartDraft({ requirement: '用户 101 / 空间 12', projectId: 2 }, 12)

    setSmartDraftUserScope(202)
    saveSmartDraft({ requirement: '用户 202 / 空间 11', projectId: 3 }, 11)

    expect(loadSmartDraft(11)).toMatchObject({ requirement: '用户 202 / 空间 11', projectId: 3, workspaceId: 11 })
    expect(loadSmartDraft(12)).toBeNull()

    setSmartDraftUserScope(101)
    expect(loadSmartDraft(11)).toMatchObject({ requirement: '用户 101 / 空间 11', projectId: 1, workspaceId: 11 })
    expect(loadSmartDraft(12)).toMatchObject({ requirement: '用户 101 / 空间 12', projectId: 2, workspaceId: 12 })
  })

  it('保留流式脚本中断状态，避免刷新后把部分分镜显示为完整脚本', () => {
    setSmartDraftUserScope(101)
    saveSmartDraft(
      {
        started: true,
        projectId: 8,
        shots: [{ id: 1, no: '镜头1', desc: '已收到的部分结果', subjects: [] }],
        scriptError: '脚本生成中断，已保留 1 个分镜',
      },
      21,
    )

    expect(loadSmartDraft(21)).toMatchObject({
      projectId: 8,
      scriptError: '脚本生成中断，已保留 1 个分镜',
    })
  })

  it('使用当前工作空间作用域，并在保存时剥离不可恢复的临时媒体', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T08:00:00.000Z'))
    setSmartDraftUserScope(101)
    setSmartDraftWorkspaceScope(21)

    saveSmartDraft({
      entryMeta: {
        images: ['https://cdn.example.com/entry.png', 'blob:entry', 'data:image/png;base64,entry'],
      },
      shots: [
        {
          id: 'shot-1',
          image: 'blob:shot',
          imageVersions: [
            'data:image/png;base64,old',
            {
              url: 'https://cdn.example.com/shot.png',
              assetId: 31,
              refs: ['blob:ref', 'https://cdn.example.com/ref.png'],
            },
          ],
          subjects: [{ image: 'data:image/png;base64,subject', refImage: 'blob:subject-ref' }],
          extraRefs: [{ url: 'blob:extra' }, { url: 'https://cdn.example.com/extra.png' }],
          selectedRefs: ['data:image/png;base64,selected', 'https://cdn.example.com/selected.png'],
        },
      ],
      fullVideoUrl: 'https://cdn.example.com/result.mp4',
      videoVersions: [
        { url: 'blob:old-video', assetId: 40 },
        { url: 'https://cdn.example.com/result.mp4', assetId: 41 },
      ],
      imageMessages: [
        {
          role: 'assistant',
          status: 'pending',
          images: [{ url: 'blob:pending', assetId: 51 }],
        },
        {
          id: 'image-task-52',
          role: 'assistant',
          status: 'pending',
          taskId: 752,
          idempotencyKey: 'image-task-key-52',
          operationCode: 'image.image_to_image',
          request: {
            text: '夏日海报',
            ratio: '1:1',
            refAssetIds: [61],
            refImages: [{ url: 'data:image/png;base64,reference', assetId: 61 }],
          },
        },
      ],
    })

    const restored = loadSmartDraft()

    expect(restored).toMatchObject({
      workspaceId: 21,
      savedAt: Date.parse('2026-07-16T08:00:00.000Z'),
      fullVideoUrl: 'https://cdn.example.com/result.mp4',
    })
    expect(restored?.entryMeta.images).toEqual(['https://cdn.example.com/entry.png'])
    expect(restored?.shots?.[0]).toMatchObject({
      image: '',
      imageVersions: [
        {
          url: '/api/v1/assets/31/download?workspace_id=21',
          assetId: 31,
          refs: ['https://cdn.example.com/ref.png'],
        },
      ],
      subjects: [{ image: '', refImage: '' }],
      extraRefs: [{ url: 'https://cdn.example.com/extra.png' }],
      selectedRefs: ['https://cdn.example.com/selected.png'],
    })
    expect(restored?.videoVersions).toEqual([
      { url: '/api/v1/assets/40/download?workspace_id=21', assetId: 40 },
      { url: '/api/v1/assets/41/download?workspace_id=21', assetId: 41 },
    ])
    expect(restored?.imageMessages).toEqual([
      {
        role: 'assistant',
        status: 'error',
        error: '生成已中断,请重试',
        images: [{ url: '/api/v1/assets/51/download?workspace_id=21', assetId: 51 }],
      },
      {
        id: 'image-task-52',
        role: 'assistant',
        status: 'pending',
        taskId: 752,
        idempotencyKey: 'image-task-key-52',
        operationCode: 'image.image_to_image',
        request: {
          text: '夏日海报',
          ratio: '1:1',
          refAssetIds: [61],
          refImages: [{ url: '/api/v1/assets/61/download?workspace_id=21', assetId: 61 }],
        },
        images: undefined,
      },
    ])
  })

  it('刷新恢复时只保留生成中的记录和对应排队任务', () => {
    setSmartDraftUserScope(101)
    const draft: SmartDraft = {
      videoGenerations: [
        { id: 'gen-running-1', status: 'processing', taskId: 701, idempotencyKey: 'idem-1' },
        { id: 'gen-running-2', status: 'processing', taskId: Number.NaN, idempotency_key: 'idem-2' } as any,
        { id: 'gen-failed', status: 'failed', taskId: 702 },
        { id: 'gen-published', status: 'published', taskId: 0 },
      ],
      videoGenQueue: [
        { id: 'gen-running-1', idempotencyKey: 'idem-1' },
        { id: 'gen-running-2', idempotencyKey: 'idem-2' },
        { id: 'gen-failed', idempotencyKey: 'idem-failed' },
        { id: 'orphan', idempotencyKey: 'idem-orphan' },
      ],
    }

    saveSmartDraft(draft, 11)
    const restored = loadSmartDraft(11)

    expect(restored?.videoGenerations).toHaveLength(2)
    expect(restored?.videoGenerations).toEqual([
      expect.objectContaining({ id: 'gen-running-1', status: 'processing', taskId: 701, idempotencyKey: 'idem-1' }),
      expect.objectContaining({ id: 'gen-running-2', status: 'processing', taskId: 0, idempotencyKey: 'idem-2' }),
    ])
    expect(restored?.videoGenQueue?.map((job) => job.id)).toEqual(['gen-running-1', 'gen-running-2'])
  })

  it('preserves unsubmitted children in a confirmed multi-image queue and the image composer draft', () => {
    setSmartDraftUserScope(101)
    saveSmartDraft(
      {
        started: true,
        projectId: 303,
        imageMessages: [
          { id: 'user-batch', role: 'user', text: '生成三张海报' },
          {
            id: 'child-2',
            role: 'assistant',
            status: 'pending',
            taskId: 0,
            batchId: 'batch-1',
            batchIndex: 1,
            batchTotal: 3,
            idempotencyKey: 'batch-1-02',
            request: { text: '生成三张海报', ratio: '16:9', refAssetIds: [], refImages: [] },
          },
        ],
        imageComposerDraft: {
          text: '把背景改成夜景',
          ratio: '1:1',
          outputCount: 3,
          images: [{ url: 'blob:expired', assetId: 731 }],
        },
      },
      21,
    )

    const restored = loadSmartDraft(21)
    expect(restored?.imageMessages?.[1]).toMatchObject({
      id: 'child-2',
      status: 'pending',
      taskId: 0,
      batchId: 'batch-1',
      idempotencyKey: 'batch-1-02',
    })
    expect(restored?.imageComposerDraft).toEqual({
      text: '把背景改成夜景',
      ratio: '1:1',
      outputCount: 3,
      images: [{ url: '/api/v1/assets/731/download?workspace_id=21', assetId: 731 }],
    })
  })

  it('登出清理当前用户的所有工作空间，但保留其他账号草稿', () => {
    setSmartDraftUserScope('user-a')
    saveSmartDraft({ requirement: '用户 A / 21' }, 21)
    saveSmartDraft({ requirement: '用户 A / 22' }, 22)
    setSmartDraftUserScope('user-b')
    saveSmartDraft({ requirement: '用户 B / 21' }, 21)

    clearSmartDraftsForUser('user-a')

    setSmartDraftUserScope('user-a')
    expect(loadSmartDraft(21)).toBeNull()
    expect(loadSmartDraft(22)).toBeNull()
    setSmartDraftUserScope('user-b')
    expect(loadSmartDraft(21)?.requirement).toBe('用户 B / 21')
  })

  it('清理用户时精确匹配作用域，不误删包含该用户名前缀的账号', () => {
    setSmartDraftUserScope('a')
    saveSmartDraft({ requirement: '用户 a' }, 21)
    setSmartDraftUserScope('a_ws7')
    saveSmartDraft({ requirement: '用户 a_ws7' }, 21)

    clearSmartDraftsForUser('a')

    setSmartDraftUserScope('a')
    expect(loadSmartDraft(21)).toBeNull()
    setSmartDraftUserScope('a_ws7')
    expect(loadSmartDraft(21)?.requirement).toBe('用户 a_ws7')
  })

  it('清除供应商预签名凭证，并保留 assetId 对应的同源持久引用', () => {
    setSmartDraftUserScope(101)
    const signedUrl = 'https://bucket.example.com/private.png?X-Amz-Credential=secret&X-Amz-Signature=provider-secret'

    saveSmartDraft(
      {
        entryMeta: { images: [signedUrl], imageAssetIds: [71] },
        shots: [
          {
            image: signedUrl,
            imageAssetId: 72,
            imageVersions: [{ url: signedUrl, assetId: 73 }],
            subjects: [{ image: signedUrl, assetId: 74, refImage: signedUrl, refAssetId: 75 }],
            extraRefs: [{ url: signedUrl, assetId: 76 }],
          },
        ],
        fullVideoUrl: signedUrl,
        fullVideoAssetId: 81,
        videoVersions: [
          { url: signedUrl, assetId: 82 },
          { url: `${signedUrl}&orphan=1`, assetId: 0 },
        ],
        imageMessages: [{ role: 'assistant', images: [{ url: signedUrl, assetId: 83 }] }],
      },
      21,
    )

    const raw = window.localStorage.getItem('smart_create_draft_v1_u101_ws21') || ''
    expect(raw).not.toContain('provider-secret')
    expect(raw).not.toContain('X-Amz-Credential')

    const restored = loadSmartDraft(21)
    expect(restored?.entryMeta).toMatchObject({
      images: ['/api/v1/assets/71/download?workspace_id=21'],
      imageAssetIds: [71],
    })
    expect(restored?.shots?.[0]).toMatchObject({
      image: '/api/v1/assets/72/download?workspace_id=21',
      imageVersions: [{ url: '/api/v1/assets/73/download?workspace_id=21', assetId: 73 }],
      subjects: [
        {
          image: '/api/v1/assets/74/download?workspace_id=21',
          refImage: '/api/v1/assets/75/download?workspace_id=21',
        },
      ],
      extraRefs: [{ url: '/api/v1/assets/76/download?workspace_id=21', assetId: 76 }],
    })
    expect(restored?.fullVideoUrl).toBe('/api/v1/assets/81/download?workspace_id=21')
    expect(restored?.videoVersions).toEqual([{ url: '/api/v1/assets/82/download?workspace_id=21', assetId: 82 }])
    expect(restored?.imageMessages?.[0].images).toEqual([
      { url: '/api/v1/assets/83/download?workspace_id=21', assetId: 83 },
    ])
  })

  it('只迁移工作空间归属明确的旧版用户草稿', () => {
    setSmartDraftUserScope(101)
    window.localStorage.setItem(
      'smart_create_draft_v1_u101',
      JSON.stringify({ workspaceId: 21, requirement: 'legacy workspace 21' }),
    )

    expect(loadSmartDraft(22)).toBeNull()
    expect(loadSmartDraft(21)?.requirement).toBe('legacy workspace 21')
    expect(window.localStorage.getItem('smart_create_draft_v1_u101')).toBeNull()
    expect(window.localStorage.getItem('smart_create_draft_v1_u101_ws21')).not.toBeNull()
  })
})

describe('smartDraft 后端快照', () => {
  afterEach(() => vi.useRealTimers())

  it('构建项目管理字段并可从 JSON 字符串精确恢复原生草稿', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T09:30:00.000Z'))
    const draft: SmartDraft = {
      projectName: '夏日饮品短片',
      requirement: '生成一条饮品广告',
      reqSummary: '清凉、明快',
      step: 2,
      entryMeta: { duration: '10s', ratio: '16:9', style: '写实' },
      shots: [
        {
          id: 'shot-1',
          image: 'https://cdn.example.com/cover.png?signature=temporary',
          imageAssetId: 61,
          imageVersions: [
            { url: 'https://cdn.example.com/cover-v1.png', assetId: 60 },
            { url: 'data:image/png;base64,temporary', assetId: 0 },
          ],
          duration: '5s',
          line: '畅饮一夏',
        },
      ],
      fullVideoUrl: 'https://cdn.example.com/result.mp4',
      fullVideoAssetId: 81,
      videoVersions: [{ url: 'https://cdn.example.com/result.mp4', assetId: 81, createdAt: '2026-07-16T09:00:00Z' }],
      vidGenTaskId: 901,
      videoGenerations: [{ id: 'gen-running', status: 'processing', taskId: 901 }],
    }

    const snapshot = buildSmartSnapshot(draft, 21)

    expect(snapshot).toMatchObject({
      flow: 'smart',
      title: '夏日饮品短片',
      currentStep: 'storyboard',
      description: '生成一条饮品广告',
      reqSummary: '清凉、明快',
      selectedDuration: '10s',
      selectedRatio: '16:9',
      selectedStyles: ['写实'],
      generatedVideoUrl: '/api/v1/assets/81/download?workspace_id=21',
      generatedVideoAssetId: 81,
      storyboardItems: [
        {
          id: 'shot-1',
          index: 0,
          currentImage: { url: '/api/v1/assets/61/download?workspace_id=21' },
          versionHistory: [{ url: '/api/v1/assets/60/download?workspace_id=21', assetId: 60 }],
        },
      ],
      videoHistoryList: [
        { url: '/api/v1/assets/81/download?workspace_id=21', assetId: 81, createdAt: '2026-07-16T09:00:00Z' },
      ],
    })
    expect(snapshot.smart.savedAt).toBe(Date.parse('2026-07-16T09:30:00.000Z'))

    const restored = parseSmartSnapshot(JSON.stringify(snapshot))
    expect(restored).toMatchObject({
      projectName: '夏日饮品短片',
      vidGenTaskId: 901,
      fullVideoAssetId: 81,
      videoGenerations: [{ id: 'gen-running', status: 'processing', taskId: 901 }],
    })
    expect(restored?.shots?.[0].imageVersions).toEqual([
      { url: '/api/v1/assets/60/download?workspace_id=21', assetId: 60 },
    ])
  })

  it('maps all four UI steps to distinct backend step codes', () => {
    expect(buildSmartSnapshot({ step: 0 }).currentStep).toBe('script')
    expect(buildSmartSnapshot({ step: 1 }).currentStep).toBe('material')
    expect(buildSmartSnapshot({ step: 2 }).currentStep).toBe('storyboard')
    expect(buildSmartSnapshot({ step: 3 }).currentStep).toBe('video')
  })

  it.each([
    ['不是 JSON', null],
    [null, null],
    [{ flow: 'hot-copy', smart: { projectName: '不应恢复' } }, null],
    [{ flow: 'smart' }, null],
  ])('拒绝无效或其他流程的快照 %#', (input, expected) => {
    expect(parseSmartSnapshot(input)).toBe(expected)
  })

  it('内容签名忽略临时签名参数、首尾空白和未参与成片的分镜', () => {
    const first = computeVideoContentSig(
      [
        { id: 'shot-1', image: 'https://cdn.example.com/shot.png?signature=old', duration: '5s', line: '台词' },
        { id: 'excluded', imageAssetId: 999, includeInVideo: false },
      ],
      { ratio: '16:9', style: '写实' },
      '  夏日饮品  ',
    )
    const second = computeVideoContentSig(
      [{ id: 'shot-1', image: 'https://cdn.example.com/shot.png?signature=new', duration: '5s', line: '台词' }],
      { ratio: '16:9', style: '写实' },
      '夏日饮品',
    )

    expect(first).toBe(second)
  })
})
