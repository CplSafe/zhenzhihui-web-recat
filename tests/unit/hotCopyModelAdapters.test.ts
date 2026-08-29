import { describe, expect, it } from 'vitest'
import { buildHotCopyReplicateModelParams } from '@/utils/hotCopyModelAdapters'

describe('buildHotCopyReplicateModelParams', () => {
  it('restores the proven standard fallback for Seedance without a usable schema', () => {
    expect(
      buildHotCopyReplicateModelParams(
        {
          display_name: 'Seedance 2.0',
          params_schema: { fields: [] },
        },
        { durationSec: 10, ratio: '16:9', sourceVideoDurationSec: 12 },
      ),
    ).toEqual({
      duration: 10,
      resolution: '720p',
      ratio: '16:9',
      generate_audio: true,
    })
  })

  it('keeps the Seedance audio fallback when its schema omits the audio field', () => {
    expect(
      buildHotCopyReplicateModelParams(
        {
          display_name: 'Seedance 2.0',
          params_schema: {
            fields: [
              { name: 'duration' },
              { name: 'ratio' },
              { name: 'resolution' },
              { name: 'source_video_duration' },
            ],
          },
        },
        { durationSec: 8, ratio: '9:16', sourceVideoDurationSec: 11.5 },
      ),
    ).toEqual({
      duration: 8,
      ratio: '9:16',
      resolution: '720p',
      source_video_duration: 11.5,
      generate_audio: true,
    })
  })

  it('使用用户选择的分辨率，未选择时才回退历史默认 720p', () => {
    const model = {
      display_name: 'Seedance 2.0',
      params_schema: {
        fields: [{ name: 'duration' }, { name: 'ratio' }, { name: 'resolution', options: ['720p', '1080p'] }],
      },
    }

    expect(
      buildHotCopyReplicateModelParams(model, { durationSec: 8, ratio: '9:16', resolution: '1080p' }),
    ).toMatchObject({ resolution: '1080p' })
    expect(buildHotCopyReplicateModelParams(model, { durationSec: 8, ratio: '9:16' })).toMatchObject({
      resolution: '720p',
    })
    // 无 schema 的旧 Seedance 记录同样沿用所选分辨率。
    expect(
      buildHotCopyReplicateModelParams(
        { display_name: 'Seedance 2.0', params_schema: { fields: [] } },
        { durationSec: 10, ratio: '16:9', resolution: '1080p' },
      ),
    ).toMatchObject({ resolution: '1080p' })
  })

  /**
   * 线上「爆款视频做同款」的 display_name / model 都不含 seedance 版本号，
   * 分类落在 'other' 分支；只要后端 schema 声明了 generate_audio 就必须下发，
   * 否则服务端 taskBody 会把缺失兜底成 false，做同款永远没有背景音。
   */
  it('下发做同款模型 schema 声明的 generate_audio', () => {
    expect(
      buildHotCopyReplicateModelParams(
        {
          display_name: '爆款视频做同款',
          model: 'seedance-replicate',
          provider: 'replicate',
          params_schema: {
            fields: [
              { name: 'duration' },
              { name: 'resolution', options: ['480p', '720p'] },
              { name: 'ratio', options: ['16:9', '9:16', '1:1'] },
              { name: 'generate_audio', type: 'boolean' },
            ],
          },
        },
        { durationSec: 10, ratio: '9:16', resolution: '720p' },
      ),
    ).toEqual({
      duration: 10,
      resolution: '720p',
      ratio: '9:16',
      generate_audio: true,
    })
  })

  it('does not leak the Seedance audio fallback into a reference-video model', () => {
    expect(
      buildHotCopyReplicateModelParams(
        {
          display_name: 'HappyHorse参考生视频',
          provider: 'HappyHorse',
          capability: '参考生视频',
          params_schema: {
            fields: [{ name: 'duration' }, { name: 'ratio' }],
          },
        },
        { durationSec: 6, ratio: '16:9', sourceVideoDurationSec: 9 },
      ),
    ).toEqual({
      duration: 6,
      ratio: '16:9',
    })
  })
})
