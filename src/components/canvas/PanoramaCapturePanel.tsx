import { Button } from 'antd'
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { panoramaContactSheet, panoramaGridColumns } from '@/utils/panoramaContactSheet'
import styles from './CanvasImageTools.module.css'
import { studioCaptureSize } from '@/utils/canvasStudioControls'
import { canvasImageResultSize } from '@/utils/canvasImageResults'
import { naturalImageRatio } from '@/utils/canvasLocalImage'

export interface PanoramaFrame {
  blob: Blob
  url: string
  view: Record<string, unknown>
  selected: boolean
  saved: boolean
}

/** Shared controls and contact sheet for current, four and twelve-view captures. */
export default function PanoramaCapturePanel({
  ready,
  error,
  disabled,
  capturing,
  progress,
  frames,
  setFrames,
  captureFrames,
  captureLock,
  setCapturing,
  setCaptureError,
  onCapture,
}: {
  ready: boolean
  error: string
  disabled: boolean
  capturing: boolean
  progress: { done: number; total: number } | null
  frames: PanoramaFrame[]
  setFrames: Dispatch<SetStateAction<PanoramaFrame[]>>
  captureFrames: (count: number) => Promise<void>
  captureLock: MutableRefObject<boolean>
  setCapturing: Dispatch<SetStateAction<boolean>>
  setCaptureError: Dispatch<SetStateAction<string>>
  onCapture: (blob: Blob, view?: Record<string, unknown>) => Promise<void>
}) {
  const groupAssignments = useRef(new Map<string, Record<string, unknown>>())
  const exportUrls = useRef<string[]>([])
  useEffect(() => () => exportUrls.current.forEach((url) => URL.revokeObjectURL(url)), [])
  return (
    <div className={styles.capturePanel} aria-label="全景截图工作台">
      <div className={styles.captureIntro}>
        <strong>选择取景范围</strong>
        <p>4 视角：水平环绕一周。12 视角：俯视、平视、仰视各 4 张。批量取景以当前水平方向为起点，视野为 75°。</p>
      </div>
      <div className={styles.presets}>
        {[1, 4, 12].map((count) => (
          <Button
            key={count}
            disabled={!ready || Boolean(error) || disabled || capturing}
            onClick={() => void captureFrames(count)}
          >
            {count === 1 ? '当前视角截图' : `${count}视角截图`}
          </Button>
        ))}
        <span role="status">
          {capturing
            ? progress
              ? `正在截图 ${progress.done} / ${progress.total}`
              : '正在加入画布…'
            : '本地取景，不消耗生成积分'}
        </span>
      </div>
      {frames.length > 0 && (
        <section className={styles.captureCollection} aria-label="截图预览">
          <div className={styles.captureSummary}>
            <strong>截图预览</strong>
            <span role="status">
              共 {frames.length} 张 · 已选 {frames.filter((frame) => frame.selected && !frame.saved).length} 张
            </span>
            <Button
              size="small"
              disabled={disabled || capturing || frames.every((frame) => frame.saved)}
              onClick={() => setFrames((old) => old.map((frame) => ({ ...frame, selected: !frame.saved })))}
            >
              全选未添加截图
            </Button>
            <Button
              size="small"
              disabled={disabled || capturing || !frames.some((frame) => frame.selected)}
              onClick={() => setFrames((old) => old.map((frame) => ({ ...frame, selected: false })))}
            >
              取消全选
            </Button>
          </div>
          <p className={styles.hint}>
            选中截图将自动排成网格分镜组，4 张为 2×2、12 张为 4×3。也可拼接下载为一张 PNG（最长边不超过
            4096px，混合画幅留白）。关闭窗口将清除未添加的截图。
          </p>
          <div className={styles.captureResults}>
            {frames.map((frame, index) => (
              <div
                key={frame.url}
                className={styles.captureFrame}
                data-selected={frame.selected}
                data-saved={frame.saved}
              >
                <label>
                  <img src={frame.url} alt={`视角 ${index + 1}`} />
                  <input
                    type="checkbox"
                    checked={frame.selected}
                    disabled={disabled || capturing || frame.saved}
                    aria-label={`选择视角 ${index + 1}`}
                    onChange={(event) =>
                      setFrames((old) =>
                        old.map((item, i) => (i === index ? { ...item, selected: event.target.checked } : item)),
                      )
                    }
                  />
                  {frame.saved ? '已加入画布' : `视角 ${index + 1}`}
                  <span className={styles.captureAngle}>
                    水平 {Math.round(Number(frame.view.yaw || 0))}° · 俯仰 {Math.round(Number(frame.view.pitch || 0))}°
                  </span>
                </label>
                <a href={frame.url} download={`全景视角-${index + 1}.png`}>
                  下载
                </a>
              </div>
            ))}
          </div>
          <Button
            disabled={disabled || capturing || !frames.some((frame) => frame.selected && !frame.saved)}
            onClick={async () => {
              if (captureLock.current) return
              captureLock.current = true
              setCapturing(true)
              setCaptureError('')
              try {
                const blob = await panoramaContactSheet(
                  frames.filter((frame) => frame.selected && !frame.saved).map((frame) => frame.blob),
                )
                const url = URL.createObjectURL(blob)
                exportUrls.current.push(url)
                const link = document.createElement('a')
                link.href = url
                link.download = '全景分镜拼图.png'
                link.click()
              } catch (err) {
                setCaptureError(err instanceof Error ? err.message : '拼接下载失败')
              } finally {
                captureLock.current = false
                setCapturing(false)
              }
            }}
          >
            拼接下载选中截图
          </Button>
          <Button
            type="primary"
            disabled={disabled || capturing || !frames.some((frame) => frame.selected && !frame.saved)}
            onClick={async () => {
              if (captureLock.current) return
              captureLock.current = true
              setCapturing(true)
              setCaptureError('')
              try {
                const selected = frames.filter((frame) => frame.selected && !frame.saved)
                const groupId = `panorama-${crypto.randomUUID()}`
                const sizes = selected.map((frame) => {
                  const [width, height] = studioCaptureSize(frame.view)
                  return canvasImageResultSize({ ratio: naturalImageRatio(width, height) })
                })
                selected.forEach((frame, index) => {
                  if (!groupAssignments.current.has(frame.url))
                    groupAssignments.current.set(frame.url, {
                      captureGroupId: selected.length > 1 ? groupId : '',
                      captureIndex: index,
                      captureCount: selected.length,
                      captureColumns: panoramaGridColumns(selected.length),
                      captureCellWidth: Math.max(...sizes.map((size) => size.width)),
                      captureCellHeight: Math.max(...sizes.map((size) => size.height)),
                    })
                })
                for (const frame of selected) {
                  await onCapture(frame.blob, { ...frame.view, ...groupAssignments.current.get(frame.url) })
                  setFrames((old) =>
                    old.map((item) => (item.url === frame.url ? { ...item, saved: true, selected: false } : item)),
                  )
                }
              } catch (err) {
                setCaptureError(err instanceof Error ? err.message : '保存失败，可重试未保存的截图')
              } finally {
                captureLock.current = false
                setCapturing(false)
              }
            }}
          >
            将选中截图加入画布
          </Button>
        </section>
      )}
    </div>
  )
}
