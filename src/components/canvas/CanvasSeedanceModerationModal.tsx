import { Alert, Button, Modal, Spin, Tag } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BusinessApiError, getSeedanceModeration, submitSeedanceModeration } from '@/api/business'
import { normalizeSeedanceModerationResult, type SeedanceModerationResult } from '@/utils/seedanceModeration'

interface Props {
  open: boolean
  assetId: number
  workspaceId: number
  mediaType: 'image' | 'video'
  onStatusChange?: (assetId: number, workspaceId: number, state: SeedanceModerationResult['state'] | null) => void
  onClose: () => void
}

export default function CanvasSeedanceModerationModal({
  open,
  assetId,
  workspaceId,
  mediaType,
  onStatusChange,
  onClose,
}: Props) {
  const [result, setResult] = useState<SeedanceModerationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const autoStartedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!assetId || !workspaceId) return undefined
    setLoading(true)
    setError('')
    try {
      const next = normalizeSeedanceModerationResult(await getSeedanceModeration(assetId, { workspaceId }))
      setResult(next)
      onStatusChange?.(assetId, workspaceId, next.state)
      return next
    } catch (cause) {
      // 首次查询时后端用 404 表示该素材尚未送审，这是可提交状态而非失败。
      if (cause instanceof BusinessApiError && (cause as BusinessApiError & { status?: number }).status === 404) {
        setResult(null)
        onStatusChange?.(assetId, workspaceId, null)
        return null
      }
      setError(cause instanceof Error ? cause.message : '查询审核状态失败，请稍后重试')
      return undefined
    } finally {
      setLoading(false)
    }
  }, [assetId, workspaceId, onStatusChange])

  const submit = useCallback(async () => {
    if (submitting || loading || !assetId || !workspaceId) return
    setSubmitting(true)
    setError('')
    try {
      await submitSeedanceModeration(assetId, { workspaceId })
      const startedAt = Date.now()
      let next: SeedanceModerationResult | null | undefined = null
      do {
        await new Promise((resolve) => window.setTimeout(resolve, 2000))
        next = await refresh()
        if (!next || next.state !== 'pending') break
      } while (Date.now() - startedAt < 60_000)
      if (next?.state === 'pending') setError('审核仍在进行，可稍后刷新状态查看结果')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交审核失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }, [assetId, loading, refresh, submitting, workspaceId])

  useEffect(() => {
    if (!open) {
      autoStartedRef.current = false
      return
    }
    if (autoStartedRef.current) return
    autoStartedRef.current = true
    setResult(null)
    void (async () => {
      const current = await refresh()
      // 只有查询成功确认没有通过/进行中的审核，或明确尚无记录，才自动提交。
      // 网络错误保留给用户重试，避免无意间重复创建审核任务。
      if (current === undefined || current?.state === 'approved' || current?.state === 'pending') return
      await submit()
    })()
  }, [open, refresh, submit])

  const stateLabel =
    result?.state === 'approved'
      ? '审核通过'
      : result?.state === 'rejected'
        ? '审核未通过'
        : result?.state === 'pending'
          ? '审核中'
          : result?.state === 'unknown'
            ? `未识别的审核状态${result.rawStatus ? `：${result.rawStatus}` : ''}`
            : '尚无审核结果'

  return (
    <Modal
      title={`Seedance ${mediaType === 'video' ? '视频' : '图片'}审核`}
      open={open}
      onCancel={onClose}
      footer={
        <Button onClick={() => void refresh()} disabled={loading || submitting}>
          刷新状态
        </Button>
      }
      destroyOnClose
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <span style={{ marginRight: 8 }}>
            {mediaType === 'video' ? '视频' : '图片'}素材 ID：{assetId}
          </span>
          {loading && !result ? <Spin size="small" /> : <Tag>{submitting ? '正在提交审核' : stateLabel}</Tag>}
        </div>
        {result?.reason && <Alert type={result.state === 'rejected' ? 'error' : 'info'} message={result.reason} />}
        {result?.state === 'approved' && (
          <Alert
            type="success"
            message={`审核通过。生成时仍使用原${mediaType === 'video' ? '视频' : '图片'}素材 ID。`}
          />
        )}
        {result?.state === 'rejected' && (
          <Alert type="error" message="审核未通过。该素材暂不可用于 Seedance 生成，请更换素材后再试。" />
        )}
        {error && <Alert type="error" showIcon message={error} />}
        {submitting && <Alert type="info" showIcon message="已自动提交审核，正在等待审核结果。" />}
        <div style={{ color: '#7a8496', fontSize: 12 }}>审核完成后仍使用原素材 ID；审核素材由后端自动关联。</div>
      </div>
    </Modal>
  )
}
