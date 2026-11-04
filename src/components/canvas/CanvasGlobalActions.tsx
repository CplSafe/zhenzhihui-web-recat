import TutorialButton from '@/components/common/TutorialButton'
import { formatCredits } from '@/utils/creditsFormat'
import { openMemberCenterTab } from '@/stores/ui'

interface Props {
  open: boolean
  credits: number
  showExtras: boolean
  canImportScript: boolean
  canvasId: number
  workspaceId: number
  onToggle: () => void
  onClose: () => void
  onGuide: () => void
  onImportScript: () => void
  onShare: () => void
}

/** 画布级积分、指南、导入、教程与分享入口。 */
export default function CanvasGlobalActions({
  open,
  credits,
  showExtras,
  canImportScript,
  canvasId,
  workspaceId,
  onToggle,
  onClose,
  onGuide,
  onImportScript,
  onShare,
}: Props) {
  return (
    <div
      className="canvas-actions-menu"
      data-open={open}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('.canvas-global-actions button')) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose()
          event.stopPropagation()
        }
      }}
    >
      <button
        type="button"
        className="canvas-actions-toggle"
        aria-expanded={open}
        aria-controls="canvas-global-actions"
        onClick={onToggle}
      >
        画布操作
      </button>
      <div id="canvas-global-actions" className="canvas-global-actions">
        <button type="button" className="canvas-share-btn" onClick={() => openMemberCenterTab('recharge')}>
          剩余积分：{formatCredits(credits)}
        </button>
        {showExtras && (
          <button type="button" className="canvas-share-btn" onClick={onGuide}>
            开始指南
          </button>
        )}
        {showExtras && (
          <button type="button" className="canvas-share-btn" disabled={!canImportScript} onClick={onImportScript}>
            导入文字或分镜
          </button>
        )}
        <TutorialButton variant="pill" tutorialKey="canvas" />
        {canvasId > 0 && workspaceId > 0 && (
          <button className="canvas-share-btn" onClick={onShare} title="分享这块画布" aria-label="分享这块画布">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
            </svg>
            <span>分享</span>
          </button>
        )}
      </div>
    </div>
  )
}
