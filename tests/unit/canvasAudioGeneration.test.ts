import { describe, expect, it } from 'vitest'
import { getAudioGenerationLabel, getModelAudioGenerationLabel } from '@/utils/canvasAudioGeneration'

describe('音频生成操作范围', () => {
  it('按真实目录的输出类型识别新增生成操作，同时排除语音识别', () => {
    expect(getModelAudioGenerationLabel({ result_schema: { output_types: ['audio'] } }, 'audio.text_to_speech')).toBe(
      '文字配音',
    )
    expect(
      getModelAudioGenerationLabel({ result_schema: { output_types: ['text'] } }, 'audio.speech_to_text'),
    ).toBeUndefined()
    expect(getModelAudioGenerationLabel({ result_schema: { output_types: ['text'] } }, 'audio.tts')).toBeUndefined()
    expect(getModelAudioGenerationLabel({ resultSchema: { outputTypes: ['audio'] } }, 'audio.tts')).toBe('配音')
    expect(getModelAudioGenerationLabel({}, null)).toBeUndefined()
    expect(getModelAudioGenerationLabel({}, 'image.generate')).toBeUndefined()
    expect(getModelAudioGenerationLabel({}, 'audio.tts')).toBe('配音')
  })
  it.each([
    ['audio.tts', '配音'],
    ['audio.clone', '音色克隆'],
    ['audio.music', '背景音乐'],
    ['audio.generate', '音频生成'],
  ])('允许 %s 并展示实际用途', (code, label) => {
    expect(getAudioGenerationLabel(code)).toBe(label)
  })
  it.each([
    'audio.asr',
    'audio.transcribe',
    'audio.transcription',
    'audio.speech_to_text',
    'audio.analysis',
    'audio.unknown',
    'responses.multimodal',
    '__proto__',
    null,
    {},
  ])('拒绝非生成操作 %s', (code) => {
    expect(getAudioGenerationLabel(code)).toBeUndefined()
  })
})
