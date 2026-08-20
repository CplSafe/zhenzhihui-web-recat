import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SHOT_SEC,
  MAX_SHOT_COUNT,
  MAX_SHOT_SEC,
  MIN_SHOT_SEC,
  appendStudioShot,
  clampShotSec,
  createDefaultStudioShots,
  createStudioShot,
  fromScriptShots,
  moveStudioShot,
  removeStudioShot,
  totalStudioShotSec,
  updateStudioShot,
  validateStudioShots,
} from '@/utils/studioShots'

describe('clampShotSec', () => {
  it('收敛到合法区间并取整', () => {
    expect(clampShotSec(0)).toBe(MIN_SHOT_SEC)
    expect(clampShotSec(999)).toBe(MAX_SHOT_SEC)
    expect(clampShotSec(3.4)).toBe(3)
  })

  it('非法输入回落到最小值而不是 NaN', () => {
    expect(clampShotSec('abc')).toBe(MIN_SHOT_SEC)
    expect(clampShotSec(undefined)).toBe(MIN_SHOT_SEC)
  })
})

describe('createDefaultStudioShots', () => {
  it('默认分镜总时长等于目标时长', () => {
    // Arrange & Act
    const shots = createDefaultStudioShots(5)

    // Assert
    expect(shots.length).toBeGreaterThanOrEqual(2)
    expect(totalStudioShotSec(shots)).toBe(5)
  })

  it('长片按上限截断镜头数，且不产生 0 秒镜头', () => {
    const shots = createDefaultStudioShots(120)
    expect(shots.length).toBeLessThanOrEqual(MAX_SHOT_COUNT)
    expect(shots.every((shot) => shot.dur >= MIN_SHOT_SEC)).toBe(true)
  })
})

describe('分镜增删改序', () => {
  it('updateStudioShot 返回新数组且不修改原数组', () => {
    // Arrange
    const shots = [createStudioShot(3, 'a'), createStudioShot(3, 'b')]
    const snapshot = shots.map((shot) => ({ ...shot }))

    // Act
    const next = updateStudioShot(shots, shots[0].id, { desc: '改过了' })

    // Assert
    expect(next).not.toBe(shots)
    expect(next[0].desc).toBe('改过了')
    expect(shots).toEqual(snapshot)
  })

  it('updateStudioShot 写入时长时同样收敛区间', () => {
    const shots = [createStudioShot(3)]
    expect(updateStudioShot(shots, shots[0].id, { dur: 99 })[0].dur).toBe(MAX_SHOT_SEC)
  })

  it('appendStudioShot 到达上限后不再新增', () => {
    let shots = createDefaultStudioShots(DEFAULT_SHOT_SEC * 2)
    while (shots.length < MAX_SHOT_COUNT) shots = appendStudioShot(shots)
    expect(appendStudioShot(shots)).toHaveLength(MAX_SHOT_COUNT)
  })

  it('removeStudioShot 不允许删空最后一个镜头', () => {
    const shots = [createStudioShot(3)]
    expect(removeStudioShot(shots, shots[0].id)).toHaveLength(1)
  })

  it('moveStudioShot 按拖拽结果重排', () => {
    const shots = [createStudioShot(1, 'a'), createStudioShot(2, 'b'), createStudioShot(3, 'c')]
    const moved = moveStudioShot(shots, 0, 2)
    expect(moved.map((shot) => shot.desc)).toEqual(['b', 'c', 'a'])
  })

  it('moveStudioShot 越界索引原样返回', () => {
    const shots = [createStudioShot(1, 'a'), createStudioShot(2, 'b')]
    expect(moveStudioShot(shots, 0, 9).map((shot) => shot.desc)).toEqual(['a', 'b'])
  })
})

describe('fromScriptShots', () => {
  it('解析脚本时长字符串并保留旁白/字幕/音效', () => {
    // Arrange
    const scriptShots = [
      { duration: '5s', desc: '女主推门进入咖啡馆', voiceover: '那天下午', subtitle: '午后', sfx: '风铃声' },
    ]

    // Act
    const [shot] = fromScriptShots(scriptShots)

    // Assert
    expect(shot.dur).toBe(5)
    expect(shot.desc).toBe('女主推门进入咖啡馆')
    expect(shot.line).toBe('那天下午')
    expect(shot.subtitle).toBe('午后')
    expect(shot.sfx).toBe('风铃声')
  })

  it('丢弃没有画面描述的镜头', () => {
    expect(
      fromScriptShots([
        { duration: '3s', desc: '   ' },
        { duration: '3s', desc: '有效镜头' },
      ]),
    ).toHaveLength(1)
  })

  it('超过上限的脚本按 MAX_SHOT_COUNT 截断', () => {
    const many = Array.from({ length: MAX_SHOT_COUNT + 5 }, (_, i) => ({ duration: '2s', desc: `镜头${i}` }))
    expect(fromScriptShots(many)).toHaveLength(MAX_SHOT_COUNT)
  })
})

describe('validateStudioShots', () => {
  it('空描述的镜头阻塞提交', () => {
    const shots = [createStudioShot(3, '有描述'), createStudioShot(3, '')]
    expect(validateStudioShots(shots)).toBe('每个镜头都需要填写画面描述')
  })

  it('全部合法时返回空串', () => {
    expect(validateStudioShots([createStudioShot(3, '一个镜头')])).toBe('')
  })

  it('空列表阻塞提交', () => {
    expect(validateStudioShots([])).toBe('请至少添加一个镜头')
  })
})
