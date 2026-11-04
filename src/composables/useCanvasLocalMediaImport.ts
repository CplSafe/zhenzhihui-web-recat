import { useCallback, useEffect, useRef } from 'react'
import { uploadAssetFile } from '@/api/business'
import { showToast } from '@/stores/ui'
import { assetStreamUrl } from '@/utils/assetUrl'
import { normalizeImageFileForAiInput } from '@/utils/imageFile'
import { isAudioFile, normalizeAudioSettings, readAudioDuration } from '@/utils/canvasAudio'
import { CANVAS_AUDIO_NODES_ENABLED } from '@/utils/canvasFeatureFlags'
import { calcNodeSize, AUTO_RATIO } from '@/utils/canvasNodeSize'
import {
  isCanvasImageFile,
  isCanvasVideoFile,
  LOCAL_IMAGE_IMPORT_LIMIT,
  LOCAL_VIDEO_MAX_BYTES,
  naturalImageRatio,
  normalizeCanvasImageFile,
  pickImageFiles,
  pickVideoFiles,
  readImageNaturalSize,
} from '@/utils/canvasLocalImage'

const PREVIEW_URL_REVOKE_MS = 5000

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export interface CanvasLocalMediaImportOptions {
  workspaceId: number
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number }
  commitHistory: () => void
  appendNewNode: (
    kind: string,
    position: { x: number; y: number },
    options: {
      ratio: string
      size: { width: number; height: number }
      skipHistory: boolean
      deferSync: boolean
      extraData: Record<string, unknown>
    },
  ) => string
  setNodes: (updater: (nodes: any[]) => any[]) => void
  setSelectedNode: (updater: (node: any) => any) => void
  setSaveStatus: (status: 'dirty') => void
  resolveUploadedRealPerson: (assetId: number, file: File) => Promise<unknown>
  scheduleImportSync: () => void
}

/** 画布本地媒体导入：统一负责文件规范化、预览地址生命周期、上传与失败清理。 */
export function useCanvasLocalMediaImport({
  workspaceId,
  screenToFlowPosition,
  commitHistory,
  appendNewNode,
  setNodes,
  setSelectedNode,
  setSaveStatus,
  resolveUploadedRealPerson,
  scheduleImportSync,
}: CanvasLocalMediaImportOptions) {
  const previewUrlsRef = useRef(new Set<string>())

  useEffect(
    () => () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url)
      previewUrlsRef.current.clear()
    },
    [],
  )

  const releasePreviewUrl = useCallback((url: string) => {
    if (!url) return
    window.setTimeout(() => {
      if (!previewUrlsRef.current.has(url)) return
      URL.revokeObjectURL(url)
      previewUrlsRef.current.delete(url)
    }, PREVIEW_URL_REVOKE_MS)
  }, [])

  const importLocalMedia = useCallback(
    async (files: File[], anchor?: { x: number; y: number }) => {
      const allImages = pickImageFiles(files)
      const allVideos = pickVideoFiles(files)
      const allAudios = CANVAS_AUDIO_NODES_ENABLED ? files.filter(isAudioFile) : []
      const unsupportedFiles = files.filter(
        (file) => !isCanvasImageFile(file) && !isCanvasVideoFile(file) && !isAudioFile(file),
      )
      const audios = allAudios.filter((file) => file.size <= 100 * 1024 * 1024)
      const oversizedAudios = allAudios.length - audios.length
      const videos = allVideos.filter((file) => file.size <= LOCAL_VIDEO_MAX_BYTES)
      const oversized = allVideos.length - videos.length
      if (allImages.length === 0 && allVideos.length === 0 && allAudios.length === 0) {
        showToast(
          unsupportedFiles.length
            ? '文件格式不受支持；视频请使用 MP4、MOV、M4V、WEBM、AVI、MKV、MPEG、MPG 或 3GP 格式'
            : CANVAS_AUDIO_NODES_ENABLED
              ? '支持图片、视频和音频文件'
              : '支持图片和视频文件',
          'error',
        )
        return
      }

      // 解码和缩放高分辨率图片会占用大量内存，上传限流不能限制这里的并发。
      const imageChecks = await mapWithConcurrency(allImages, 2, async (file) => {
        try {
          return {
            file: await normalizeImageFileForAiInput(await normalizeCanvasImageFile(file)),
            title: file.name.replace(/\.[^.]+$/, ''),
            error: '',
          }
        } catch (error: any) {
          return {
            file,
            title: file.name.replace(/\.[^.]+$/, ''),
            error: `${file.name}：${String(error?.message || '图片不符合要求')}`,
          }
        }
      })
      const images = imageChecks.filter((item) => !item.error).map((item) => item.file)
      const imageNames = new Map(imageChecks.filter((item) => !item.error).map((item) => [item.file, item.title]))
      const failures: string[] = imageChecks.filter((item) => item.error).map((item) => item.error)
      if (images.length === 0 && videos.length === 0 && audios.length === 0) {
        const rejected = [
          ...failures,
          oversized ? `${oversized} 个视频超过 512MB，请压缩后再导入` : '',
          oversizedAudios ? `${oversizedAudios} 个音频超过 100MB，请压缩后再导入` : '',
          unsupportedFiles.length ? `${unsupportedFiles.length} 个文件格式不受支持` : '',
        ].filter(Boolean)
        showToast(rejected.join('；') || '没有可导入的素材，请检查文件格式', 'error')
        return
      }

      const media = [
        ...images.map((file) => ({ file, title: imageNames.get(file) || file.name, kind: 'image' as const })),
        ...videos.map((file) => ({ file, title: file.name.replace(/\.[^.]+$/, ''), kind: 'video' as const })),
        ...audios.map((file) => ({ file, title: file.name.replace(/\.[^.]+$/, ''), kind: 'audio' as const })),
      ]
      const accepted = media.slice(0, LOCAL_IMAGE_IMPORT_LIMIT)
      const skipped = media.length - accepted.length
      const origin = anchor || { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      commitHistory()

      const created = await mapWithConcurrency(accepted, 8, async ({ file, title, kind }, index) => {
        const ratio =
          kind === 'video' || kind === 'audio'
            ? AUTO_RATIO
            : ((natural) => (natural ? naturalImageRatio(natural.width, natural.height) : '1:1'))(
                await readImageNaturalSize(file),
              )
        const size = kind === 'audio' ? { width: 320, height: 116 } : calcNodeSize(ratio, 250)
        const previewUrl = URL.createObjectURL(file)
        previewUrlsRef.current.add(previewUrl)
        const offset = index * 36
        const point = screenToFlowPosition({ x: origin.x + offset, y: origin.y + offset })
        const nodeId = appendNewNode(
          kind,
          { x: point.x - size.width / 2, y: point.y - size.height / 2 },
          {
            ratio,
            size,
            skipHistory: true,
            deferSync: true,
            extraData: { previewUrl, uploading: true, assetSource: 'upload', assetWorkspaceId: workspaceId, title },
          },
        )
        return { nodeId, file, title, previewUrl, kind }
      })

      // 批量节点作为一次导入保存，避免每个节点重复同步序列化整张画布。
      if (created.length) scheduleImportSync()

      await mapWithConcurrency(created, 4, async ({ nodeId, file, title, previewUrl, kind }) => {
        try {
          const durationSec = kind === 'audio' ? await readAudioDuration(previewUrl) : 0
          const out: any = await uploadAssetFile({ workspaceId, file })
          const assetId = Number(out?.asset?.id || 0)
          if (!assetId) throw new Error('上传素材失败，请稍后重试')
          const realPerson = await resolveUploadedRealPerson(assetId, file)
          const nextData: Record<string, unknown> = {
            assetId,
            title,
            realPerson,
            assetSource: realPerson ? 'real_person' : 'upload',
            imageOrigin: { assetId, kind: 'upload' },
            assetWorkspaceId: workspaceId,
            resultUrl: assetStreamUrl(assetId, workspaceId),
            uploading: false,
            previewUrl: '',
            ...(kind === 'audio'
              ? {
                  title,
                  audio: normalizeAudioSettings({ durationSec, inSec: 0, outSec: durationSec, origin: 'upload' }),
                }
              : {}),
          }
          setNodes((nodes) =>
            nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...nextData } } : node)),
          )
          setSelectedNode((node) => (node && node.id === nodeId ? { ...node, ...nextData } : node))
        } catch (error: any) {
          failures.push(String(error?.message || '上传素材失败，请稍后重试'))
          setNodes((nodes) => nodes.filter((node) => node.id !== nodeId))
          setSelectedNode((node) => (node && node.id === nodeId ? null : node))
        } finally {
          releasePreviewUrl(previewUrl)
        }
      })

      setSaveStatus('dirty')
      if (failures.length > 0) {
        showToast(failures.length > 1 ? `${failures.length} 个素材未能导入：${failures[0]}` : failures[0], 'error')
      } else if (oversized > 0 || oversizedAudios > 0 || unsupportedFiles.length > 0) {
        showToast(
          [
            oversized ? `${oversized} 个视频超过 512MB 已跳过` : '',
            oversizedAudios ? `${oversizedAudios} 个音频超过 100MB 已跳过` : '',
            unsupportedFiles.length ? `${unsupportedFiles.length} 个文件格式不受支持已跳过` : '',
          ]
            .filter(Boolean)
            .join('；') + '，请检查文件格式并压缩超限素材',
          'info',
        )
      } else if (skipped > 0) {
        showToast(`一次最多导入 ${LOCAL_IMAGE_IMPORT_LIMIT} 个素材，其余 ${skipped} 个已忽略`, 'info')
      }
    },
    [
      appendNewNode,
      commitHistory,
      releasePreviewUrl,
      resolveUploadedRealPerson,
      scheduleImportSync,
      screenToFlowPosition,
      setNodes,
      setSaveStatus,
      setSelectedNode,
      workspaceId,
    ],
  )

  return importLocalMedia
}
