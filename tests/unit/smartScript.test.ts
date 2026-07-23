import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Shot } from '@/components/smart/ScriptStoryboardTable'

const mocks = vi.hoisted(() => ({
  runResponseText: vi.fn(),
  streamResponseText: vi.fn(),
}))

vi.mock('@/api/aiResponses', () => mocks)

import { extractSubjects, generateScriptShotsStream, generateShotInfo, mergeSingleUseSubjects } from '@/api/smartScript'

const rawShot = (desc: string, duration = '1s') => ({
  duration,
  desc,
  voiceover: `${desc}旁白`,
  subtitle: `${desc}字幕`,
  sfx: `${desc}音效`,
  subjects: [{ name: `${desc}产品`, kind: '产品' }],
})

const shot = (id: number, subjects: Shot['subjects']): Shot => ({
  id,
  no: `镜头${id}`,
  duration: '5s',
  desc: `画面${id}`,
  subjects,
})

describe('smart script generation', () => {
  beforeEach(() => {
    mocks.runResponseText.mockReset()
    mocks.streamResponseText.mockReset()
  })

  it('rejects an empty request before starting a paid AI operation', async () => {
    await expect(generateScriptShotsStream({ requirement: '   ' }, vi.fn())).rejects.toThrow('请至少输入文案或上传图片')
    expect(mocks.streamResponseText).not.toHaveBeenCalled()
  })

  it('allows an image-only request and caps uploaded references at six', async () => {
    mocks.streamResponseText.mockResolvedValue(JSON.stringify({ shots: [rawShot('产品')] }))
    const images = Array.from({ length: 8 }, (_, index) => `/image-${index}.png`)

    const result = await generateScriptShotsStream({ requirement: ' ', images, duration: '5' }, vi.fn())

    expect(result).toHaveLength(1)
    expect(mocks.streamResponseText).toHaveBeenCalledWith(expect.objectContaining({ images: images.slice(0, 6) }))
  })

  it('emits complete incremental shots once per changed snapshot', async () => {
    const one = JSON.stringify({ shots: [rawShot('开场', '3s')] })
    const two = JSON.stringify({ shots: [rawShot('开场', '3s'), rawShot('收尾', '7s')] })
    mocks.streamResponseText.mockImplementation(async (args) => {
      args.onDelta?.(one, one)
      args.onDelta?.('', one)
      args.onDelta?.(two, two)
      return two
    })
    const onShots = vi.fn()

    const result = await generateScriptShotsStream({ requirement: '广告', duration: '10' }, onShots)

    expect(onShots).toHaveBeenCalledTimes(2)
    expect(onShots.mock.calls.map(([items]) => items.length)).toEqual([1, 2])
    expect(result.map((item) => item.duration)).toEqual(['3s', '7s'])
  })

  it('enforces shot-count and duration boundaries for a ten-second script', async () => {
    const shots = ['A', 'B', 'C', 'D', 'E'].map((desc) => rawShot(desc))
    mocks.streamResponseText.mockResolvedValue(`\`\`\`json\n${JSON.stringify({ shots })}\n\`\`\``)

    const result = await generateScriptShotsStream({ requirement: '广告', duration: '10s' }, vi.fn())

    expect(result.map((item) => item.desc)).toEqual(['A', 'B', 'C', 'E'])
    expect(result.map((item) => item.duration)).toEqual(['3s', '2s', '2s', '3s'])
    expect(result.map((item) => item.no)).toEqual(['镜头1', '镜头2', '镜头3', '镜头4'])
  })

  it.each([1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15])(
    'normalizes generated shots to an exact %s-second total',
    async (duration) => {
      const shots = ['A', 'B', 'C', 'D', 'E', 'F'].map((desc) => rawShot(desc, '2.2s'))
      mocks.streamResponseText.mockResolvedValue(JSON.stringify({ shots }))

      const result = await generateScriptShotsStream({ requirement: '广告', duration: `${duration}s` }, vi.fn())
      const total = result.reduce(
        (sum, item) => sum + Number.parseFloat(String(item.duration).replace(/[^0-9.]/g, '')),
        0,
      )

      expect(total).toBe(duration)
      expect(result.length).toBeLessThanOrEqual(duration)
    },
  )

  it('drops placeholder fields, empty shots and text-only subjects', async () => {
    mocks.streamResponseText.mockResolvedValue(
      JSON.stringify({
        shots: [
          {
            duration: '5s',
            desc: '画面描述',
            voiceover: '真实旁白',
            subtitle: '字幕',
            sfx: '音效',
            subjects: [
              { name: '护肤仪', kind: '产品' },
              { name: '促销字幕', kind: '文字' },
            ],
          },
          { duration: '5s', desc: '', voiceover: '', subtitle: '', sfx: '', subjects: [] },
        ],
      }),
    )

    const result = await generateScriptShotsStream({ requirement: '广告', duration: '5' }, vi.fn())

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ desc: '', line: '真实旁白', subjects: [{ tag: '@护肤仪', kind: '产品' }] })
  })

  it('fails clearly when the model output contains no usable shot', async () => {
    mocks.streamResponseText.mockResolvedValue('not-json')
    await expect(generateScriptShotsStream({ requirement: '广告' }, vi.fn())).rejects.toThrow('未能解析分镜脚本,请重试')
  })
})

describe('single-shot generation and subject normalization', () => {
  beforeEach(() => {
    mocks.runResponseText.mockReset()
    mocks.streamResponseText.mockReset()
  })

  it('parses a fenced single-shot response and filters text subjects', async () => {
    mocks.runResponseText.mockResolvedValue(
      `\`\`\`json\n${JSON.stringify({
        shots: [
          {
            duration: '4s',
            desc: '产品特写',
            voiceover: '立即体验',
            subtitle: '新品',
            sfx: '轻快音乐',
            subjects: [
              { name: '精华液瓶', kind: '产品' },
              { name: '广告文案', kind: '文字' },
            ],
          },
        ],
      })}\n\`\`\``,
    )
    const images = Array.from({ length: 7 }, (_, index) => `/ref-${index}.png`)

    const result = await generateShotInfo({
      shots: [],
      targetIndex: 99,
      mode: 'insert',
      intent: '增加产品特写',
      images,
    })

    expect(result).toEqual({
      duration: '4s',
      desc: '产品特写',
      line: '立即体验',
      subtitle: '新品',
      sfx: '轻快音乐',
      subjects: [{ tag: '@精华液瓶', kind: '产品' }],
    })
    expect(mocks.runResponseText).toHaveBeenCalledWith(
      expect.objectContaining({ images: images.slice(0, 6), maxTokens: 1500 }),
    )
  })

  it('returns safe editable defaults for malformed single-shot output', async () => {
    mocks.runResponseText.mockResolvedValue('not-json')
    await expect(generateShotInfo({ shots: [], targetIndex: 0, mode: 'insert', intent: '' })).resolves.toEqual({
      duration: '5s',
      desc: '',
      line: '',
      subtitle: '',
      sfx: '',
      subjects: [],
    })
  })

  it('extracts concrete visual subjects and fails closed on model errors', async () => {
    mocks.runResponseText.mockResolvedValue(
      JSON.stringify({
        subjects: [
          { name: '年轻女性', kind: '人物' },
          { name: '素材1', kind: '物体' },
          { name: '宣传字幕', kind: '文字' },
          { name: '', kind: '场景' },
        ],
      }),
    )
    await expect(extractSubjects('女性手持产品')).resolves.toEqual([{ tag: '@年轻女性', kind: '人物' }])

    mocks.runResponseText.mockRejectedValue(new Error('network'))
    await expect(extractSubjects('女性手持产品')).resolves.toEqual([])
    await expect(extractSubjects('  ')).resolves.toEqual([])
  })

  it('merges only single-use unbound subjects and keeps shared or uploaded subjects', async () => {
    mocks.runResponseText.mockResolvedValue('在台灯下看书的学生')
    const input = [
      shot(1, [
        { tag: '@学生', kind: '人物' },
        { tag: '@台灯', kind: '物体' },
        { tag: '@课本', kind: '物体' },
        { tag: '@校徽', kind: '物体', image: '/badge.png' },
      ]),
      shot(2, [
        { tag: '@学生', kind: '人物' },
        { tag: '@操场', kind: '场景' },
      ]),
    ]

    const result = await mergeSingleUseSubjects(input)

    expect(result[0].subjects).toEqual([
      { tag: '@学生', kind: '人物' },
      { tag: '@校徽', kind: '物体', image: '/badge.png' },
      { tag: '@在台灯下看书的学生', kind: '场景' },
    ])
    expect(result[1]).toBe(input[1])
    expect(mocks.runResponseText).toHaveBeenCalledOnce()
  })

  it('uses a deterministic merge name when AI naming fails', async () => {
    mocks.runResponseText.mockRejectedValue(new Error('network'))
    const input = [
      shot(1, [
        { tag: '@台灯', kind: '物体' },
        { tag: '@课本', kind: '物体' },
      ]),
    ]

    const result = await mergeSingleUseSubjects(input)

    expect(result[0].subjects).toEqual([{ tag: '@台灯的课本', kind: '场景' }])
  })
})
