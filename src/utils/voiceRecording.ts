export const MIN_VOICE_SECONDS = 10
export const MAX_RECORDING_SECONDS = 60

export function voiceDurationError(duration: number | null, minimax: boolean): string {
  if (duration === null) return '正在读取录音时长，请稍候'
  if (!Number.isFinite(duration) || duration <= 0) return '无法读取音频时长，请重新选择音频'
  if (duration < MIN_VOICE_SECONDS)
    return `当前为 ${(Math.floor(duration * 10) / 10).toFixed(1)} 秒，请提供至少 10 秒的清晰人声音频`
  if (minimax && duration > 300) return `MiniMax 录音最长 300 秒，当前为 ${duration.toFixed(1)} 秒，请更换录音`
  return ''
}

/** 从真实采样数据编码 PCM16 WAV；录音与视频样本共用，不伪造容器类型。 */
export function encodeVoiceWav(buffer: AudioBuffer, start = 0, end = buffer.duration): Blob {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > buffer.duration || end <= start)
    throw new Error('音频片段无效，请重新录音')
  const from = Math.floor(start * buffer.sampleRate)
  const length = Math.min(buffer.length - from, Math.floor((end - start) * buffer.sampleRate))
  const bytes = new ArrayBuffer(44 + length * 2)
  const view = new DataView(bytes)
  const text = (at: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, bytes.byteLength - 8, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, length * 2, true)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  for (let index = 0; index < length; index++) {
    const value = Math.max(
      -1,
      Math.min(1, channels.reduce((sum, channel) => sum + channel[from + index], 0) / channels.length),
    )
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

export function hasAudibleVoice(buffer: AudioBuffer): boolean {
  // 基础静音检查，不宣称检测说话人身份、噪声质量或完整语音内容。
  let energy = 0
  let count = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let index = 0; index < samples.length; index += 8) {
      energy += samples[index] * samples[index]
      count++
    }
  }
  return count > 0 && Math.sqrt(energy / count) >= 0.003
}

export function recordingPermissionError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return '无法使用麦克风，请检查浏览器网站权限和系统麦克风设置，允许后重试；也可上传音频。'
  if (name === 'NotFoundError') return '未找到麦克风，请连接设备后重试，或上传音频。'
  if (name === 'NotReadableError') return '麦克风暂时不可用，请检查设备或其他应用是否占用，也可上传音频。'
  return error instanceof Error ? error.message : '录音失败，请重试或上传音频。'
}
