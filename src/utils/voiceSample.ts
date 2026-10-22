import { encodeVoiceWav } from './voiceRecording'
import { demuxMp4 } from './mp4Demux'
import { muxMp4 } from './mp4Muxer'
import { readBoxes } from './mp4Boxes'

export const MAX_VOICE_SAMPLE_BYTES = 100 * 1024 * 1024

export function isVoiceVideoFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.(mp4|mov|m4v)$/i.test(file.name) || ['video/mp4', 'video/quicktime'].includes(file.type)
}

export function validateVoiceSampleRange(duration: number, start: number, end: number): string {
  if (![duration, start, end].every(Number.isFinite) || start < 0 || end > duration || end <= start)
    return '请选择有效的声音片段'
  if (end - start < 5 || end - start > 30) return '声音样本需为 5～30 秒'
  return ''
}

/** 先剥离视频轨，再交给浏览器解码，避免直接解码视频容器的兼容性差异。 */
export async function decodeVoiceVideo(file: File, signal: AbortSignal): Promise<AudioBuffer> {
  if (!isVoiceVideoFile(file)) throw new Error('目前支持 MP4、MOV 视频，请先转换格式')
  if (file.size > MAX_VOICE_SAMPLE_BYTES) throw new Error('视频不能超过 100MB')
  signal.throwIfAborted()
  const bytes = await file.arrayBuffer()
  signal.throwIfAborted()
  if (readBoxes(new DataView(bytes), 0, bytes.byteLength).some((box) => box.type === 'moof'))
    throw new Error('暂不支持分片视频，请转换为普通 MP4')
  const parsed = demuxMp4(bytes)
  if (parsed.error) throw new Error('视频容器无法解析，请使用普通 MP4/MOV；暂不支持分片视频')
  const track = parsed.audio
  if (!track?.samples.length || !track.sampleEntryBytes) throw new Error('视频中没有可提取的音轨')
  if (!(track.timescale > 0) || track.duration / track.timescale > 300)
    throw new Error('本地提取仅支持 5 分钟内视频，请先截短再上传')
  const audio = muxMp4([
    {
      kind: 'audio',
      timescale: track.timescale,
      width: 0,
      height: 0,
      format: track.format,
      sampleEntry: track.sampleEntryBytes,
      decoderConfig: track.decoderConfig,
      samples: track.samples.map((sample) => ({
        data: new Uint8Array(bytes, sample.offset, sample.size),
        dts: sample.dts,
        cts: sample.cts,
        duration: sample.duration,
        sync: sample.sync,
      })),
    },
  ])
  const context = new OfflineAudioContext(1, 1, 24000)
  let buffer: AudioBuffer
  try {
    buffer = await context.decodeAudioData(await audio.arrayBuffer())
  } catch {
    throw new Error('浏览器无法解码此视频的声音，请转换为 AAC 音轨的 MP4 或直接上传音频')
  }
  signal.throwIfAborted()
  if (!Number.isFinite(buffer.duration) || buffer.duration < 5)
    throw new Error('视频音轨不足 5 秒，请选择更长的声音样本')
  return buffer
}

/** 单声道 PCM16 WAV；不修改源视频，也不训练音色。 */
export function voiceSampleWav(buffer: AudioBuffer, start: number, end: number): Blob {
  const error = validateVoiceSampleRange(buffer.duration, start, end)
  if (error) throw new Error(error)
  return encodeVoiceWav(buffer, start, end)
}
