import { useRef, useState } from 'react'
import { getCanvasTaskPresentation } from '@/utils/canvasTaskState'
import CanvasFailureDetails from './CanvasFailureDetails'
import { useToast } from '@/composables/useToast'
import styles from './CanvasNodePanel.module.css'
import upscaleStyles from './CanvasVideoUpscaleResultPanel.module.css'

export default function CanvasVideoUpscaleResultPanel({
  data,
  onRetry,
}: {
  data: Record<string, any>
  onRetry: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const { showToast } = useToast()
  const request = data.generationRequest || data.videoUpscaleRequest
  const validRequest =
    request?.operationCode === 'video.upscale' &&
    request?.kind === 'video' &&
    Number(request.modelVersionId) > 0 &&
    Array.isArray(request.inputAssets) &&
    request.inputAssets.some(
      (asset: any) => asset.role === 'video' && Number.isSafeInteger(asset.asset_id) && asset.asset_id > 0,
    )
  const state = getCanvasTaskPresentation({
    status: data.taskStatus,
    hasResult: Boolean(data.assetId || data.resultUrl),
  })
  const failed = [
    'failed',
    'error',
    'submit_failed',
    'payment_failed',
    'cancelled',
    'expired',
    'result_sync_failed',
  ].includes(String(data.taskStatus))
  const params = request?.params || data.params || {}
  const concurrencyRejected = Number(data.taskFailure?.httpStatus) === 409 && String(data.taskFailure?.code) === '10401'
  return (
    <section className={`${styles.panel} ${upscaleStyles.panel}`} aria-label="视频超分任务">
      <strong>视频超分</strong>
      <p>模型：{data.upscaleModelName || `超分模型 #${request?.modelVersionId || data.modelVersionId || '未知'}`}</p>
      <dl>
        {Object.entries(params).map(([name, value]) => (
          <div key={name}>
            <dt>{data.upscaleParamLabels?.[name] || name}</dt>
            <dd>
              {typeof value === 'boolean'
                ? value
                  ? '开启'
                  : '关闭'
                : typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p role="status">
        {state.running
          ? '超分任务处理中，请等待结果。'
          : failed
            ? concurrencyRejected
              ? '本次请求因模型并发限制被拒绝，未创建超分任务。请等待已有任务完成后重试；若没有正在执行的任务，请提供 RequestID 联系支持核查占用状态。'
              : '上次超分未完成，可查看失败详情。'
            : data.assetId || data.resultUrl
              ? '超分已完成。'
              : '超分任务等待提交。'}
      </p>
      {failed && <CanvasFailureDetails data={data} />}
      {!validRequest && <p role="alert">缺少原始超分请求，请从原视频重新打开超分。</p>}
      {failed && (
        <button
          className={upscaleStyles.retry}
          type="button"
          disabled={busy || state.running || !validRequest}
          onClick={async () => {
            if (lock.current) return
            lock.current = true
            setBusy(true)
            try {
              await onRetry()
            } catch (error) {
              showToast(error instanceof Error ? error.message : '超分提交失败，请稍后重试', 'error')
            } finally {
              lock.current = false
              setBusy(false)
            }
          }}
        >
          {busy ? '正在提交超分…' : '重试超分'}
        </button>
      )}
    </section>
  )
}
