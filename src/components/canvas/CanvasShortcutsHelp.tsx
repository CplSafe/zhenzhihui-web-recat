/**
 * 画布快捷键与手势速查。
 *
 * 快捷键只有藏在按钮 title 里的时候等于没有——没人会一个个悬停去猜。
 * 一张表把「怎么平移、怎么框选、怎么复制」全列出来，用户第一次进画布看一眼就够了。
 * 内容是静态的：这里列的必须与 CanvasView 里真实绑定的按键一致，改一处要同步另一处。
 */
import { useEffect } from 'react'
import styles from './CanvasShortcutsHelp.module.css'

interface ShortcutRow {
  keys: string[]
  label: string
}

interface ShortcutSection {
  title: string
  rows: ShortcutRow[]
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
const MOD = IS_MAC ? '⌘' : 'Ctrl'

export const CANVAS_SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: '画布导航',
    rows: [
      { keys: ['滚轮'], label: '平移画布（可在设置里改成缩放）' },
      { keys: [`${MOD} + 滚轮`, '双指捏合'], label: '缩放' },
      { keys: ['空格 + 拖拽', '中键拖拽', '右键拖拽'], label: '平移画布' },
      { keys: ['工具栏「拖动」'], label: '抓手模式：左键拖空白处也平移（框选改为 Shift + 拖拽）' },
      { keys: ['W / A / S / D'], label: '键盘平移（按住 Shift 加速）' },
      { keys: ['E', 'Q'], label: '放大 / 缩小' },
      { keys: ['0'], label: '回到 100%' },
      { keys: ['1'], label: '适应视图：缩放到刚好装下全部节点' },
    ],
  },
  {
    title: '选择与移动',
    rows: [
      { keys: ['空白处拖拽'], label: '框选节点' },
      { keys: [`${MOD} + 点击`], label: '加选 / 减选' },
      { keys: [`${MOD} + A`], label: '全选节点' },
      { keys: ['Esc'], label: '取消选择 / 关闭面板' },
      { keys: ['方向键'], label: '微移选中的节点（按住 Shift 大步移动）' },
      { keys: ['Alt + 点击'], label: '只选中分组里的这一个节点' },
    ],
  },
  {
    title: '节点操作',
    rows: [
      { keys: ['右键空白处', 'Tab'], label: '添加节点' },
      { keys: [`${MOD} + C`, `${MOD} + V`], label: '复制 / 粘贴节点（含它们之间的连线）' },
      { keys: [`${MOD} + D`], label: '生成副本' },
      { keys: ['Alt + 拖拽节点'], label: '拖出一份副本，原节点留在原地' },
      { keys: ['F2', '双击标题'], label: '重命名节点' },
      { keys: ['Delete', 'Backspace'], label: '删除选中的节点或连线' },
      { keys: [`${MOD} + Z`, `${MOD} + Shift + Z`], label: '撤销 / 重做' },
      { keys: ['拖出连线到空白处'], label: '直接新建并连接下一个节点' },
      { keys: ['多选后拖出连线'], label: '把选中的几个节点一次连到同一个目标' },
      { keys: [`${MOD} + F`], label: '搜索 / 定位节点' },
      { keys: ['拖入文件', `${MOD} + V`], label: '导入本地图片或视频' },
    ],
  },
]

export interface CanvasShortcutsHelpProps {
  onClose: () => void
}

export default function CanvasShortcutsHelp({ onClose }: CanvasShortcutsHelpProps) {
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

  return (
    <div className={styles.mask} role="dialog" aria-modal="true" aria-label="画布快捷键" onClick={onClose}>
      <div className={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>画布快捷键</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className={styles.body}>
          {CANVAS_SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title} className={styles.section}>
              <h3 className={styles.sectionTitle}>{section.title}</h3>
              <dl className={styles.list}>
                {section.rows.map((row) => (
                  <div key={row.label} className={styles.row}>
                    <dt className={styles.keys}>
                      {row.keys.map((key, index) => (
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
