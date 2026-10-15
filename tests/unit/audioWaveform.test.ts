import { describe, expect, it } from 'vitest'
import { sampleAudioPeaks } from '@/utils/audioWaveform'

describe('真实音频波形', () => {
  it('保留静音并对多声道区间峰值归一化', () => {
    expect(sampleAudioPeaks([new Float32Array([0, 0, 0, 0])], 2)).toEqual([0, 0])
    expect(sampleAudioPeaks([new Float32Array([0.2, -0.4, 0.1, 0.2]), new Float32Array([0, 0, -0.8, 0])], 2)).toEqual([
      0.5, 1,
    ])
  })
  it('空音频返回静音占位而不生成伪随机波形', () => {
    expect(sampleAudioPeaks([], 3)).toEqual([0, 0, 0])
  })
})
