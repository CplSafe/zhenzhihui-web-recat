import { Button, Modal } from 'antd'
import { StudioHTTPError } from './studio'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { DeepAgentStudioProps } from './DeepAgentStudio'
import { hasFileDrag } from '@/utils/canvasLocalImage'
import styles from './CanvasDirectorDock.module.css'

const DeepAgentStudio = lazy(() => import('./DeepAgentStudio'))

/** The host keys this dock by account/workspace/canvas. Collapse preserves the conversation. */
export default function CanvasDirectorDock({
  workspaceId,
  canvasId,
  modelDefaults,
  onCanvasChange,
  opened,
  onCollapse,
  canvasReference,
}: Required<Pick<DeepAgentStudioProps, 'workspaceId' | 'canvasId' | 'onCollapse'>> &
  Pick<DeepAgentStudioProps, 'onCanvasChange' | 'canvasReference' | 'modelDefaults'> & { opened: boolean }) {
  const [mounted, setMounted] = useState(opened)
  const [choosing, setChoosing] = useState(false)
  const pending = useRef<{ resolve: (value: boolean) => void; reject: (reason: Error) => void }>()
  const cancel = useCallback(() => {
    pending.current?.reject(new StudioHTTPError('已取消本次运行', 409))
    pending.current = undefined
    setChoosing(false)
  }, [])
  useEffect(() => () => pending.current?.reject(new StudioHTTPError('已离开画布', 409)), [])
  const chooseRunLock = useCallback(
    () =>
      new Promise<boolean>((resolve, reject) => {
        pending.current?.reject(new StudioHTTPError('已有新的运行请求', 409))
        pending.current = { resolve, reject }
        setChoosing(true)
      }),
    [],
  )
  function choose(value: boolean) {
    pending.current?.resolve(value)
    pending.current = undefined
    setChoosing(false)
  }
  useEffect(() => {
    if (opened) setMounted(true)
  }, [opened])
  return (
    <div
      className={`${styles.dock} canvas-director-area nodrag nopan nowheel`}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        if (hasFileDrag(event.dataTransfer)) {
          // 输入区接受附件。其余位置禁用拖入，避免浏览器直接打开本地文件。
          event.dataTransfer.dropEffect = event.defaultPrevented ? 'copy' : 'none'
          event.preventDefault()
        }
        event.stopPropagation()
      }}
      onDrop={(event) => {
        if (hasFileDrag(event.dataTransfer)) event.preventDefault()
        event.stopPropagation()
      }}
    >
      {choosing && (
        <Modal
          open
          centered
          title="本轮 Agent 运行时锁定画布？"
          onCancel={cancel}
          zIndex={1600}
          footer={
            <>
              <Button onClick={cancel}>取消</Button>
              <Button onClick={() => choose(false)}>保持协作并运行</Button>
              <Button type="primary" onClick={() => choose(true)}>
                锁定并运行
              </Button>
            </>
          }
        >
          <p>锁定期间，其他成员只能查看画布，无法编辑节点或向 Agent 发送消息。本轮结束或暂停后自动解锁。</p>
        </Modal>
      )}
      {mounted && (
        <div hidden={!opened}>
          <Suspense fallback={<div className={styles.loading}>正在连接 DoDo Agent…</div>}>
            <DeepAgentStudio
              workspaceId={workspaceId}
              canvasId={canvasId}
              modelDefaults={modelDefaults}
              authMode="business"
              chooseRunLock={chooseRunLock}
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
