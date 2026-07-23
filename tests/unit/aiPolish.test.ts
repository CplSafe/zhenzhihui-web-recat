import {
  createProjectNameFallback,
  generateProjectName,
  generateProjectNameFromImages,
  marketingDataToText,
  marketingFieldByKey,
  matchUploadsToSubjects,
  patchMarketingField,
  polishText,
  refineElementPrompt,
  refineElementPromptWithImage,
  refineShotPrompt,
  skillBreakdownStructured,
  suggestOptions,
  summarizeRequirement,
  validateProjectName,
  type MarketingBreakdownData,
} from '@/api/aiPolish'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runResponseText: vi.fn(),
}))

vi.mock('@/api/aiResponses', () => ({
  runResponseText: mocks.runResponseText,
}))

beforeEach(() => {
  mocks.runResponseText.mockReset()
})

describe('polishText', () => {
  it.each(['', '   ', '\n\t'])('rejects empty input without starting a paid request: %j', async (text) => {
    await expect(polishText(text)).rejects.toThrow('请输入内容后再润色')
    expect(mocks.runResponseText).not.toHaveBeenCalled()
  })

  it('passes kind, context, token and signal options to the response gateway', async () => {
    const controller = new AbortController()
    mocks.runResponseText.mockResolvedValue('润色后的台词')

    await expect(
      polishText('  原台词  ', {
        kind: 'line',
        context: '镜头一',
        maxTokens: 88,
        signal: controller.signal,
      }),
    ).resolves.toBe('润色后的台词')

    expect(mocks.runResponseText).toHaveBeenCalledWith(
      expect.objectContaining({
        user: '【上下文】镜头一\n【待润色文本】原台词',
        maxTokens: 88,
        signal: controller.signal,
      }),
    )
  })

  it('cleans storyboard markers, fenced JSON and extracts readable fields', async () => {
    mocks.runResponseText.mockResolvedValue(
      '<<<STORYBOARD_JSON>>>```json\n[{"prompt":"晨光中的产品"},{"voiceover":"现在出发"}]\n```<<<END_STORYBOARD_JSON>>>',
    )

    await expect(polishText('原文')).resolves.toBe('晨光中的产品\n现在出发')
  })

  it('removes wrapper quotes from ordinary output', async () => {
    mocks.runResponseText.mockResolvedValue('「简洁有力的字幕」')
    await expect(polishText('字幕')).resolves.toBe('简洁有力的字幕')
  })

  it('rejects an empty cleaned response and propagates network failures', async () => {
    mocks.runResponseText.mockResolvedValueOnce('  ')
    await expect(polishText('原文')).rejects.toThrow('润色结果为空')

    const networkError = new Error('network down')
    mocks.runResponseText.mockRejectedValueOnce(networkError)
    await expect(polishText('原文')).rejects.toBe(networkError)
  })
})

describe('project naming', () => {
  it('keeps the legacy string signature and cleans only the first output line', async () => {
    mocks.runResponseText.mockResolvedValue('「夏日 新品。」\n备用名称')

    await expect(generateProjectName('夏季服饰推广')).resolves.toBe('夏日新品')
    expect(mocks.runResponseText).toHaveBeenCalledTimes(1)
  })

  it('adds smart flow and duration constraints to the naming prompt', async () => {
    mocks.runResponseText.mockResolvedValue('夏日新品灵感')

    await expect(generateProjectName({ requirement: '夏季服饰推广', flow: 'smart', durationSec: 10 })).resolves.toBe(
      '夏日新品灵感',
    )

    expect(mocks.runResponseText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringMatching(/智能成片.*爆款复制.*10 秒.*命名助手/),
      }),
    )
  })

  it('rejects a cross-flow smart name without making a corrective paid request', async () => {
    mocks.runResponseText.mockResolvedValue('夏日爆款复刻计划')

    await expect(generateProjectName({ requirement: '夏季服饰推广', flow: 'smart', durationSec: 10 })).rejects.toThrow(
      '跨流程词',
    )
    expect(mocks.runResponseText).toHaveBeenCalledTimes(1)
  })

  it.each(['十一秒夏日新品', '11秒夏日新品'])(
    'rejects a mismatched duration without making another request: %s',
    async (name) => {
      mocks.runResponseText.mockResolvedValue(name)

      await expect(
        generateProjectName({ requirement: '夏季服饰推广', flow: 'smart', durationSec: 10 }),
      ).rejects.toThrow('与目标时长 10 秒不一致')
      expect(mocks.runResponseText).toHaveBeenCalledTimes(1)
    },
  )

  it('rejects “命名助手” for every flow with one gateway call', async () => {
    mocks.runResponseText.mockResolvedValue('夏日新品命名助手')

    await expect(
      generateProjectName({ requirement: '夏季服饰推广', flow: 'hot-copy', durationSec: 10 }),
    ).rejects.toThrow('不能包含“命名助手”')
    expect(mocks.runResponseText).toHaveBeenCalledTimes(1)
  })

  it('rejects empty requirement and empty model output without extra paid calls', async () => {
    await expect(generateProjectName('  ')).rejects.toThrow('请输入创作需求')
    expect(mocks.runResponseText).not.toHaveBeenCalled()

    mocks.runResponseText.mockResolvedValue('  ')
    await expect(generateProjectName('推广新品')).rejects.toThrow('生成名称为空')
  })

  it('names from filtered images, includes optional context and keeps only the first line', async () => {
    mocks.runResponseText.mockResolvedValue('《山野咖啡》\n另一个名字')

    await expect(generateProjectNameFromImages(['', 'data:image/png;base64,a'], '  户外场景  ')).resolves.toBe(
      '山野咖啡',
    )

    expect(mocks.runResponseText).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('用户补充想法:户外场景'),
        images: ['data:image/png;base64,a'],
      }),
    )
  })

  it('applies the same smart naming context to image-only naming', async () => {
    mocks.runResponseText.mockResolvedValue('十秒爆款复制助手')

    await expect(generateProjectNameFromImages(['img'], { flow: 'smart', durationSec: 10 })).rejects.toThrow('跨流程词')
    expect(mocks.runResponseText).toHaveBeenCalledTimes(1)
    expect(mocks.runResponseText).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining('当前业务是“智能成片”') }),
    )
  })

  it('does not call the gateway when no usable image exists', async () => {
    await expect(generateProjectNameFromImages(['', ''])).rejects.toThrow('请先上传素材')
    expect(mocks.runResponseText).not.toHaveBeenCalled()
  })

  it('validates restored titles and creates local fallbacks without an AI request', () => {
    expect(validateProjectName('十一秒爆款命名助手', { flow: 'smart', durationSec: 10 })).toEqual({
      valid: false,
      reason: '项目名称不能包含“命名助手”',
    })
    expect(validateProjectName('11秒夏日新品', { flow: 'smart', durationSec: 10 })).toMatchObject({
      valid: false,
      reason: expect.stringContaining('与目标时长 10 秒不一致'),
    })
    expect(validateProjectName('十秒夏日新品', { flow: 'smart', durationSec: 10 })).toEqual({ valid: true })
    expect(createProjectNameFallback('十一秒爆款命名助手', { flow: 'smart', durationSec: 10 })).toBe('智能成片项目')
    expect(createProjectNameFallback('十一秒智能成片命名助手', { flow: 'hot-copy', durationSec: 10 })).toBe(
      '爆款复制项目',
    )
    expect(createProjectNameFallback({ requirement: '十秒山野咖啡', flow: 'smart', durationSec: 10 })).toBe('山野咖啡')
    expect(mocks.runResponseText).not.toHaveBeenCalled()
  })
})

describe('matchUploadsToSubjects', () => {
  it('returns immediately for no images', async () => {
    await expect(matchUploadsToSubjects([], ['产品'])).resolves.toEqual({ products: [] })
    expect(mocks.runResponseText).not.toHaveBeenCalled()
  })

  it('parses fenced structure, bounds indexes and assigns each subject at most once', async () => {
    mocks.runResponseText.mockResolvedValue(`
      \`\`\`json
      {"products":[
        {"product":"「山野 咖啡」","kind":"食品","imageIndexes":[1,"2",2,0,9],"matches":["@咖啡杯","杯"]},
        {"product":"露营壶","kind":"器具","imageIndexes":[],"matches":["咖啡杯","露营壶"]}
      ]}
      \`\`\`
    `)

    await expect(matchUploadsToSubjects(['img-1', 'img-2'], ['咖啡杯', '露营壶'])).resolves.toEqual({
      products: [
        {
          product: '山野咖啡',
          kind: '食品',
          imageIndexes: [1, 2],
          matches: ['咖啡杯'],
        },
        {
          product: '露营壶',
          kind: '器具',
          imageIndexes: [1, 2],
          matches: ['露营壶'],
        },
      ],
    })
  })

  it.each(['invalid json', '{"products":"wrong"}', ''])(
    'returns an empty result for malformed output: %j',
    async (raw) => {
      mocks.runResponseText.mockResolvedValue(raw)
      await expect(matchUploadsToSubjects(['img'], ['产品'])).resolves.toEqual({ products: [] })
    },
  )

  it('converts network failure to an empty result', async () => {
    mocks.runResponseText.mockRejectedValue(new Error('offline'))
    await expect(matchUploadsToSubjects(['img'], ['产品'])).resolves.toEqual({ products: [] })
  })
})

describe('suggestOptions', () => {
  it('cleans, stably deduplicates and limits suggestions to five candidates', async () => {
    mocks.runResponseText.mockResolvedValue(
      '```json\n["旧款"," 新品 ","新品","轻便","耐用","轻便","通勤","防水","备用"]\n```',
    )

    await expect(suggestOptions({ label: '卖点', context: '户外背包', exclude: ['旧款'] })).resolves.toEqual([
      '新品',
      '轻便',
      '耐用',
      '通勤',
      '防水',
    ])
    expect(mocks.runResponseText).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.stringContaining('请避免与这些重复:旧款') }),
    )
  })

  it.each(['not json', '{}', '', '```json\n[broken]\n```'])(
    'returns [] for invalid suggestion output: %j',
    async (raw) => {
      mocks.runResponseText.mockResolvedValue(raw)
      await expect(suggestOptions({ label: '风格' })).resolves.toEqual([])
    },
  )

  it('converts suggestion network failures to []', async () => {
    mocks.runResponseText.mockRejectedValue(new Error('offline'))
    await expect(suggestOptions({ label: '场景' })).resolves.toEqual([])
  })
})

describe('marketing field pure functions and structured parsing', () => {
  const data: MarketingBreakdownData = {
    groups: [
      {
        label: '产品策略',
        fields: [
          { key: 'g0-f0', label: '卖点', desc: '轻便耐用', tags: ['通勤'], picked: ['防水'] },
          { key: 'g0-f1', label: '空项', desc: '', tags: [] },
        ],
      },
    ],
  }

  it('finds fields, returns undefined for misses and patches immutably', () => {
    expect(marketingFieldByKey(data, 'g0-f0')).toMatchObject({ label: '卖点' })
    expect(marketingFieldByKey(data, 'missing')).toBeUndefined()
    expect(marketingFieldByKey(null, 'g0-f0')).toBeUndefined()

    const patched = patchMarketingField(data, 'g0-f0', { desc: '新描述' })
    expect(patched).not.toBe(data)
    expect(marketingFieldByKey(patched, 'g0-f0')?.desc).toBe('新描述')
    expect(marketingFieldByKey(data, 'g0-f0')?.desc).toBe('轻便耐用')
  })

  it('renders only non-empty marketing fields and appends picked values', () => {
    expect(marketingDataToText(data)).toBe('卖点:轻便耐用、防水')
    expect(marketingDataToText({ groups: [] })).toBe('')
  })

  it('rejects empty breakdown input before a paid call', async () => {
    await expect(skillBreakdownStructured({ skill: '信息电商Skill', requirement: '', images: [] })).rejects.toThrow(
      '请先输入想法或上传素材',
    )
    expect(mocks.runResponseText).not.toHaveBeenCalled()
  })

  it('parses noisy fenced JSON, generates stable keys and deduplicates candidate tags', async () => {
    mocks.runResponseText.mockResolvedValue(`前言
      \`\`\`json
      {"groups":[
        {"label":" 产品策略 ","fields":[
          {"label":"核心卖点","hint":" 简短 ","desc":" 轻便耐用 ","tags":[" 轻便 ","轻便","防水","通勤","耐用","超额"]}
        ]},
        {"fields":[]}
      ]}
      \`\`\`
    `)

    await expect(
      skillBreakdownStructured({ skill: '未知技能', requirement: '推广背包', images: ['', 'img'] }),
    ).resolves.toEqual({
      groups: [
        {
          label: '产品策略',
          fields: [
            {
              key: 'g0-f0',
              label: '核心卖点',
              hint: '简短',
              desc: '轻便耐用',
              tags: ['轻便', '防水', '通勤', '耐用'],
            },
          ],
        },
      ],
    })
    expect(mocks.runResponseText).toHaveBeenCalledWith(expect.objectContaining({ images: ['img'] }))
  })

  it.each(['本地生活广告', '本地生活智能脚本', '本地生活Skill'])(
    'routes the current and legacy local-life labels to the local-life manual: %s',
    async (skill) => {
      mocks.runResponseText.mockResolvedValue(
        '{"groups":[{"label":"到店转化","fields":[{"label":"核销","desc":"引导用户到店核销","tags":[]}]}]}',
      )

      await skillBreakdownStructured({ skill, requirement: '推广餐厅团购' })

      expect(mocks.runResponseText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('本地生活目标是'),
        }),
      )
    },
  )

  it.each(['', 'not json', '{"groups":[]}', '{"groups":[{"fields":[]}]}'])(
    'rejects empty or malformed marketing structure: %j',
    async (raw) => {
      mocks.runResponseText.mockResolvedValue(raw)
      await expect(skillBreakdownStructured({ skill: '信息电商Skill', requirement: '推广产品' })).rejects.toThrow(
        '营销思路拆解解析失败',
      )
    },
  )
})

describe('prompt refinement', () => {
  it('returns an empty-shot diagnostic without a paid call', async () => {
    await expect(refineShotPrompt({ desc: ' ', materials: [] })).resolves.toEqual({
      prompt: '',
      debug: { note: '无可用输入' },
    })
    expect(mocks.runResponseText).not.toHaveBeenCalled()
  })

  it('cleans text-only shot output and returns debug context', async () => {
    mocks.runResponseText.mockResolvedValue('```text\n「晨光下的咖啡杯\n木桌近景」\n```')

    const result = await refineShotPrompt({ desc: '咖啡杯特写', outline: '温暖日常', ratio: '9:16' })

    expect(result.prompt).toBe('晨光下的咖啡杯,木桌近景')
    expect(result.debug.endpoint).toContain('纯文本')
    expect(mocks.runResponseText).toHaveBeenCalledWith(expect.not.objectContaining({ images: expect.anything() }))
  })

  it('uses only material URLs for multimodal shot refinement', async () => {
    mocks.runResponseText.mockResolvedValue('素材主体自然互动')

    const result = await refineShotPrompt({
      desc: '对比场景',
      materials: [{ name: '产品A', url: 'img-a' }, { name: '文字素材' }, { name: '产品B', url: 'img-b' }],
    })

    expect(result.prompt).toBe('素材主体自然互动')
    expect(mocks.runResponseText).toHaveBeenCalledWith(expect.objectContaining({ images: ['img-a', 'img-b'] }))
  })

  it('skips image refinement without an image and cleans or falls back to the original intent', async () => {
    await expect(refineElementPromptWithImage('原始意图', '')).resolves.toBe('原始意图')
    expect(mocks.runResponseText).not.toHaveBeenCalled()

    mocks.runResponseText.mockResolvedValueOnce('```text\n「真实产品\n干净背景」\n```')
    await expect(refineElementPromptWithImage('原始意图', 'img')).resolves.toBe('真实产品,干净背景')

    mocks.runResponseText.mockResolvedValueOnce('')
    await expect(refineElementPromptWithImage('原始意图', 'img')).resolves.toBe('原始意图')
  })

  it('guards empty text refinement and cleans or falls back to the original intent', async () => {
    await expect(refineElementPrompt('  ')).resolves.toBe('')
    expect(mocks.runResponseText).not.toHaveBeenCalled()

    mocks.runResponseText.mockResolvedValueOnce('「蓝色背包\n纯白背景」')
    await expect(refineElementPrompt('推广背包', { name: '背包' })).resolves.toBe('蓝色背包,纯白背景')

    mocks.runResponseText.mockResolvedValueOnce('')
    await expect(refineElementPrompt('推广背包')).resolves.toBe('推广背包')
  })
})

describe('summarizeRequirement', () => {
  it('returns immediately for empty input', async () => {
    await expect(summarizeRequirement('  ')).resolves.toBe('')
    expect(mocks.runResponseText).not.toHaveBeenCalled()
  })

  it('removes code fences and enforces the documented 100-character maximum', async () => {
    mocks.runResponseText.mockResolvedValue(`\`\`\`\n${'摘'.repeat(120)}\n\`\`\``)

    const result = await summarizeRequirement('很长的创作需求')

    expect(result).toBe('摘'.repeat(100))
    expect(result).toHaveLength(100)
  })

  it('propagates summary network errors and accepts an empty response', async () => {
    const error = new Error('offline')
    mocks.runResponseText.mockRejectedValueOnce(error)
    await expect(summarizeRequirement('需求')).rejects.toBe(error)

    mocks.runResponseText.mockResolvedValueOnce('')
    await expect(summarizeRequirement('需求')).resolves.toBe('')
  })

  it('counts Unicode characters without cutting a surrogate pair', async () => {
    mocks.runResponseText.mockResolvedValue('😀'.repeat(101))

    const result = await summarizeRequirement('表情摘要')

    expect(Array.from(result)).toHaveLength(100)
    expect(result).toBe('😀'.repeat(100))
  })
})
