import DraftSaveIndicator from '@/components/common/DraftSaveIndicator'
import type { DraftSaveStatus } from '@/utils/creativeDraftPersistence'

interface Props {
  saveStatus: DraftSaveStatus
  cloudStatus: string
  cloudMessage: string
  canSave: boolean
  onBack: () => void
  onSave: () => void
  manualSaving: boolean
}

/** 画布返回入口与草稿/云端保存状态。 */
export default function CanvasNavigationStatus({
  saveStatus,
  cloudStatus,
  cloudMessage,
  canSave,
  onBack,
  onSave,
  manualSaving,
}: Props) {
  return (
    <div className="canvas-navigation nodrag nopan nowheel" aria-label="画布导航">
      <button type="button" className="canvas-back-btn" onClick={onBack} title="返回无限画布" aria-label="返回无限画布">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5m7 7-7-7 7-7" />
        </svg>
      </button>
      <div className="canvas-save-status">
        {cloudStatus === 'online' && <DraftSaveIndicator status={saveStatus} />}
        {cloudStatus !== 'online' && (
          <span className={`canvas-cloud-status is-${cloudStatus}`} title={cloudMessage}>
            {cloudMessage}
          </span>
        )}
        {canSave && (cloudStatus === 'error' || cloudStatus === 'offline' || manualSaving) && (
          <button type="button" className="canvas-manual-save" onClick={onSave} disabled={manualSaving}>
            {manualSaving ? '保存中…' : '保存画布'}
          </button>
        )}
      </div>
    </div>
  )
}
