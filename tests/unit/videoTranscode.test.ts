import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isBrowserTranscodeSupported, resolveTargetSpec, transcodeSegmentsToCommonSpec } from '@/utils/videoTranscode'
import type { Mp4Track } from '@/utils/mp4Demux'

/**
 * jsdom 没有 WebCodecs，这里造一套最小可用的假实现。
 *
 * 验证目标是管线本身——帧有没有被及时释放、时间轴有没有接上、背压会不会死循环——
 * 而不是编码质量，因此假编码器只记录调用，不产生真实码流。
 */

interface FakeFrame {
  timestamp: number
  duration: number
  displayWidth: number
  displayHeight: number
  codedWidth: number
  codedHeight: number
  closed: boolean
  close: () => void
}

/** 所有被造出来的解码帧，用于断言「每一帧都被 close 了」。 */
let decodedFrames: FakeFrame[] = []
/** 送进编码器的帧（画布帧），用于断言时间戳与关键帧位置。 */
let encodedInputs: Array<{ timestamp: number; keyFrame: boolean }> = []

function makeFrame(timestamp: number, duration: number): FakeFrame {
  const frame: FakeFrame = {
    timestamp,
    duration,
    displayWidth: 640,
    displayHeight: 360,
    codedWidth: 640,
    codedHeight: 360,
    closed: false,
    close() {
      frame.closed = true
    },
  }
  return frame
}

function installWebCodecsStubs(): void {
  decodedFrames = []
  encodedInputs = []

  class FakeVideoDecoder {
    state = 'unconfigured'
    decodeQueueSize = 0
    private readonly onOutput: (frame: FakeFrame) => void
    constructor(init: { output: (frame: FakeFrame) => void; error: (error: Error) => void }) {
      this.onOutput = init.output
    }
    configure() {
      this.state = 'configured'
    }
    decode(chunk: { timestamp: number; duration: number }) {
      // 真实实现是异步回调；这里同步回调即可覆盖管线逻辑，且能验证帧被立即消费
      const frame = makeFrame(chunk.timestamp, chunk.duration)
      decodedFrames.push(frame)
      this.onOutput(frame)
    }
    async flush() {}
    close() {
      this.state = 'closed'
    }
  }

  class FakeVideoEncoder {
    state = 'unconfigured'
    encodeQueueSize = 0
    private readonly onOutput: (chunk: unknown, metadata: unknown) => void
    private emitted = 0
    constructor(init: { output: (chunk: unknown, metadata: unknown) => void; error: (error: Error) => void }) {
      this.onOutput = init.output
    }
    static async isConfigSupported(config: { codec: string }) {
      return { supported: config.codec === 'avc1.640034', config }
    }
    configure() {
      this.state = 'configured'
    }
    encode(frame: { timestamp: number }, options?: { keyFrame?: boolean }) {
      encodedInputs.push({ timestamp: frame.timestamp, keyFrame: Boolean(options?.keyFrame) })
      const chunk = {
        timestamp: frame.timestamp,
        duration: 33_333,
        byteLength: 4,
        type: options?.keyFrame ? 'key' : 'delta',
        copyTo: (target: Uint8Array) => target.set([1, 2, 3, 4]),
      }
      // 只在第一块带回 decoderConfig，与真实编码器一致
      const metadata = this.emitted === 0 ? { decoderConfig: { description: new Uint8Array([1, 0x64, 0, 0x34]) } } : {}
      this.emitted += 1
      this.onOutput(chunk, metadata)
    }
    async flush() {}
    close() {
      this.state = 'closed'
    }
  }

  class FakeVideoFrame {
    timestamp: number
    duration: number
    closed = false
    constructor(_source: unknown, init: { timestamp: number; duration?: number }) {
      this.timestamp = init.timestamp
      this.duration = init.duration || 0
    }
    close() {
      this.closed = true
    }
  }

  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return { fillStyle: '', fillRect: () => {}, drawImage: () => {} }
    }
  }

  vi.stubGlobal('VideoDecoder', FakeVideoDecoder)
  vi.stubGlobal('VideoEncoder', FakeVideoEncoder)
  vi.stubGlobal(
    'EncodedVideoChunk',
    class {
      timestamp: number
      duration: number
      constructor(init: { timestamp: number; duration: number }) {
        this.timestamp = init.timestamp
        this.duration = init.duration
      }
    },
  )
  vi.stubGlobal('VideoFrame', FakeVideoFrame)
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
}

/** 构造一条最小可用的视频轨：每帧 1000 ticks（timescale 30000 → 30fps）。 */
function makeTrack(frameCount: number, width: number, height: number): Mp4Track {
  return {
    id: 1,
    kind: 'video',
    handler: 'vide',
    format: 'avc1',
    timescale: 30_000,
    duration: frameCount * 1000,
    samples: Array.from({ length: frameCount }, (_, index) => ({
      offset: index * 4,
      size: 4,
      dts: index * 1000,
      cts: index * 1000,
      duration: 1000,
      sync: index === 0,
    })),
    // 完整 avcC box：4 字节长度 + 'avcC' + 负载（版本/profile/compat/level）
    decoderConfig: new Uint8Array([0, 0, 0, 12, 0x61, 0x76, 0x63, 0x43, 1, 0x64, 0, 0x28]) as never,
    decoderConfigBox: 'avcC',
    decoderConfigHex: '',
    width,
    height,
    displayWidth: width,
    displayHeight: height,
    sampleRate: 0,
    channels: 0,
    sampleEntryBytes: new Uint8Array(78) as never,
  } as unknown as Mp4Track
}

describe('resolveTargetSpec', () => {
  it('takes the largest frame so no clip is downscaled', () => {
    expect(resolveTargetSpec([makeTrack(1, 1280, 720), makeTrack(1, 1920, 1080)])).toEqual({
      width: 1920,
      height: 1080,
    })
  })

  it('rounds odd dimensions down to even, since H.264 rejects odd sizes', () => {
    expect(resolveTargetSpec([makeTrack(1, 1921, 1081)])).toEqual({ width: 1920, height: 1080 })
  })

  it('refuses to guess when no clip declares a usable size', () => {
    expect(() => resolveTargetSpec([makeTrack(1, 0, 0)])).toThrow(/无法确定输出画幅/)
  })
})

describe('transcodeSegmentsToCommonSpec', () => {
  beforeEach(() => installWebCodecsStubs())
  afterEach(() => vi.unstubAllGlobals())

  it('reports unsupported when WebCodecs is missing', async () => {
    vi.unstubAllGlobals()
    expect(isBrowserTranscodeSupported()).toBe(false)
    await expect(
      transcodeSegmentsToCommonSpec(
        [{ buffer: new ArrayBuffer(8), track: makeTrack(1, 640, 360), startIndex: 0, endIndex: 0 }],
        {
          width: 640,
          height: 360,
        },
      ),
    ).rejects.toThrow(/不支持视频重编码/)
  })

  it('closes every decoded frame instead of accumulating them', async () => {
    // 第一版把帧攒进数组、每 12 个才处理一次，十几秒的片子就能把内存堆爆并卡死
    const track = makeTrack(40, 640, 360)
    await transcodeSegmentsToCommonSpec([{ buffer: new ArrayBuffer(160), track, startIndex: 0, endIndex: 39 }], {
      width: 640,
      height: 360,
    })

    expect(decodedFrames).toHaveLength(40)
    expect(decodedFrames.every((frame) => frame.closed)).toBe(true)
  })

  it('lays segments end to end and forces a keyframe at each segment start', async () => {
    const first = makeTrack(3, 640, 360)
    const second = makeTrack(3, 640, 360)
    const result = await transcodeSegmentsToCommonSpec(
      [
        { buffer: new ArrayBuffer(12), track: first, startIndex: 0, endIndex: 2 },
        { buffer: new ArrayBuffer(12), track: second, startIndex: 0, endIndex: 2 },
      ],
      { width: 640, height: 360 },
    )

    // 第二段接在第一段之后，而不是从 0 重新开始
    expect(encodedInputs.map((item) => item.timestamp)).toEqual([0, 33_333, 66_667, 100_000, 133_333, 166_667])
    // 每段开头都必须是关键帧，否则段与段之间无法独立解码
    expect(encodedInputs.map((item) => item.keyFrame)).toEqual([true, false, false, true, false, false])

    expect(result.samples.map((sample) => sample.dts)).toEqual([0, 3000, 6000, 9000, 12_000, 15_000])
    expect(result.timescale).toBe(90_000)
  })

  it('wraps the encoder description into a real avcC box for the muxer', async () => {
    const result = await transcodeSegmentsToCommonSpec(
      [{ buffer: new ArrayBuffer(4), track: makeTrack(1, 640, 360), startIndex: 0, endIndex: 0 }],
      { width: 640, height: 360 },
    )

    const box = result.decoderConfig
    expect(new DataView(box.buffer).getUint32(0)).toBe(box.length)
    expect(String.fromCharCode(...box.subarray(4, 8))).toBe('avcC')
    expect([...box.subarray(8)]).toEqual([1, 0x64, 0, 0x34])
  })

  it('aborts promptly when the caller cancels', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      transcodeSegmentsToCommonSpec(
        [{ buffer: new ArrayBuffer(16), track: makeTrack(4, 640, 360), startIndex: 0, endIndex: 3 }],
        { width: 640, height: 360 },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/已取消/)
  })
})
