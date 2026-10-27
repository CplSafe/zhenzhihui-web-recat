/**
 * 画布快捷键与手势速查。
 *
 * 快捷键只有藏在按钮 title 里的时候等于没有——没人会一个个悬停去猜。
 * 一张表把「怎么平移、怎么框选、怎么复制」全列出来，用户第一次进画布看一眼就够了。
 * 内容是静态的：这里列的必须与 CanvasView 里真实绑定的按键一致，改一处要同步另一处。
 */
import { useEffect, useRef } from 'react'
import {
  CANVAS_MOD as MOD,
  CANVAS_ALT as ALT,
  CANVAS_IS_MAC,
  DEFAULT_CANVAS_SHORTCUTS,
  formatCanvasShortcut,
  type CanvasShortcutAction,
  type CanvasShortcutBindings,
} from '@/utils/canvasKeyboard'
import styles from './CanvasShortcutsHelp.module.css'
import { CANVAS_AUDIO_NODES_ENABLED } from '@/utils/canvasFeatureFlags'

interface ShortcutRow {
  keys: string[]
  label: string
  action?: CanvasShortcutAction
}

interface ShortcutSection {
  title: string
  rows: ShortcutRow[]
}

export const CANVAS_SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: '创作',
    rows: [
      { keys: [`${MOD} + G`, `${ALT} + G`], label: '成组（至少选中两个节点）' },
      { keys: [`${MOD} + ${ALT} + G`], label: '合并分镜组：将可用视频合并为视频剪辑' },
      { keys: [`${MOD} + Shift + G`, `${ALT} + Shift + G`], label: '解组' },
      { keys: [], action: 'connect', label: '连线：选中两个节点，按选择顺序连接' },
      { keys: [], action: 'duplicate', label: '复制节点和连线' },
      { keys: [`${MOD} + Enter`], label: '生成：发送当前节点面板（输入框外）' },
      { keys: [], action: 'add', label: '新建节点' },
      { keys: [`${ALT} + 拖动节点`], label: '节点复制：仅复制节点' },
      { keys: [`${MOD} + ${ALT} + 拖动`], label: '创建副本：复制节点及内部连线' },
    ],
  },
  {
    title: '缩放',
    rows: [
      { keys: [], action: 'zoomIn', label: '放大画布（支持 Ctrl 加号及小键盘）' },
      { keys: [], action: 'zoomOut', label: '缩小画布（支持小键盘）' },
      { keys: [], action: 'fitView', label: '适应画布：显示全部节点' },
      { keys: ['双指捏合'], label: '触控板缩放' },
      { keys: [`${MOD} + 滚轮`], label: '鼠标缩放' },
      { keys: [], action: 'resetZoom', label: '回到 100%' },
    ],
  },
  {
    title: '移动画布',
    rows: [
      { keys: ['空格 + 左键拖动'], label: '临时抓手：从节点或空白处平移' },
      { keys: ['双指滑动'], label: '触控板平移' },
      { keys: ['中键拖动', '右键拖动'], label: '鼠标平移' },
      { keys: [], action: 'selectTool', label: '移动 / 选择工具：拖动节点、框选' },
      { keys: [], action: 'panTool', label: '抓手工具：拖动整个画布' },
      { keys: [], action: 'arrange', label: '整理画布：选中节点优先，否则整理全部' },
      { keys: ['W / A / S / D'], label: '键盘平移（Shift 加速）' },
    ],
  },
  {
    title: '其他',
    rows: [
      { keys: [`${MOD} + Z`], label: '撤销' },
      { keys: [`${MOD} + Shift + Z`, `${MOD} + Y`], label: '重做' },
      { keys: [`${MOD} + F`], label: '画布节点搜索' },
      { keys: ['Delete', 'Backspace'], label: '删除选中的节点或连线' },
      { keys: [`${MOD} + C`, `${MOD} + V`], label: '复制 / 粘贴节点及内部连线' },
      { keys: [`${MOD} + A`], label: '全选节点' },
      { keys: [`${MOD} + 点击`], label: '加选 / 减选' },
      { keys: ['Esc'], label: '取消选择 / 关闭面板' },
      { keys: ['方向键'], label: '微移节点（Shift 大步移动）' },
      { keys: [`${ALT} + 点击`], label: '只选中分组内一个节点' },
      { keys: ['F2', '双击标题'], label: '重命名节点' },
      { keys: ['全屏快捷键模式'], label: '授权后接管浏览器保留键，Esc 退出全屏' },
      {
        keys: ['拖入文件', `${MOD} + V`],
        label: CANVAS_AUDIO_NODES_ENABLED ? '导入本地图片、视频或音频' : '导入本地图片或视频',
      },
    ],
  },
]

export interface CanvasShortcutsHelpProps {
  onClose: () => void
  shortcuts?: CanvasShortcutBindings
}

function displayedKeys(row: ShortcutRow, shortcuts: CanvasShortcutBindings): string[] {
  return row.action ? [formatCanvasShortcut(shortcuts[row.action])] : row.keys
}

export default function CanvasShortcutsHelp({
  onClose,
  shortcuts = DEFAULT_CANVAS_SHORTCUTS,
}: CanvasShortcutsHelpProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        event.preventDefault()
        dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className={styles.mask} role="dialog" aria-modal="true" aria-label="画布快捷键" onClick={onClose}>
      <div ref={dialogRef} className={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>画布快捷键 · {CANVAS_IS_MAC ? 'Mac' : 'Windows / Linux'}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <p className={styles.notice}>
          点击画布后快捷键生效；画布聚焦时 Tab 新建节点，输入框、按钮和弹窗保留正常焦点导航。Ctrl / ⌘ + L
          等浏览器保留键需开启全屏快捷键模式并授权。
        </p>
        <div className={styles.body}>
          {CANVAS_SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title} className={styles.section}>
              <h3 className={styles.sectionTitle}>{section.title}</h3>
              <dl className={styles.list}>
                {section.rows.map((row) => (
                  <div key={row.label} className={styles.row}>
                    <dt className={styles.keys}>
                      {displayedKeys(row, shortcuts).map((key, index) => (
                        <span key={key} className={styles.keyGroup}>
                          {index > 0 && <span className={styles.or}>或</span>}
                          <kbd className={styles.kbd}>{key}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd className={styles.label}>{row.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
