import { assetStreamUrl } from './assetUrl'
import { type TimelineAudioClip } from './canvasAudio'
import { demuxMp4 } from './mp4Demux'
import { muxMp4, type MuxSample, type MuxTrack } from './mp4Muxer'

/** 离线渲染只重算音频，不重新生成或重编码视频画面。 */
export async function renderAudioMix(
  clips: TimelineAudioClip[],
  duration: number,
  workspaceId: number,
  original?: ArrayBuffer,
): Promise<AudioBuffer> {
  if (!(duration > 0 && duration <= 300)) throw new Error('混音时长须在 0–300 秒以内')
  const context = new OfflineAudioContext(2, Math.ceil(duration * 48000), 48000)
  const schedule = (buffer: AudioBuffer, clip: TimelineAudioClip) => {
    if (clip.muted || clip.volume <= 0 || clip.startSec >= duration) return
    const start = clip.startSec
    const from = Math.min(buffer.duration, clip.inSec)
    const end = Math.min(buffer.duration, clip.outSec)
    const available = end - from
    if (!(available > 0)) throw new Error(`${clip.title} 的裁剪区间为空`)
    const length = clip.loop ? duration - start : Math.min(duration - start, available)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = clip.loop
    source.loopStart = from
    source.loopEnd = end
    const gain = context.createGain()
    // 淡入/淡出相交时共享中点，避免自动化事件互相覆盖。
    const fadeIn = Math.min(clip.fadeInSec, length / 2)
    const fadeOut = Math.min(clip.fadeOutSec, length / 2)
    gain.gain.setValueAtTime(fadeIn > 0 ? 0 : clip.volume, start)
    if (fadeIn > 0) gain.gain.linearRampToValueAtTime(clip.volume, start + fadeIn)
    gain.gain.setValueAtTime(clip.volume, start + length - fadeOut)
    if (fadeOut > 0) gain.gain.linearRampToValueAtTime(0, start + length)
    source.connect(gain).connect(context.destination)
    source.start(start, from, length)
  }
  if (original && demuxMp4(original).audio) {
    const buffer = await context.decodeAudioData(original.slice(0))
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.start(0)
  }
  // 顺序读取，防止同时解码多条大音频造成内存峰值。
  for (const clip of clips) {
    if (clip.muted) continue
    const response = await fetch(assetStreamUrl(clip.assetId, workspaceId), { credentials: 'include' })
    if (!response.ok) throw new Error(`${clip.title} 加载失败（HTTP ${response.status}）`)
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > 100 * 1024 * 1024) throw new Error('单条音频超过 100MB，请裁剪后导入')
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('单条音频超过 100MB，请裁剪后导入')
    const buffer = await context.decodeAudioData(bytes)
    schedule(buffer, clip)
  }
  return context.startRendering()
}

/** WAV PCM16，浏览器可直接下载；不依赖压缩编码器。 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels
  const bytes = new ArrayBuffer(44 + buffer.length * channels * 2)
  const view = new DataView(bytes)
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, bytes.byteLength - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, bytes.byteLength - 44, true)
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i))
  for (let i = 0; i < buffer.length; i++)
    for (let ch = 0; ch < channels; ch++) {
      const value = Math.max(-1, Math.min(1, data[ch][i]))
      view.setInt16(44 + (i * channels + ch) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
    }
  return new Blob([bytes], { type: 'audio/wav' })
}

function box(name: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(body.length + 8)
  new DataView(result.buffer).setUint32(0, result.length)
  Array.from(name).forEach((c, i) => (result[4 + i] = c.charCodeAt(0)))
  result.set(body, 8)
  return result
}

/** AAC 编码后与原视频样本重新封装，视频字节保持不变。 */
export async function mixAudioIntoMp4(
  video: Blob,
  clips: TimelineAudioClip[],
  duration: number,
  workspaceId: number,
): Promise<Blob> {
  const AudioEncoderCtor = (globalThis as any).AudioEncoder
  const AudioDataCtor = (globalThis as any).AudioData
  const config = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }
  if (!AudioEncoderCtor || !AudioDataCtor || !(await AudioEncoderCtor.isConfigSupported(config)).supported) {
    throw new Error('当前浏览器不支持 AAC 音频合成，请使用支持该编码的 Chromium 浏览器；仍可单独导出 WAV')
  }
  const original = await video.arrayBuffer()
  const demuxed = demuxMp4(original)
  if (!demuxed.video) throw new Error('成片没有可用的视频轨道')
  const pcm = await renderAudioMix(clips, duration, workspaceId, original)
  const samples: MuxSample[] = []
  let description: Uint8Array | null = null
  let failure: Error | null = null
  const encoder = new AudioEncoderCtor({
    output: (chunk: any, metadata: any) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      samples.push({
        data,
        dts: Math.round((chunk.timestamp * 48000) / 1e6),
        cts: Math.round((chunk.timestamp * 48000) / 1e6),
        duration: 1024,
        sync: true,
      })
      if (metadata?.decoderConfig?.description) description = new Uint8Array(metadata.decoderConfig.description)
    },
    error: (error: Error) => {
      failure = error
    },
  })
  try {
    encoder.configure(config)
    for (let offset = 0; offset < pcm.length; offset += 1024) {
      if (failure) throw failure
      const count = Math.min(1024, pcm.length - offset)
      const planes = new Float32Array(count * 2)
      planes.set(pcm.getChannelData(0).subarray(offset, offset + count))
      planes.set(pcm.getChannelData(1).subarray(offset, offset + count), count)
      const data = new AudioDataCtor({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfFrames: count,
        numberOfChannels: 2,
        timestamp: Math.round((offset / 48000) * 1e6),
        data: planes,
      })
      try {
        encoder.encode(data)
      } finally {
        data.close()
      }
      if (encoder.encodeQueueSize > 24) await encoder.flush()
    }
    await encoder.flush()
    if (failure) throw failure
    if (!description || !samples.length) throw new Error('音频编码没有返回可用结果')
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
  // ISO/IEC 14496-1 ES_Descriptor / DecoderConfigDescriptor / DecoderSpecificInfo。
  const asc = description as Uint8Array
  const descriptor = new Uint8Array([
    3,
    23 + asc.length,
    0,
    1,
    0,
    4,
    15 + asc.length,
    0x40,
    0x15,
    0,
    0,
    0,
    0,
    2,
    238,
    0,
    0,
    2,
    238,
    0,
    5,
    asc.length,
    ...asc,
    6,
    1,
    2,
  ])
  const esds = new Uint8Array(4 + descriptor.length)
  esds.set(descriptor, 4)
  const entry = new Uint8Array(28)
  const entryView = new DataView(entry.buffer)
  entryView.setUint16(6, 1)
  entryView.setUint16(16, 2)
  entryView.setUint16(18, 16)
  entryView.setUint32(24, 48000 * 65536)
  const audio: MuxTrack = {
    kind: 'audio',
    timescale: 48000,
    width: 0,
    height: 0,
    format: 'mp4a',
    sampleEntry: entry,
    decoderConfig: box('esds', esds),
    samples,
  }
  const v = demuxed.video
  return muxMp4([
    {
      kind: 'video',
      timescale: v.timescale,
      width: v.width,
      height: v.height,
      format: v.format,
      sampleEntry: v.sampleEntryBytes!,
      decoderConfig: v.decoderConfig,
      samples: v.samples.map((sample) => ({ ...sample, data: new Uint8Array(original, sample.offset, sample.size) })),
    },
    audio,
  ])
}
