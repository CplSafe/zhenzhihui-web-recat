import { Button } from 'antd'
import type { CanvasAgentLock } from '@/composables/useCanvasNodeLocks'
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
  agentLock,
  onUnlock,
}: Required<Pick<DeepAgentStudioProps, 'workspaceId' | 'canvasId' | 'onCollapse'>> &
  Pick<DeepAgentStudioProps, 'onCanvasChange' | 'canvasReference' | 'modelDefaults'> & {
    opened: boolean
    agentLock?: CanvasAgentLock
    onUnlock: (id: string) => Promise<void>
  }) {
  const [mounted, setMounted] = useState(opened)
  const [choosing, setChoosing] = useState(false)
  const [kept, setKept] = useState<string>()
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (agentLock?.running) setKept(undefined)
  }, [agentLock?.running])
  async function unlock() {
    if (!agentLock || unlocking) return
    setUnlocking(true)
    setError('')
    try {
      await onUnlock(agentLock.id)
    } catch (error) {
      setError(error instanceof Error ? error.message : '解锁失败，请稍后重试')
    } finally {
      setUnlocking(false)
    }
  }

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
        setKept(undefined)
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
  const lockControls = choosing ? (
    <section className={styles.lockPrompt} aria-label="是否锁定画布">
      <p>本轮是否锁定画布？</p>
      <p>锁定后其他成员只能查看。运行结束仍保持锁定，届时由你确认是否解锁。</p>
      {agentLock && <p>画布已锁定，选择保持协作不会解除现有锁；需要时请先手动解锁。</p>}
      <Button onClick={cancel}>取消</Button>
      <Button onClick={() => choose(false)}>保持协作并运行</Button>
      <Button type="primary" onClick={() => choose(true)}>
        锁定并运行
      </Button>
    </section>
  ) : agentLock?.can_unlock ? (
    <section className={styles.lockPrompt} aria-label="画布锁定状态">
      <p>
        {agentLock.running
          ? '画布已锁定，Agent 正在运行。'
          : kept === agentLock.id
            ? '已选择继续锁定，可随时手动解锁。'
            : '当前没有正在运行的 Agent，画布仍保持锁定。是否解锁？'}
      </p>
      {!agentLock.running && (
        <>
          <Button loading={unlocking} onClick={() => void unlock()}>
            解锁画布
          </Button>
          {kept !== agentLock.id && (
            <Button disabled={unlocking} onClick={() => setKept(agentLock.id)}>
              继续锁定
            </Button>
          )}
        </>
      )}
      {agentLock.running && <p>如需提前解锁，请先暂停本轮。</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  ) : null
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
      {mounted && (
        <div hidden={!opened}>
          <Suspense fallback={<div className={styles.loading}>正在连接 DoDo Agent…</div>}>
            <DeepAgentStudio
              workspaceId={workspaceId}
              canvasId={canvasId}
              modelDefaults={modelDefaults}
              authMode="business"
              chooseRunLock={chooseRunLock}
              canvasLockControls={lockControls}
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
