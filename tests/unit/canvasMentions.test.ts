import { describe, expect, it } from 'vitest'
import {
  buildMentionLabels,
  buildMentionRegex,
  buildPositionalMentionLabels,
  diffMentionLabels,
  findMentionDeletionRange,
  rewriteMentions,
  translateMentionsToPositional,
} from '@/utils/canvasMentions'

const img = (edgeId: string, title?: string) => ({ edgeId, kind: 'image', ...(title ? { title } : {}) })
const vid = (edgeId: string, title?: string) => ({ edgeId, kind: 'video', ...(title ? { title } : {}) })

describe('buildMentionLabels', () => {
  it('没改名的用位置号，按类型独立编号；文本来源不参与', () => {
    const labels = buildMentionLabels([img('a'), { edgeId: 't', kind: 'text' }, vid('v'), img('b')])
    expect(labels.get('a')).toBe('图片1')
    expect(labels.get('b')).toBe('图片2')
    expect(labels.get('v')).toBe('视频1')
    expect(labels.has('t')).toBe(false)
  })

  it('重命名过的用名字，多参考时才分得清谁是谁', () => {
    const labels = buildMentionLabels([img('a', '天安门'), img('b'), img('c', '故宫')])
    expect(labels.get('a')).toBe('天安门')
    expect(labels.get('b')).toBe('图片2') // 位置号仍按整体顺序算，不因 a 改名而变成图片1
    expect(labels.get('c')).toBe('故宫')
  })

  it('名字重复时按出现顺序加后缀，保证每条唯一', () => {
    const labels = buildMentionLabels([img('a', '产品'), img('b', '产品'), img('c', '产品')])
    expect(labels.get('a')).toBe('产品(1)')
    expect(labels.get('b')).toBe('产品(2)')
    expect(labels.get('c')).toBe('产品(3)')
  })

  it('名字恰好撞上某个位置号时同样加后缀，避免 @图片2 指不清', () => {
    const labels = buildMentionLabels([img('a', '图片2'), img('b')])
    expect(labels.get('a')).toBe('图片2(1)')
    expect(labels.get('b')).toBe('图片2')
  })

  it('位置号标签只按类型编号', () => {
    const positional = buildPositionalMentionLabels([img('a', '天安门'), vid('v'), img('b')])
    expect(positional.get('a')).toBe('图片1')
    expect(positional.get('b')).toBe('图片2')
    expect(positional.get('v')).toBe('视频1')
  })
})

describe('rewriteMentions', () => {
  it('单趟替换，删掉图片1 后 3→2、2→1 不会级联成 1', () => {
    const mapping = new Map([
      ['图片1', ''],
      ['图片2', '图片1'],
      ['图片3', '图片2'],
    ])
    expect(rewriteMentions('把 @图片1 放进 @图片2，再叠 @图片3', mapping)).toBe('把  放进 @图片1，再叠 @图片2')
  })

  it('重命名：把旧名整体换成新名', () => {
    expect(rewriteMentions('保留 @天安门 的主体', new Map([['天安门', '故宫']]))).toBe('保留 @故宫 的主体')
  })

  it('最长优先：名字互为前缀时不会误切', () => {
    const mapping = new Map([
      ['产品', 'A'],
      ['产品(2)', 'B'],
    ])
    expect(rewriteMentions('@产品(2) 和 @产品', mapping)).toBe('@B 和 @A')
  })

  it('没有需要改的就原样返回', () => {
    expect(rewriteMentions('原文 @图片1', new Map([['图片1', '图片1']]))).toBe('原文 @图片1')
  })
})

describe('translateMentionsToPositional', () => {
  it('提交前把名字翻成模型认得的位置号，位置号原样保留', () => {
    const refs = [img('a', '天安门'), img('b'), img('c', '故宫')]
    expect(translateMentionsToPositional('把 @天安门 的产品放进 @图片2，参考 @故宫', refs)).toBe(
      '把 @图片1 的产品放进 @图片2，参考 @图片3',
    )
  })

  it('带后缀的重名同样翻对', () => {
    const refs = [img('a', '产品'), img('b', '产品')]
    expect(translateMentionsToPositional('@产品(2) 放到 @产品(1) 旁', refs)).toBe('@图片2 放到 @图片1 旁')
  })

  it('匹配不到的 @xxx 不硬猜，原样留下', () => {
    expect(translateMentionsToPositional('@不存在 和 @图片1', [img('a')])).toBe('@不存在 和 @图片1')
  })
})

describe('diffMentionLabels', () => {
  it('重命名 → 旧名映到新名', () => {
    const prev = new Map([['a', '天安门']])
    const next = new Map([['a', '故宫']])
    expect(diffMentionLabels(prev, next)).toEqual(new Map([['天安门', '故宫']]))
  })

  it('参考被删 → 映到空串（删掉引用），其后位置号前移也一并给出', () => {
    const prev = new Map([
      ['a', '图片1'],
      ['b', '图片2'],
    ])
    const next = new Map([['b', '图片1']])
    expect(diffMentionLabels(prev, next)).toEqual(
      new Map([
        ['图片1', ''],
        ['图片2', '图片1'],
      ]),
    )
  })
})

describe('buildMentionRegex', () => {
  it('按标签精确命中，带空格/标点的名字也行，并兜底位置号', () => {
    const re = buildMentionRegex(['天安门 城楼', '产品(1)'])
    const text = '@天安门 城楼 和 @产品(1)，还有残留的 @图片3'
    expect(text.match(re)).toEqual(['@天安门 城楼', '@产品(1)', '@图片3'])
  })
})

describe('findMentionDeletionRange：@引用整体删除', () => {
  const re = buildMentionRegex(['天安门', '图片2'])
  const text = '把 @天安门 放进 @图片2 的场景'
  // '把 ' = 0..2，'@天安门' = 2..6，空格 6，'放进 ' 7..10，'@图片2' = 10..14，空格 14

  it('Backspace 在引用末尾（含其后空格之后）或引用内部：删整条引用及后面的空格', () => {
    expect(findMentionDeletionRange(text, 7, 'backward', re)).toEqual({ start: 2, end: 7 })
    expect(findMentionDeletionRange(text, 6, 'backward', re)).toEqual({ start: 2, end: 7 })
    expect(findMentionDeletionRange(text, 4, 'backward', re)).toEqual({ start: 2, end: 7 })
    expect(findMentionDeletionRange(text, 15, 'backward', re)).toEqual({ start: 10, end: 15 })
  })

  it('Delete 在引用开头或内部同样删整条；在引用后面则不处理', () => {
    expect(findMentionDeletionRange(text, 2, 'forward', re)).toEqual({ start: 2, end: 7 })
    expect(findMentionDeletionRange(text, 12, 'forward', re)).toEqual({ start: 10, end: 15 })
    expect(findMentionDeletionRange(text, 7, 'forward', re)).toBeNull()
  })

  it('光标没碰到引用：交回浏览器按字符删', () => {
    expect(findMentionDeletionRange(text, 2, 'backward', re)).toBeNull()
    expect(findMentionDeletionRange(text, 9, 'backward', re)).toBeNull()
    expect(findMentionDeletionRange('', 0, 'backward', re)).toBeNull()
  })

  it('引用后面没有空格时只删引用本身', () => {
    expect(findMentionDeletionRange('看 @天安门', 6, 'backward', re)).toEqual({ start: 2, end: 6 })
  })
})
