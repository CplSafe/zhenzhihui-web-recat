/**
 * 检测视频里的硬切（镜头切换）。
 *
 * 视频生成模型只能产出一段连续影像，没有「剪辑」概念；拿多镜头拼接片做爆款复刻的参考，
 * 模型只能从中提炼一个概念再自己编一个单镜头，结果必然对不上。所以在源视频选中时
 * 就数一数它有几次硬切，超过阈值提前告诉用户，而不是让他花积分之后才发现。
 *
 * 方法：按固定间隔抽帧，算粗粒度 RGB 直方图，相邻两帧的相关性骤降即视为一次切换。
 * 直方图比逐像素差分更耐运镜——镜头平移时颜色分布几乎不变，硬切时整体分布突变。
 */
import { acquireSeekableSource } from '@/utils/seekableMediaSource'
import { seekVideoToDecodedFrame } from '@/utils/videoFrameCapture'

/** 每个颜色通道分成几档；8 档 = 512 桶，足以区分场景又不至于被噪点带偏。 */
const BINS_PER_CHANNEL = 8
/** 抽帧用的小画布尺寸；只算颜色分布，不需要细节。 */
const SAMPLE_WIDTH = 48
const SAMPLE_HEIGHT = 48
/** 默认抽帧间隔与总样本上限：24 秒视频约 48 帧，几秒内跑完。 */
const DEFAULT_STEP_SEC = 0.5
const MAX_SAMPLES = 80
/** 相邻样本相关性距离超过它算硬切；实测真实切换 0.54~1.0，运镜/缓变通常 < 0.4。 */
const DEFAULT_CUT_THRESHOLD = 0.55
/** 两次切换之间的最小间隔，避免一次转场被算成多次。 */
const MIN_CUT_GAP_SEC = 0.8
const DETECT_TIMEOUT_MS = 20000

/** 把 RGBA 像素归一成 512 桶直方图（各桶之和为 1）。 */
export function rgbHistogram(pixels: Uint8ClampedArray | number[]): number[] {
  const bins = BINS_PER_CHANNEL
  const hist = new Array<number>(bins * bins * bins).fill(0)
  const shift = 8 - Math.log2(bins)
  let count = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i] >> shift
    const g = pixels[i + 1] >> shift
    const b = pixels[i + 2] >> shift
    hist[(r * bins + g) * bins + b] += 1
    count += 1
  }
  if (count > 0) for (let i = 0; i < hist.length; i += 1) hist[i] /= count
  return hist
}

/** 两个直方图的相关性距离：0 = 完全一致，1 = 无相关，>1 = 负相关。 */
export function histogramDistance(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  if (!n) return 0
  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i += 1) {
    meanA += a[i]
    meanB += b[i]
  }
  meanA /= n
  meanB /= n
  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  const denom = Math.sqrt(varA * varB)
  if (denom === 0) return 0
  return 1 - cov / denom
}

/** 由一串按时间排序的（时刻, 直方图）样本数出硬切位置（秒）。 */
export function findSceneCuts(
  samples: readonly { timeSec: number; histogram: readonly number[] }[],
  options: { threshold?: number; minGapSec?: number } = {},
): number[] {
  const threshold = options.threshold ?? DEFAULT_CUT_THRESHOLD
  const minGap = options.minGapSec ?? MIN_CUT_GAP_SEC
  const cuts: number[] = []
  for (let i = 1; i < samples.length; i += 1) {
    const distance = histogramDistance(samples[i - 1].histogram, samples[i].histogram)
    if (distance < threshold) continue
    const at = samples[i].timeSec
    if (cuts.length && at - cuts[cuts.length - 1] < minGap) continue
    cuts.push(at)
  }
  return cuts
}

/** 抽帧时刻：从半个步长开始均匀取样，样本数受上限约束。 */
export function sceneSampleTimes(durationSec: number, stepSec = DEFAULT_STEP_SEC, maxSamples = MAX_SAMPLES): number[] {
  const duration = Number(durationSec) || 0
  if (duration <= 0) return []
  const step = Math.max(stepSec, duration / maxSamples)
  const times: number[] = []
  for (let t = step / 2; t < duration; t += step) times.push(t)
  return times
}

export interface SceneCutResult {
  /** 检测到的硬切时刻（秒）。 */
  cuts: number[]
  /** 实际抽了多少帧；0 表示没能分析。 */
  sampled: number
  durationSec: number
}

function loadMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve()
      return
    }
    let timer = 0
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
    }
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('视频加载失败'))
    }
    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('error', onError)
    timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('视频加载超时'))
    }, timeoutMs)
  })
}

/**
 * 检测一条视频的硬切。任何一步失败都返回 sampled=0，调用方按「无法分析」处理而不是报错——
 * 这只是个提前提醒，不能阻断用户上传。
 */
export async function detectSceneCuts(url: string, options: { signal?: AbortSignal } = {}): Promise<SceneCutResult> {
  const source = String(url || '').trim()
  const empty: SceneCutResult = { cuts: [], sampled: 0, durationSec: 0 }
  if (!source || typeof document === 'undefined') return empty

  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_WIDTH
  canvas.height = SAMPLE_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return empty

  const handle = acquireSeekableSource(source)
  try {
    const { url: seekable } = await handle.ready
    video.src = seekable
    await loadMetadata(video, DETECT_TIMEOUT_MS)
    const duration = Number(video.duration) || 0
    const times = sceneSampleTimes(duration)
    if (!times.length) return { ...empty, durationSec: duration }
    const samples: { timeSec: number; histogram: number[] }[] = []
    for (const timeSec of times) {
      if (options.signal?.aborted) return { ...empty, durationSec: duration }
      await seekVideoToDecodedFrame(video, timeSec, { seekTimeoutMs: 4000, frameTimeoutMs: 1500 })
      context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
      const pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data
      samples.push({ timeSec, histogram: rgbHistogram(pixels) })
    }
    return { cuts: findSceneCuts(samples), sampled: samples.length, durationSec: duration }
  } catch {
    return empty
  } finally {
    video.removeAttribute('src')
    video.load()
    handle.release()
  }
}

/** 硬切数量达到多少就值得提醒：1 次可能只是开头/结尾的片头，2 次以上基本就是拼接片。 */
export const SCENE_CUT_WARN_THRESHOLD = 2

/** 给爆款复刻入口的提示文案；不需要提醒时返回空串。 */
export function describeSceneCutWarning(result: SceneCutResult | null | undefined): string {
  if (!result || result.sampled === 0) return ''
  const cuts = result.cuts.length
  if (cuts < SCENE_CUT_WARN_THRESHOLD) return ''
  return `源视频含约 ${cuts} 次镜头切换（${cuts + 1} 个镜头），复刻只能生成一个连续镜头，无法复现切换。建议选取其中一段单镜头片段，或拆分后逐段复刻再拼接。`
}
