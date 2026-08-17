/**
 * 浏览器内重编码：把规格不一致的片段统一成同一套编码参数，让它们能接成一条。
 *
 * 无损拼接要求所有片段共用同一份 avcC，规格不同就只能重编码（见 videoConcat）。
 * 这里用 WebCodecs 解码 → 缩放到统一画幅 → 重新编码，产出的样本仍交给既有的 muxer 封装，
 * 因此容器层完全复用，不需要第二套 MP4 写入逻辑。
 *
 * 重编码必然有画质损失，也很吃 CPU；调用方只应在规格确实对不上时才走到这里。
 */
import type { Bytes } from '@/utils/mp4Boxes'
import type { Mp4Track } from '@/utils/mp4Demux'
import type { MuxSample } from '@/utils/mp4Muxer'

/** 输出画幅。H.264 要求宽高为偶数。 */
export interface TranscodeSpec {
  width: number
  height: number
}

/** 重编码输出的一条视频轨。 */
export interface TranscodedVideo {
  samples: MuxSample[]
  timescale: number
  /** 完整 avcC box（含 header），可直接交给 muxer。 */
  decoderConfig: Bytes
  spec: TranscodeSpec
}

export interface TranscodeSegment {
  /** 该段所属源文件的完整字节。 */
  buffer: ArrayBuffer
  track: Mp4Track
  /** 参与输出的样本下标区间（含两端），由调用方按裁剪区间算好。 */
  startIndex: number
  endIndex: number
}

export interface TranscodeOptions {
  bitrate?: number
  signal?: AbortSignal
  /** 已完成样本数 / 总样本数，供 UI 显示进度。 */
  onProgress?: (done: number, total: number) => void
}

/** 输出轨道统一使用的时间刻度；90kHz 是视频惯例，能整除常见帧率。 */
const OUTPUT_TIMESCALE = 90_000
/** 码率估算系数：像素数 × 帧率 × 该系数。 */
const DEFAULT_BITRATE_PER_PIXEL = 0.12
/**
 * 编解码队列的积压上限。
 *
 * 超过就停止喂数据，等编解码器消化。不设上限时解码会一路跑在编码前面，
 * 未压缩画面在内存里越堆越多，长片必然卡死。
 */
const QUEUE_HIGH_WATER = 6

/**
 * 让出一个宏任务。
 *
 * WebCodecs 的 output 回调排在任务队列上，`await Promise.resolve()` 这类微任务让位
 * 不会给它们任何执行机会——必须真正回到事件循环。
 */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

type WebCodecsGlobals = {
  VideoDecoder?: typeof VideoDecoder
  VideoEncoder?: typeof VideoEncoder
  EncodedVideoChunk?: typeof EncodedVideoChunk
  VideoFrame?: typeof VideoFrame
  OffscreenCanvas?: typeof OffscreenCanvas
}

/** 浏览器是否具备重编码所需的全部 WebCodecs 能力。 */
export function isBrowserTranscodeSupported(): boolean {
  const scope = globalThis as unknown as WebCodecsGlobals
  return (
    typeof scope.VideoDecoder === 'function' &&
    typeof scope.VideoEncoder === 'function' &&
    typeof scope.EncodedVideoChunk === 'function' &&
    typeof scope.VideoFrame === 'function' &&
    typeof scope.OffscreenCanvas === 'function'
  )
}

function abortError(): Error {
  const error = new Error('视频合成已取消')
  error.name = 'AbortError'
  return error
}

/**
 * 画幅取偶数：H.264 不接受奇数宽高。
 * 小于 2 的一律当作「没有有效尺寸」返回 0——不能用一个兜底值把缺失数据糊过去，
 * 否则缺尺寸的素材会静默产出一条 2×2 的成片。
 */
function toEven(value: number): number {
  const floored = Math.floor(Number(value) || 0)
  if (floored < 2) return 0
  return floored % 2 === 0 ? floored : floored - 1
}

/**
 * 选定统一画幅：取各片段中面积最大的一个。
 *
 * 不取最小值是因为缩小会永久丢掉细节；放大虽然不会新增信息，但至少保住了最好那一段的清晰度。
 * 画幅比例不同的片段在绘制时按比例居中留黑边，不做拉伸变形。
 */
export function resolveTargetSpec(tracks: readonly Mp4Track[]): TranscodeSpec {
  let best: TranscodeSpec = { width: 0, height: 0 }
  for (const track of tracks) {
    const width = toEven(track.width)
    const height = toEven(track.height)
    if (width * height > best.width * best.height) best = { width, height }
  }
  if (!(best.width > 0 && best.height > 0)) throw new Error('无法确定输出画幅：片段缺少有效的画面尺寸')
  return best
}

/** 从 avcC 字节推出 WebCodecs 的 codec 串，例如 avc1.640028。 */
function avcCodecString(avcCBox: Bytes): string {
  // 传入的是完整 box：跳过 4 字节长度 + 4 字节类型后才是 avcC 负载
  const payload = avcCBox.subarray(8)
  if (payload.length < 4) throw new Error('片段的 avcC 解码配置不完整，无法重编码')
  const hex = (value: number) => value.toString(16).padStart(2, '0')
  return `avc1.${hex(payload[1])}${hex(payload[2])}${hex(payload[3])}`
}

/** avcC 负载（WebCodecs description）→ 完整 avcC box，供 muxer 写进 stsd。 */
function wrapAvcCBox(description: Bytes): Bytes {
  const box = new Uint8Array(8 + description.length) as Bytes
  const view = new DataView(box.buffer)
  view.setUint32(0, box.length)
  box.set([0x61, 0x76, 0x63, 0x43], 4) // 'avcC'
  box.set(description, 8)
  return box
}

/** 把源画面按比例居中画进目标画幅，比例不同的部分留黑边而不是拉伸。 */
function drawContain(context: OffscreenCanvasRenderingContext2D, frame: VideoFrame, target: TranscodeSpec): void {
  const sourceWidth = frame.displayWidth || frame.codedWidth
  const sourceHeight = frame.displayHeight || frame.codedHeight
  context.fillStyle = '#000000'
  context.fillRect(0, 0, target.width, target.height)
  if (!(sourceWidth > 0 && sourceHeight > 0)) return
  const scale = Math.min(target.width / sourceWidth, target.height / sourceHeight)
  const drawWidth = Math.round(sourceWidth * scale)
  const drawHeight = Math.round(sourceHeight * scale)
  context.drawImage(
    frame,
    Math.round((target.width - drawWidth) / 2),
    Math.round((target.height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  )
}

/** 微秒 → 输出轨道刻度。 */
function usToTicks(us: number): number {
  return Math.round((us * OUTPUT_TIMESCALE) / 1_000_000)
}

/**
 * H.264 编码档次候选，按「画幅上限从宽到严」排列。
 *
 * Level 决定了允许的最大画幅：4.1 只到 1080p，4K 素材用它会直接配置失败。
 * 逐个问浏览器支持哪一个，而不是写死一个然后在运行时炸掉。
 */
const CODEC_CANDIDATES = ['avc1.640034', 'avc1.640029', 'avc1.4d4029', 'avc1.42e029'] as const

async function pickSupportedCodec(target: TranscodeSpec, bitrate: number): Promise<string> {
  for (const codec of CODEC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width: target.width,
        height: target.height,
        bitrate,
      })
      if (support.supported) return codec
    } catch {
      // 个别实现对未知 codec 串直接抛错而不是返回 supported:false，继续试下一个
    }
  }
  throw new Error(`当前浏览器无法以 ${target.width}×${target.height} 编码视频，请改用规格一致的片段`)
}

/**
 * 把多段解码后重新编码成同一套参数的一条视频轨。
 *
 * 各段在输出时间轴上首尾相接，每段开头强制关键帧。
 * 音轨不在这里处理：音频样本与视频重编码无关，调用方按原有逻辑决定保留或丢弃。
 */
export async function transcodeSegmentsToCommonSpec(
  segments: readonly TranscodeSegment[],
  target: TranscodeSpec,
  options: TranscodeOptions = {},
): Promise<TranscodedVideo> {
  if (!isBrowserTranscodeSupported()) {
    throw new Error('当前浏览器不支持视频重编码，无法合并规格不同的片段')
  }
  if (!segments.length) throw new Error('没有可重编码的片段')

  const signal = options.signal
  const ensureLive = () => {
    if (signal?.aborted) throw abortError()
  }
  ensureLive()

  const totalSamples = segments.reduce((sum, segment) => sum + (segment.endIndex - segment.startIndex + 1), 0)
  const bitrate = Math.max(
    1_000_000,
    Math.round(Number(options.bitrate) || target.width * target.height * DEFAULT_BITRATE_PER_PIXEL * 30),
  )

  const canvas = new OffscreenCanvas(target.width, target.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建重编码画布，当前浏览器可能不支持 OffscreenCanvas')

  const encoded: Array<{ data: Bytes; timestampUs: number; durationUs: number; sync: boolean }> = []
  let description: Bytes | null = null
  let encoderError: Error | null = null

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const raw = metadata?.decoderConfig?.description
      if (!description && raw) {
        // description 既可能是 ArrayBuffer 也可能是任意 TypedArray 视图，统一复制成独立字节
        const view = ArrayBuffer.isView(raw)
          ? new Uint8Array(raw.buffer as ArrayBuffer, raw.byteOffset, raw.byteLength)
          : new Uint8Array(raw as ArrayBuffer)
        description = new Uint8Array(view) as Bytes
      }
      const data = new Uint8Array(chunk.byteLength) as Bytes
      chunk.copyTo(data)
      encoded.push({
        data,
        timestampUs: chunk.timestamp,
        durationUs: Number(chunk.duration) || 0,
        sync: chunk.type === 'key',
      })
    },
    error: (error) => {
      encoderError = error instanceof Error ? error : new Error(String(error))
    },
  })
  encoder.configure({
    codec: await pickSupportedCodec(target, bitrate),
    width: target.width,
    height: target.height,
    bitrate,
    // avc 格式让 output 的 metadata 带回 avcC，muxer 才有 stsd 可写；annexb 则拿不到
    avc: { format: 'avc' },
  })

  let processed = 0
  let baseUs = 0

  try {
    for (const segment of segments) {
      ensureLive()
      const { track, buffer, startIndex, endIndex } = segment
      if (!track.decoderConfig) throw new Error('片段缺少解码配置，无法重编码')

      // 时间基点取该段第一个样本，使每段都从 0 开始，再统一平移到 baseUs
      const firstCts = track.samples[startIndex].cts
      const toUs = (ticks: number) => Math.round(((ticks - firstCts) * 1_000_000) / track.timescale)
      const sampleDurationUs = (ticks: number) => Math.max(0, Math.round((ticks * 1_000_000) / track.timescale))

      let segmentDurationUs = 0
      let isFirstFrameOfSegment = true
      let decoderError: Error | null = null

      /**
       * 解出一帧就立刻画进画布、编码、释放。
       *
       * 绝不能先攒进数组再统一处理：VideoFrame 持有的是未压缩画面，1080p 一帧数 MB，
       * 十几秒的片子攒下来就是几个 GB，标签页会直接卡死（这正是第一版卡住不动的原因）。
       */
      const decoder = new VideoDecoder({
        output: (frame) => {
          try {
            if (encoderError) return
            drawContain(context, frame, target)
            const framePts = Math.max(0, frame.timestamp)
            const outFrame = new VideoFrame(canvas, {
              timestamp: baseUs + framePts,
              duration: Number(frame.duration) || 0,
            })
            try {
              encoder.encode(outFrame, { keyFrame: isFirstFrameOfSegment })
              isFirstFrameOfSegment = false
              segmentDurationUs = Math.max(segmentDurationUs, framePts + (Number(frame.duration) || 0))
            } finally {
              outFrame.close()
            }
          } catch (error) {
            encoderError = error instanceof Error ? error : new Error(String(error))
          } finally {
            frame.close()
          }
        },
        error: (error) => {
          decoderError = error instanceof Error ? error : new Error(String(error))
        },
      })
      decoder.configure({
        codec: avcCodecString(track.decoderConfig),
        description: track.decoderConfig.subarray(8),
        codedWidth: track.width,
        codedHeight: track.height,
      })

      try {
        for (let i = startIndex; i <= endIndex; i += 1) {
          ensureLive()
          if (decoderError) throw decoderError
          if (encoderError) throw encoderError

          // 背压：任一队列积压就先让出宏任务，等编解码器把已排队的处理完。
          // 必须是宏任务——output 回调排在任务队列上，只让出微任务它永远得不到执行。
          while (decoder.decodeQueueSize > QUEUE_HIGH_WATER || encoder.encodeQueueSize > QUEUE_HIGH_WATER) {
            await nextTask()
            ensureLive()
            if (decoderError) throw decoderError
            if (encoderError) throw encoderError
          }

          const sample = track.samples[i]
          decoder.decode(
            new EncodedVideoChunk({
              type: sample.sync ? 'key' : 'delta',
              timestamp: toUs(sample.cts),
              duration: sampleDurationUs(sample.duration),
              data: new Uint8Array(buffer, sample.offset, sample.size),
            }),
          )
          processed += 1
          options.onProgress?.(processed, totalSamples)
        }
        await decoder.flush()
      } finally {
        if (decoder.state !== 'closed') decoder.close()
      }
      if (decoderError) throw decoderError
      if (encoderError) throw encoderError

      // 末帧没有下一帧可推算时长，用源片最后一个样本的时长兜底，避免整段少一帧
      if (segmentDurationUs <= 0) {
        segmentDurationUs = toUs(track.samples[endIndex].cts) + sampleDurationUs(track.samples[endIndex].duration)
      }
      baseUs += segmentDurationUs
    }

    await encoder.flush()
    if (encoderError) throw encoderError
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }

  if (!encoded.length) throw new Error('重编码后没有产出任何画面')
  if (!description) throw new Error('重编码未返回解码配置，无法封装成 MP4')

  // 编码器按显示顺序输出（avc format 下无 B 帧重排），dts 与 cts 一致
  encoded.sort((left, right) => left.timestampUs - right.timestampUs)
  const samples: MuxSample[] = encoded.map((chunk, index) => {
    const next = encoded[index + 1]
    const durationUs = next ? next.timestampUs - chunk.timestampUs : chunk.durationUs || 0
    const ticks = usToTicks(chunk.timestampUs)
    return {
      data: chunk.data,
      dts: ticks,
      cts: ticks,
      duration: Math.max(1, usToTicks(durationUs)),
      sync: chunk.sync,
    }
  })

  return {
    samples,
    timescale: OUTPUT_TIMESCALE,
    decoderConfig: wrapAvcCBox(description),
    spec: target,
  }
}
