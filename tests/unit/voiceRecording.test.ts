import { describe, expect, it } from 'vitest'
import { encodeVoiceWav, hasAudibleVoice, recordingPermissionError, voiceDurationError } from '@/utils/voiceRecording'

describe('训练录音校验与编码', () => {
  it('各供应商最少10秒，MiniMax继续限制300秒，未知时长不可提交', () => {
    expect(voiceDurationError(null, false)).toContain('正在读取')
    expect(voiceDurationError(Infinity, true)).toContain('无法读取')
    expect(voiceDurationError(9.99, false)).toContain('至少 10 秒')
    expect(voiceDurationError(10, true)).toBe('')
    expect(voiceDurationError(300, true)).toBe('')
    expect(voiceDurationError(300.1, true)).toContain('最长 300 秒')
    expect(voiceDurationError(301, false)).toBe('')
  })
  it('编码真实单声道PCM16数据并检测静音', async () => {
    const channels = [new Float32Array([0.5, -0.5, 0.2, -0.2]), new Float32Array([0.5, -0.5, 0.2, -0.2])]
    const buffer = {
      duration: 1,
      sampleRate: 4,
      length: 4,
      numberOfChannels: 2,
      getChannelData: (index: number) => channels[index],
    } as AudioBuffer
    const blob = encodeVoiceWav(buffer)
    const bytes = new DataView(await blob.arrayBuffer())
    expect(blob.type).toBe('audio/wav')
    expect(bytes.getUint16(22, true)).toBe(1)
    expect(bytes.getUint16(34, true)).toBe(16)
    expect(bytes.getUint32(40, true)).toBe(8)
    expect(bytes.getInt16(44, true)).toBe(16384)
    expect(bytes.getInt16(46, true)).toBe(-16384)
    expect(hasAudibleVoice(buffer)).toBe(true)
    channels.forEach((channel) => channel.fill(0))
    expect(hasAudibleVoice(buffer)).toBe(false)
    expect(() => encodeVoiceWav(buffer, 1, 0)).toThrow('无效')
  })
  it('区分授权拒绝、设备缺失和设备不可用', () => {
    expect(recordingPermissionError(new DOMException('', 'NotAllowedError'))).toContain('网站权限')
    expect(recordingPermissionError(new DOMException('', 'NotFoundError'))).toContain('未找到')
    expect(recordingPermissionError(new DOMException('', 'NotReadableError'))).toContain('暂时不可用')
    expect(recordingPermissionError(new Error('解码失败'))).toBe('解码失败')
  })
})
