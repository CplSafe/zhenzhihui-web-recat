import { lazy, Suspense, useEffect, useState } from 'react'
import type { DeepAgentStudioProps } from './DeepAgentStudio'
import styles from './CanvasDirectorDock.module.css'

const DeepAgentStudio = lazy(() => import('./DeepAgentStudio'))

/** The host keys this dock by account/workspace/canvas. Collapse preserves the conversation. */
export default function CanvasDirectorDock({
  workspaceId,
  canvasId,
  onCanvasChange,
  opened,
  onCollapse,
  canvasReference,
}: Required<Pick<DeepAgentStudioProps, 'workspaceId' | 'canvasId' | 'onCollapse'>> &
  Pick<DeepAgentStudioProps, 'onCanvasChange' | 'canvasReference'> & { opened: boolean }) {
  const [mounted, setMounted] = useState(opened)
  useEffect(() => {
    if (opened) setMounted(true)
  }, [opened])
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
          <Suspense fallback={<div className={styles.loading}>正在连接 DoDo Agent…</div>}>
            <DeepAgentStudio
              workspaceId={workspaceId}
              canvasId={canvasId}
              authMode="business"
              onCanvasChange={onCanvasChange}
              onCollapse={onCollapse}
              canvasReference={canvasReference}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
