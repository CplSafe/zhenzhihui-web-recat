import { lazy, Suspense, useId, useState } from 'react'
import { ConfigProvider, Modal } from 'antd'
import type { ModelParamField } from '@/utils/modelSchema'
import { getModelVoiceOptions, type ModelVoiceValue } from '@/utils/modelVoices'
import VoiceSamplePanel from './VoiceSamplePanel'
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
  modelName,
  fields,
  values,
  disabled,
  modelVersionId,
  canManage = false,
  onSelectVoice,
  onApply,
  onUpload,
  onReference,
  onClose,
}: Props) {
  const [tab] = useState<'model' | 'samples' | 'custom'>('custom')
  const [search, setSearch] = useState('')
  const [serverBusy, setServerBusy] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...values }))
  const id = useId()
  const selectable = fields.filter((field) => getModelVoiceOptions(field).length > 0)
  const valid =
    selectable.length > 0 &&
    selectable.every((field) => {
      const value = draft[field.name]
      return (
        (!field.required && (value === undefined || value === '')) ||
        getModelVoiceOptions(field).some((option) => Object.is(option.value, value))
      )
    })
  const apply = () => {
    if (disabled || !valid) return
    const next: Record<string, ModelVoiceValue> = {}
    for (const field of selectable) {
      const option = getModelVoiceOptions(field).find((item) => Object.is(item.value, draft[field.name]))
      if (option) next[field.name] = option.value
    }
    onApply(next)
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
        if (!serverBusy) onClose()
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
        <div id={`${id}-content`} className={styles.content}>
          {tab === 'model' && (
            <>
              <div className={styles.heading}>
                <div>
                  <strong>{modelName || '请先选择音频模型'}</strong>
                  <p>仅展示当前模型提供的选项；确认后用于报价及配音生成。</p>
                </div>
                <span className={styles.tag}>模型目录</span>
              </div>
              {selectable.length > 0 ? (
                <>
                  <input
                    className={styles.search}
                    aria-label="搜索模型音色"
                    placeholder="搜索音色名称或编号"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {selectable.map((field) => {
                    const options = getModelVoiceOptions(field).filter((option) =>
                      `${option.label} ${option.value}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
                    )
                    return (
                      <fieldset className={styles.group} key={field.name}>
                        <legend>
                          {String(field.displayName || '配音音色')}
                          {field.required ? ' *' : ''}
                        </legend>
                        <div className={styles.grid}>
                          {options.map((option, index) => (
                            <label
                              className={styles.card}
                              key={`${typeof option.value}:${option.value}`}
                              data-selected={Object.is(draft[field.name], option.value)}
                            >
                              <input
                                type="radio"
                                name={`${id}-${field.name}`}
                                checked={Object.is(draft[field.name], option.value)}
                                disabled={disabled}
                                onChange={() => setDraft((previous) => ({ ...previous, [field.name]: option.value }))}
                              />
                              <span className={styles.avatar} aria-hidden="true">
                                {option.label.slice(0, 1)}
                              </span>
                              <span className={styles.details}>
                                <strong>{option.label}</strong>
                                <small>{String(option.value)}</small>
                              </span>
                              <span className={styles.check} aria-hidden="true">
                                {Object.is(draft[field.name], option.value) ? '✓' : String(index + 1).padStart(2, '0')}
                              </span>
                            </label>
                          ))}
                        </div>
                        {!options.length && (
                          <p className={styles.empty} role="status">
                            没有匹配的音色，请换个关键词。
                          </p>
                        )}
                      </fieldset>
                    )
                  })}
                  <p className={styles.note}>
                    模型目录暂未提供音色试听地址，可选用后生成配音。这里只调整音色，不会发起生成。
                  </p>
                </>
              ) : (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon} aria-hidden="true">
                    ♫
                  </span>
                  <strong>当前模型未提供可选音色列表</strong>
                  <p>可切换模型，或在“声音样本”中添加参考音频。音色默认参数仍沿用模型配置。</p>
                </div>
              )}
            </>
          )}
          {tab === 'samples' &&
            (userId ? (
              <VoiceSamplePanel
                userId={userId}
                workspaceId={workspaceId}
                disabled={disabled}
                onUpload={onUpload}
                onReference={onReference}
                onClose={onClose}
              />
            ) : (
              <p role="status">请登录后使用声音样本库。</p>
            ))}
          {tab === 'custom' && (
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
                onSelect={(voice) => {
                  onSelectVoice?.(voice)
                  onClose()
                }}
              />
            </Suspense>
          )}
        </div>
        <footer className={styles.footer}>
          <span>选用音色后将应用到当前节点</span>
          <button type="button" className={styles.secondary} disabled={serverBusy} onClick={onClose}>
            关闭
          </button>
          {tab === 'model' && (
            <button type="button" className={styles.primary} disabled={disabled || !valid} onClick={apply}>
              确认使用
            </button>
          )}
        </footer>
      </div>
    </Modal>
  )
  return <ConfigProvider theme={voiceLibraryTheme}>{modal}</ConfigProvider>
}
