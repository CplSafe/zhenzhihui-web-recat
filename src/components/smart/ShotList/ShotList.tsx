/**
 * ShotList — 左侧「分镜列表」(镜头编排 / 视频生成 两页共用,UI 还原 Figma 343-3740)。
 * 头部:分镜列表 + 数量徽标;每行:序号圆标 + 100×100 缩略图 + 分镜N/时长药丸。
 * 选中:绿色渐变左条 + 浅青底,序号/标题/时长转青色。增删改/插入/复制在「⋯」菜单里。
 * 整卡可上下拖拽排序(@dnd-kit;激活距离避免与点击选中冲突,锁定态禁用拖拽)。
 * 受控:shots + selectedId + onSelect;整列变更经 onShotsChange(由父级保存)。
 */
import { useEffect, useRef, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Shot } from '../ScriptStoryboardTable'
import AiBadge from '@/components/common/AiBadge'
import styles from './ShotList.module.less'

interface ShotListProps {
  /** 额外类名:父组件控制布局(如 VideoStage 收窄列宽) */
  className?: string
  shots: Shot[]
  selectedId: string | number | null
  onSelect: (id: string | number) => void
  /** 正在生成分镜图/视频的镜头(键为 shot.id),显示转圈 */
  generating?: Record<string | number, boolean>
  onShotsChange: (shots: Shot[]) => void
  /** 卡右下角状态角标(如视频生成页:待生成/已生成) */
  badgeOf?: (shot: Shot) => string
  /** 锁定(视频生成页):禁用插入/复制/删除/拖拽,仅保留选择查看 */
  locked?: boolean
  /** 该镜是否勾选「参与视频生成」(配合 onToggleInclude 在锁定态显示勾选框) */
  includeOf?: (shot: Shot) => boolean
  onToggleInclude?: (id: string | number) => void
}

let uid = 1
const newId = () => `s_${uid++}`

// "5s" / "4" / "3.5s" → "4.0s"(保留一位小数,对齐 Figma)
function formatDur(d: string): string {
  const n = parseFloat(String(d || '').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return '5.0s'
  return `${n.toFixed(1)}s`
}
function renumber(list: Shot[]): Shot[] {
  return list.map((s, i) => ({ ...s, no: `镜头${i + 1}` }))
}
function blankShot(): Shot {
  return { id: newId(), no: '镜头', duration: '5s', desc: '', subjects: [] }
}

/** 单行分镜卡(可拖拽);抽成模块级组件以便每行各自调用 useSortable 钩子 */
interface SortableCardProps {
  shot: Shot
  index: number
  total: number
  selectedId: string | number | null
  generating: Record<string | number, boolean>
  badgeOf?: (shot: Shot) => string
  locked?: boolean
  dragEnabled: boolean
  includeOf?: (shot: Shot) => boolean
  onToggleInclude?: (id: string | number) => void
  onSelect: (id: string | number) => void
  menuId: string | number | null
  setMenuId: (id: string | number | null) => void
  menuWrapRef: React.RefObject<HTMLDivElement>
  insertAt: (idx: number) => void
  duplicate: (id: string | number) => void
  remove: (id: string | number) => void
}

function SortableCard({
  shot: s,
  index: i,
  total,
  selectedId,
  generating,
  badgeOf,
  locked,
  dragEnabled,
  includeOf,
  onToggleInclude,
  onSelect,
  menuId,
  setMenuId,
  menuWrapRef,
  insertAt,
  duplicate,
  remove,
}: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
    disabled: !dragEnabled,
  })
  // 只用「分镜图」做缩略图;没有则显示等待态(不退回素材图,避免误以为已生成)
  const thumb = s.image
  const included = includeOf ? includeOf(s) : true

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${styles.card}${s.id === selectedId ? ' ' + styles.active : ''}${
        locked && includeOf && !included ? ' ' + styles.excluded : ''
      }${isDragging ? ' ' + styles.dragging : ''}`}
      onClick={() => onSelect(s.id)}
      {...attributes}
      {...listeners}
    >
      <span className={styles.num}>{i + 1}</span>

      <div className={styles.thumb}>
        {thumb ? (
          <>
            <img src={thumb} alt="" draggable={false} />
            <AiBadge />
          </>
        ) : (
          <span className={styles.thumbPh}>{generating[s.id] ? '生成中…' : '待生成'}</span>
        )}
        {locked && includeOf && onToggleInclude && (
          <label
            className={styles.pick}
            title={included ? '取消勾选则不参与视频生成' : '勾选以参与视频生成'}
            onClick={(e) => e.stopPropagation()}
          >
            <input type="checkbox" checked={included} onChange={() => onToggleInclude(s.id)} />
          </label>
        )}
        {generating[s.id] && (
          <div className={styles.gen}>
            <span className={styles.genSpin} aria-hidden="true" />
          </div>
        )}
      </div>

      <div className={styles.meta}>
        <span className={styles.no}>{s.no}</span>
        <span className={styles.dur}>{formatDur(s.duration)}</span>
        {badgeOf && <span className={styles.badge}>{badgeOf(s)}</span>}
      </div>

      {!locked && !generating[s.id] && (
        <div className={styles.moreWrap} ref={s.id === menuId ? menuWrapRef : undefined}>
          <button
            type="button"
            className={styles.more}
            onClick={(e) => {
              e.stopPropagation()
              setMenuId(s.id === menuId ? null : s.id)
            }}
            aria-label="更多"
          >
            ⋯
          </button>
          {s.id === menuId && (
            <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => insertAt(i)}>
                向上插入分镜
              </button>
              <button type="button" onClick={() => insertAt(i + 1)}>
                向下插入分镜
              </button>
              <button type="button" onClick={() => duplicate(s.id)}>
                复制分镜
              </button>
              <button type="button" className={styles.danger} onClick={() => remove(s.id)}>
                删除分镜
              </button>
            </div>
          )}
        </div>
      )}

      {/* 两个分镜之间的小加号:点击在此处插入新分镜(hover 显示) */}
      {!locked && i < total - 1 && (
        <button
          type="button"
          className={styles.insert}
          title="在此插入分镜"
          aria-label="在此插入分镜"
          // 拖拽监听在卡片根上,阻止 pointerdown 冒泡避免按加号时误触发拖拽
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            insertAt(i + 1)
          }}
        >
          +
        </button>
      )}
    </div>
  )
}

export default function ShotList({
  className,
  shots,
  selectedId,
  onSelect,
  generating = {},
  onShotsChange,
  badgeOf,
  locked,
  includeOf,
  onToggleInclude,
}: ShotListProps) {
  const [menuId, setMenuId] = useState<string | number | null>(null)
  const menuWrapRef = useRef<HTMLDivElement>(null)

  // 激活距离 6px:轻点 = 选中,拖动 = 排序,二者互不干扰
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const dragEnabled = !locked && shots.length > 1

  useEffect(() => {
    if (menuId == null) return
    const onDown = (e: PointerEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) setMenuId(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [menuId])

  const commit = (list: Shot[]) => onShotsChange(renumber(list))
  const indexOf = (id: any) => shots.findIndex((s) => s.id === id)
  const insertAt = (idx: number) => {
    const list = shots.slice()
    const s = blankShot()
    list.splice(idx, 0, s)
    commit(list)
    onSelect(s.id)
    setMenuId(null)
  }
  const duplicate = (id: any) => {
    const i = indexOf(id)
    if (i < 0) return
    const copy: Shot = { ...shots[i], id: newId(), subjects: shots[i].subjects.map((x) => ({ ...x })) }
    const list = shots.slice()
    list.splice(i + 1, 0, copy)
    commit(list)
    onSelect(copy.id)
    setMenuId(null)
  }
  const remove = (id: any) => {
    commit(shots.filter((s) => s.id !== id))
    setMenuId(null)
  }
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = indexOf(active.id)
    const to = indexOf(over.id)
    if (from < 0 || to < 0) return
    commit(arrayMove(shots, from, to))
  }

  return (
    <div className={`${styles.shotlist}${className ? ' ' + className : ''}`}>
      <div className={styles.header}>
        <span className={styles.title}>分镜列表</span>
        {shots.length > 0 && <span className={styles.count}>{shots.length}</span>}
      </div>

      <div className={styles.scroll}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={shots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {shots.map((s, i) => (
              <SortableCard
                key={s.id}
                shot={s}
                index={i}
                total={shots.length}
                selectedId={selectedId}
                generating={generating}
                badgeOf={badgeOf}
                locked={locked}
                dragEnabled={dragEnabled}
                includeOf={includeOf}
                onToggleInclude={onToggleInclude}
                onSelect={onSelect}
                menuId={menuId}
                setMenuId={setMenuId}
                menuWrapRef={menuWrapRef}
                insertAt={insertAt}
                duplicate={duplicate}
                remove={remove}
              />
            ))}
          </SortableContext>
        </DndContext>
        {!shots.length && <div className={styles.empty}>暂无分镜</div>}
      </div>
    </div>
  )
}
