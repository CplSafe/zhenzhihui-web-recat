import { lazy, Suspense, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import type { DeepAgentStudioProps } from './DeepAgentStudio'
import styles from './CanvasDirectorDock.module.css'

const DeepAgentStudio = lazy(() => import('./DeepAgentStudio'))

/** The host keys this dock by account/workspace/canvas. Collapse preserves the conversation. */
export default function CanvasDirectorDock({
  workspaceId,
  canvasId,
  onCanvasChange,
}: Required<Pick<DeepAgentStudioProps, 'workspaceId' | 'canvasId'>> & Pick<DeepAgentStudioProps, 'onCanvasChange'>) {
  const [opened, setOpened] = useState(false)
  const [mounted, setMounted] = useState(false)
  return (
    <div
      className={`${styles.dock} canvas-director-area nodrag nopan nowheel`}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onDragOver={(event) => event.stopPropagation()}
      onDrop={(event) => event.stopPropagation()}
    >
      {mounted && (
        <div hidden={!opened}>
          <Suspense fallback={<div className={styles.loading}>正在连接导演…</div>}>
            <DeepAgentStudio
              workspaceId={workspaceId}
              canvasId={canvasId}
              authMode="business"
              onCanvasChange={onCanvasChange}
              onCollapse={() => setOpened(false)}
            />
          </Suspense>
        </div>
      )}
      {!opened && (
        <button
          type="button"
          className={styles.launcher}
          onClick={() => {
            setMounted(true)
            setOpened(true)
          }}
        >
          <MessageCircle size={18} aria-hidden="true" />
          AI 导演
        </button>
      )}
    </div>
  )
}
