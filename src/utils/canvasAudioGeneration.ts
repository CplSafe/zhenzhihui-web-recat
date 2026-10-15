/** 音频节点只支持产生音频的操作，不能将识别、转写或分析操作送入生成任务。 */
const AUDIO_GENERATION_LABELS: Readonly<Record<string, string>> = {
  'audio.tts': '配音',
  'audio.clone': '音色克隆',
  'audio.music': '背景音乐',
  'audio.generate': '音频生成',
}

export type AudioGenerationMode = 'voice' | 'music' | 'effect' | 'clone' | 'other'

export function getAudioGenerationMode(operationCode: string): AudioGenerationMode {
  if (/clone/i.test(operationCode)) return 'clone'
  if (/music/i.test(operationCode)) return 'music'
  if (/sound_effect|sfx/i.test(operationCode)) return 'effect'
  if (/tts|text_to_speech|speech_synthesis/i.test(operationCode)) return 'voice'
  return 'other'
}

export const AUDIO_GENERATION_MODE_LABELS: Record<AudioGenerationMode, string> = {
  voice: '文字配音',
  music: '背景音乐',
  effect: '音效',
  clone: '音色克隆',
  other: '音频生成',
}

export function getAudioGenerationLabel(operationCode: unknown): string | undefined {
  return typeof operationCode === 'string' &&
    Object.prototype.hasOwnProperty.call(AUDIO_GENERATION_LABELS, operationCode)
    ? AUDIO_GENERATION_LABELS[operationCode]
    : undefined
}

/** 优先按目录声明的产物识别能力，兼容后端新增的生成操作码。 */
export function getModelAudioGenerationLabel(model: Record<string, any>, operationCode: unknown): string | undefined {
  if (typeof operationCode !== 'string' || !operationCode.startsWith('audio.')) return undefined
  if (/speech_to_text|transcri|(?:^|[._])asr(?:$|[._])|recognition|analysis/.test(operationCode)) return undefined
  const schema = model.result_schema ?? model.resultSchema
  const outputTypes = schema?.output_types ?? schema?.outputTypes
  if (Array.isArray(outputTypes)) {
    if (!outputTypes.includes('audio')) return undefined
    return getAudioGenerationLabel(operationCode) || AUDIO_GENERATION_MODE_LABELS[getAudioGenerationMode(operationCode)]
  }
  return getAudioGenerationLabel(operationCode)
}
