import { describe, expect, it } from 'vitest'

import {
  MAX_REF_VIDEOS,
  getRefVideoRejectReason,
  resolveRefVideoLimits,
  totalRefVideoSec,
  validateRefVideos,
} from '@/utils/studioRefVideo'

/** 构造一条参考视频（file 字段测试里用不到，给个占位）。 */
function video(durationSec: number, id = `v-${durationSec}`) {
  return { id, url: 'blob:x', durationSec, file: null as any }
}

/** 模拟后端 params_schema 里声明了 source_video_duration 的模型。 */
function modelWithSourceDuration(min: number, max: number) {
  return {
    params_schema: {
      fields: [{ name: 'source_video_duration', type: 'number', min, max }],
    },
  }
}

describe('resolveRefVideoLimits', () => {
  it('时长上限读自模型声明的 source_video_duration', () => {
    const limits = resolveRefVideoLimits(modelWithSourceDuration(3, 10))
    expect(limits.minDurationSec).toBe(3)
    expect(limits.maxDurationSec).toBe(10)
  })

  it('模型未声明时长时返回 null，前端不替模型编造上限', () => {
    // 「模型没说」必须与「模型说了正好是 N」区分开。
    expect(resolveRefVideoLimits({}).maxDurationSec).toBeNull()
    expect(resolveRefVideoLimits(undefined).maxDurationSec).toBeNull()
  })

  it('条数上限与模型无关，由 provider 侧硬约束决定', () => {
    expect(resolveRefVideoLimits({}).maxCount).toBe(MAX_REF_VIDEOS)
  })
})

describe('totalRefVideoSec', () => {
  it('累加各条时长，非法值按 0 处理', () => {
    expect(totalRefVideoSec([video(5), video(7)])).toBe(12)
    expect(totalRefVideoSec([{ id: 'a', url: '', durationSec: NaN, file: null as any }])).toBe(0)
  })
})

describe('getRefVideoRejectReason', () => {
  const limits = resolveRefVideoLimits(modelWithSourceDuration(3, 10))

  it('条数已满时拒绝', () => {
    expect(getRefVideoRejectReason([video(1), video(2), video(3)], 1, limits)).toContain('最多支持 3 个')
  })

  it('单条超时长上限时拒绝', () => {
    expect(getRefVideoRejectReason([], 20, limits)).toContain('最长 10s')
  })

  it('单条低于时长下限时拒绝', () => {
    expect(getRefVideoRejectReason([], 1, limits)).toContain('最短 3s')
  })

  it('多条累加不再受总时长限制（后端按单条校验）', () => {
    // 每条都合法即可，不因为累计 15s 就拒绝。
    expect(getRefVideoRejectReason([video(8)], 8, limits)).toBe('')
  })

  it('模型未声明时长时不做时长拦截', () => {
    const loose = resolveRefVideoLimits({})
    expect(getRefVideoRejectReason([], 999, loose)).toBe('')
  })
})

describe('validateRefVideos', () => {
  const limits = resolveRefVideoLimits(modelWithSourceDuration(3, 10))

  it('存在超长视频时阻塞提交', () => {
    expect(validateRefVideos([video(5), video(30)], limits)).toContain('最长 10s')
  })

  it('时长元数据缺失（为 0）时不拦截，交后端最终校验', () => {
    expect(validateRefVideos([video(0), video(0)], limits)).toBe('')
  })

  it('全部合法时返回空串', () => {
    expect(validateRefVideos([video(5), video(9)], limits)).toBe('')
  })

  it('超出条数上限时阻塞', () => {
    expect(validateRefVideos([video(3), video(3), video(3), video(3)], limits)).toContain('最多支持 3 个')
  })
})
