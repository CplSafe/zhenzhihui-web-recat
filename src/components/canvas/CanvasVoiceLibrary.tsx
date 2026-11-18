import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { ConfigProvider, Modal } from 'antd'
import type { ModelParamField } from '@/utils/modelSchema'
import type { ModelVoiceValue } from '@/utils/modelVoices'
import CanvasPortalBoundary from './CanvasPortalBoundary'
import type { Voice } from '@/api/voices'
import styles from './CanvasVoiceLibrary.module.css'

const ServerVoiceLibrary = lazy(() => import('./ServerVoiceLibrary'))
// 音色库与局部浮层共用 2200 基准；Select 继续按父容器派生层级，避免越过默认 token 范围。
const voiceLibraryTheme = { token: { zIndexPopupBase: 2200 } }

interface Props {
  userId: string
  workspaceId: number
  modelName: string
  fields: ModelParamField[]
  values: Record<string, unknown>
  disabled: boolean
  modelVersionId?: number
  canManage?: boolean
  onSelectVoice?: (voice: Voice) => void
  initialTab?: 'model' | 'samples' | 'custom'
  onApply: (values: Record<string, ModelVoiceValue>) => void
  onUpload: (file: File) => Promise<boolean>
  onReference: (assetId: number, title: string) => Promise<boolean>
  onClose: () => void
}

export default function CanvasVoiceLibrary({
  userId,
  workspaceId,
  disabled,
  modelVersionId,
  canManage = false,
  onSelectVoice,
  onClose,
}: Props) {
  const [serverBusy, setServerBusy] = useState(false)
  const beforeClose = useRef<(() => Promise<boolean>) | null>(null)
  const setBeforeClose = useCallback((guard: (() => Promise<boolean>) | null) => {
    beforeClose.current = guard
  }, [])
  const close = async () => {
    if (serverBusy) return
    if (beforeClose.current && !(await beforeClose.current())) return
    onClose()
  }
  const modal = (
    <Modal
      zIndex={voiceLibraryTheme.token.zIndexPopupBase}
      open
      centered
      title="音色库"
      width={900}
      onCancel={() => {
        void close()
      }}
      closable={!serverBusy}
      maskClosable={!serverBusy}
      keyboard={!serverBusy}
      footer={null}
      className="nodrag nopan nowheel canvas-ui-dialog"
      modalRender={(modal) => <CanvasPortalBoundary>{modal}</CanvasPortalBoundary>}
      styles={{
        body: {
          display: 'flex',
          maxHeight: 'calc(100dvh / var(--canvas-ui-scale, 1) - 160px)',
          overflow: 'hidden',
        },
      }}
    >
      <div
        className={styles.library}
        onPlayCapture={(event) => {
          event.currentTarget.querySelectorAll('audio').forEach((audio) => {
            if (audio !== event.target) audio.pause()
          })
        }}
      >
        <p className={styles.intro}>浏览系统音色、我的音色与收藏，为当前配音模型选择合适的声音。</p>
        <div className={styles.content}>
          <Suspense fallback={<p role="status">正在加载公共音色库…</p>}>
            <ServerVoiceLibrary
              key={`${userId}:${workspaceId}:${modelVersionId || 0}`}
              userId={userId}
              workspaceId={workspaceId}
              modelVersionId={modelVersionId}
              browseOnly
              canManage={canManage}
              disabled={disabled || !onSelectVoice}
              onBusyChange={setServerBusy}
              onBeforeCloseChange={setBeforeClose}
              onSelect={(voice) => {
                onSelectVoice?.(voice)
                onClose()
              }}
            />
          </Suspense>
        </div>
        <footer className={styles.footer}>
          <span>选用音色后将应用到当前节点</span>
          <button type="button" className={styles.secondary} disabled={serverBusy} onClick={() => void close()}>
            关闭
          </button>
        </footer>
      </div>
    </Modal>
  )
  return <ConfigProvider theme={voiceLibraryTheme}>{modal}</ConfigProvider>
}
