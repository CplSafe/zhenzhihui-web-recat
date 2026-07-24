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
