/** 从真实 PCM 取各区间峰值，归一化到 0～1；静音保留为零。 */
export function sampleAudioPeaks(channels: readonly Float32Array[], count = 48): number[] {
  const size = Math.max(1, Math.min(256, Math.floor(count) || 48))
  const length = channels[0]?.length || 0
  const peaks = Array.from({ length: size }, (_, index) => {
    const start = Math.floor((index * length) / size)
    const end = Math.floor(((index + 1) * length) / size)
    let peak = 0
    for (const channel of channels) for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(channel[i] || 0))
    return peak
  })
  const maximum = Math.max(...peaks)
  return maximum > 0 ? peaks.map((peak) => peak / maximum) : peaks
}

/** 浏览器本地解码，不保存签名地址、PCM 或波形到云端草稿。 */
export async function loadAudioWaveform(src: string, signal: AbortSignal, count = 48): Promise<number[]> {
  const response = await fetch(src, { credentials: 'include', signal })
  if (!response.ok) throw new Error('音频波形加载失败')
  if (Number(response.headers.get('content-length')) > 100 * 1024 * 1024) throw new Error('音频超过 100MB')
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('音频超过 100MB')
  signal.throwIfAborted()
  const context = new OfflineAudioContext(1, 1, 48000)
  const buffer = await context.decodeAudioData(bytes)
  signal.throwIfAborted()
  return sampleAudioPeaks(
    Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)),
    count,
  )
}
