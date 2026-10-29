import type { Node } from '@xyflow/react'
import { uploadAssetFile } from '@/api/business'
import { assetStreamUrl } from './assetUrl'
import { normalizeAudioSettings, readAudioDuration, type TimelineAudioClip } from './canvasAudio'

export interface VideoAudioComposition {
  submissionKey: string
  clips: TimelineAudioClip[]
  failed?: boolean
  result?: { sourceAssetId: number; assetId: number }
}

/** 固定提交时的素材与剪辑参数；轮询结束后不能重新读取已经变化的上游节点。 */
export function snapshotVideoAudio(
  refs: Array<{ kind: string; sourceId?: string; assetId?: number; workspaceId?: number }>,
  nodes: Node[],
  workspaceId: number,
  submissionKey: string,
): VideoAudioComposition | undefined {
  const seen = new Set<number>()
  const clips = refs.flatMap((ref): TimelineAudioClip[] => {
    if (ref.kind !== 'audio' || !Number.isSafeInteger(ref.assetId) || ref.assetId <= 0 || seen.has(ref.assetId))
      return []
    if (Number(ref.workspaceId || workspaceId) !== workspaceId) throw new Error('配音素材不属于当前工作空间')
    const node = nodes.find((item) => item.id === ref.sourceId)
    if (!node || Number(node.data.assetId) !== ref.assetId) throw new Error('配音素材已更换，请重新选择后生成')
    seen.add(ref.assetId)
    return [
      {
        ...normalizeAudioSettings(node.data.audio),
        assetId: ref.assetId,
        sourceNodeId: node.id,
        title: String(node.data.title || '配音'),
      },
    ]
  })
  return clips.length ? { submissionKey, clips } : undefined
}

export class VideoAudioCompositionError extends Error {}

/** 成功状态不代表已完成配音：旧同步结果可能仍指向模型原片。 */
export function needsVideoAudioComposition(data: Record<string, unknown>): boolean {
  const composition = data.videoAudioComposition as VideoAudioComposition | undefined
  return Boolean(
    composition?.clips?.length && (!composition.result || Number(data.assetId) === composition.result.sourceAssetId),
  )
}

/** 使用原音频替换模型声轨，入库后预览、下载、下游引用都使用同一份 MP4。 */
export async function composeVideoAudio(
  workspaceId: number,
  sourceAssetId: number,
  composition: VideoAudioComposition,
  signal?: AbortSignal,
): Promise<number> {
  if (composition.result?.sourceAssetId === sourceAssetId && composition.result.assetId > 0)
    return composition.result.assetId
  const check = () => {
    if (signal?.aborted) throw new DOMException('已取消合成', 'AbortError')
  }
  try {
    check()
    const response = await fetch(assetStreamUrl(sourceAssetId, workspaceId), { signal })
    if (!response.ok) throw new Error('无法读取生成的视频')
    const video = await response.blob()
    const { demuxMp4 } = await import('./mp4Demux')
    const track = demuxMp4(await video.arrayBuffer()).video
    const duration = track ? track.duration / track.timescale : 0
    if (!(duration > 0 && duration <= 300)) throw new Error('视频须为 300 秒以内的 MP4')
    const resolvedClips = await Promise.all(
      composition.clips.map(async (clip) => {
        const durationSec =
          clip.durationSec > 0 ? clip.durationSec : await readAudioDuration(assetStreamUrl(clip.assetId, workspaceId))
        const settings = normalizeAudioSettings({
          ...clip,
          durationSec,
          outSec: clip.outSec > 0 ? clip.outSec : durationSec,
        })
        return { ...clip, ...settings }
      }),
    )
    let voiceEnd = 0
    const clips = resolvedClips.map((clip) => {
      const startSec = clip.lane === 'voice' && clip.startSec === 0 ? voiceEnd : clip.startSec
      const end = startSec + clip.outSec - clip.inSec
      if (!clip.muted && clip.volume > 0) {
        if (clip.lane === 'voice') voiceEnd = Math.max(voiceEnd, end)
        if (!clip.loop && end > duration + 0.1)
          throw new Error('原配音长于生成视频，请将视频和配音加入视频剪辑后调整时长，避免截断台词')
      }
      return { ...clip, startSec }
    })
    check()
    const { mixAudioIntoMp4 } = await import('./audioMix')
    const output = await mixAudioIntoMp4(video, clips, duration, workspaceId, 0)
    check()
    const uploaded = await uploadAssetFile({
      workspaceId,
      file: new File([output], `video-${sourceAssetId}-voice.mp4`, { type: 'video/mp4' }),
      signal,
    })
    check()
    const assetId = Number(uploaded?.asset?.id)
    if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('合成视频未返回有效素材')
    return assetId
  } catch (error) {
    check()
    throw new VideoAudioCompositionError(
      `视频已生成，原配音合成失败：${error instanceof Error ? error.message : '请重试'}。点击“重试配音合成”可重试，不会重新生成视频。`,
    )
  }
}
