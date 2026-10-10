/**
 * 画布设置面板：交互习惯 + 生成通知。
 *
 * 只放「因人而异、没有标准答案」的开关：滚轮该平移还是缩放、要不要辅助线、生成完要不要通知。
 * 有标准答案的（比如吸附网格）继续留在视图控制条上一键切换，不进这里绕两层。
 * 所有值经 canvasPreferences 落本机，不进云端。
 */
import { useEffect, useState } from 'react'
import styles from './CanvasSettingsPanel.module.css'
import type { CanvasPreferences } from '@/utils/canvasPreferences'
import {
  CANVAS_SHORTCUT_LABELS,
  CANVAS_RESERVED_SHORTCUTS,
  DEFAULT_CANVAS_SHORTCUTS,
  formatCanvasShortcut,
  shortcutFromKeyboardEvent,
  type CanvasShortcutAction,
} from '@/utils/canvasKeyboard'
import {
  ensureNotificationPermission,
  getNotificationPermission,
  playNotificationSound,
  showGenerationNotification,
} from '@/utils/generationNotifier'

export interface CanvasSettingsPanelProps {
  preferences: CanvasPreferences
  onChange: (patch: Partial<CanvasPreferences>) => void
  onReset: () => void
  onClose: () => void
}

export default function CanvasSettingsPanel({ preferences, onChange, onReset, onClose }: CanvasSettingsPanelProps) {
  const [permission, setPermission] = useState(getNotificationPermission)
  const [recordingAction, setRecordingAction] = useState<CanvasShortcutAction | null>(null)
  const [shortcutError, setShortcutError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  /** 打开「完成通知」时顺手申请权限：开关开了却收不到，用户只会以为功能坏了 */
  const toggleNotify = async (enabled: boolean) => {
    if (enabled) {
      const next = await ensureNotificationPermission()
      setPermission(next)
    }
    onChange({ notifyOnComplete: enabled })
  }

  const testNotification = () => {
    if (preferences.notifySound) playNotificationSound('success')
    showGenerationNotification({
      title: '帧智汇画布',
      body: '这是一条测试通知：生成完成后你会收到这样的提醒',
      tag: 'canvas-test',
    })
  }

  const permissionHint =
    permission === 'unsupported'
      ? '当前浏览器不支持桌面通知'
      : permission === 'denied'
        ? '浏览器已拒绝通知权限，需在地址栏的站点设置里重新允许'
        : permission === 'default'
          ? '开启后浏览器会请求一次通知权限'
          : ''

  const shortcutActions = Object.keys(DEFAULT_CANVAS_SHORTCUTS) as CanvasShortcutAction[]
  const recordShortcut = (action: CanvasShortcutAction, event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecordingAction(null)
      setShortcutError('')
      return
    }
    const binding = shortcutFromKeyboardEvent(event.nativeEvent)
    if (!binding) {
      setShortcutError('请按一个非 Tab / Esc 的完整快捷键')
      return
    }
    if (CANVAS_RESERVED_SHORTCUTS.has(binding)) {
      setShortcutError('该快捷键已被浏览器或画布固定操作占用，请换一个组合')
      return
    }
    const duplicate = shortcutActions.find(
      (candidate) => candidate !== action && preferences.shortcuts[candidate] === binding,
    )
    if (duplicate) {
      setShortcutError(`该快捷键已用于“${CANVAS_SHORTCUT_LABELS[duplicate]}”`)
      return
    }
    onChange({ shortcuts: { ...preferences.shortcuts, [action]: binding } })
    setRecordingAction(null)
    setShortcutError('')
  }

  return (
    <div className={styles.mask} role="dialog" aria-modal="true" aria-label="画布设置" onClick={onClose}>
      <div className={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>画布设置</h2>
          <div className={styles.headerActions}>
            <button type="button" className={styles.reset} onClick={onReset}>
              恢复默认
            </button>
            <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </div>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>交互操作</h3>

            <Row label="滚轮默认操作" hint="按住 Ctrl/⌘ 滚动始终是缩放">
              <Segmented
                value={preferences.wheelMode}
                options={[
                  { value: 'pan', label: '平移' },
                  { value: 'zoom', label: '缩放' },
                ]}
                onChange={(wheelMode) => onChange({ wheelMode })}
                ariaLabel="滚轮默认操作"
              />
            </Row>

            <Row label="空白处打开添加菜单" hint="右键随时可用；改成双击后右键仍保留">
              <Segmented
                value={preferences.paneMenuTrigger}
                options={[
                  { value: 'contextmenu', label: '右键' },
                  { value: 'dblclick', label: '双击' },
                ]}
                onChange={(paneMenuTrigger) => onChange({ paneMenuTrigger })}
                ariaLabel="空白处打开添加菜单"
              />
            </Row>

            <Row label="对齐辅助线" hint="拖动节点时与相邻节点的边或中线对齐并吸附">
              <Switch
                checked={preferences.alignmentGuides}
                onChange={(alignmentGuides) => onChange({ alignmentGuides })}
                ariaLabel="对齐辅助线"
              />
            </Row>

            <Row label="连线悬停高亮">
              <Switch
                checked={preferences.edgeHoverHighlight}
                onChange={(edgeHoverHighlight) => onChange({ edgeHoverHighlight })}
                ariaLabel="连线悬停高亮"
              />
            </Row>

            <Row label="仅突出焦点连线" hint="选中节点时只把与它相连的连线画清楚，其余淡化">
              <Switch
                checked={preferences.focusEdgesOnly}
                onChange={(focusEdgesOnly) => onChange({ focusEdgesOnly })}
                ariaLabel="仅突出焦点连线"
              />
            </Row>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>自定义快捷键</h3>
            <p className={styles.sectionHint}>点击快捷键后直接按下新的按键组合；设置保存在当前浏览器。</p>
            <div className={styles.shortcutList}>
              {shortcutActions.map((action) => (
                <div key={action} className={styles.shortcutRow}>
                  <span className={styles.rowLabel}>{CANVAS_SHORTCUT_LABELS[action]}</span>
                  <button
                    type="button"
                    className={`${styles.shortcutButton} ${recordingAction === action ? styles.shortcutRecording : ''}`}
                    aria-label={`修改${CANVAS_SHORTCUT_LABELS[action]}快捷键`}
                    aria-pressed={recordingAction === action}
                    onClick={() => {
                      setRecordingAction(action)
                      setShortcutError('')
                    }}
                    onKeyDown={(event) => recordingAction === action && recordShortcut(action, event)}
                  >
                    {recordingAction === action ? '请按新快捷键…' : formatCanvasShortcut(preferences.shortcuts[action])}
                  </button>
                </div>
              ))}
            </div>
            {shortcutError ? (
              <p className={styles.shortcutError} role="alert">
                {shortcutError}
              </p>
            ) : null}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>生成通知</h3>

            <Row label="生成完成时通知" hint={permissionHint || '切到别的标签页或窗口时发桌面通知'}>
              <Switch
                checked={preferences.notifyOnComplete}
                disabled={permission === 'unsupported'}
                onChange={(enabled) => void toggleNotify(enabled)}
                ariaLabel="生成完成时通知"
              />
            </Row>

            <Row label="生成失败也通知">
              <Switch
                checked={preferences.notifyOnFail}
                disabled={!preferences.notifyOnComplete}
                onChange={(notifyOnFail) => onChange({ notifyOnFail })}
                ariaLabel="生成失败也通知"
              />
            </Row>

            <Row label="提示音" hint="完成或失败时响一声，页面在前台也会响">
              <Switch
                checked={preferences.notifySound}
                onChange={(notifySound) => onChange({ notifySound })}
                ariaLabel="提示音"
              />
            </Row>

            <div className={styles.rowActions}>
              <button type="button" className={styles.secondary} onClick={testNotification}>
                试听 / 发一条测试通知
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {hint && <span className={styles.rowHint}>{hint}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

function Switch({
  checked,
  disabled,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchKnob} />
    </button>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`${styles.segment} ${option.value === value ? styles.segmentActive : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
