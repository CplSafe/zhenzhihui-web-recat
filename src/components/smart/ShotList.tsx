/**
 * ShotList — 左侧「分镜列表」(镜头编排 / 视频生成 两页共用)。
 * 每张卡:分镜图缩略图 + 分镜N | 时长 + 编辑(选中)/删除(hover) + 「…」菜单(插入/复制/删除) + 卡间「+」插入。
 * 受控:shots + selectedId + onSelect;增删改整列经 onShotsChange(由父级保存)。
 */
import { useEffect, useRef, useState } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import AiBadge from '@/components/common/AiBadge'
import InlineEdit from '@/components/common/InlineEdit'
import './ShotList.css'

interface ShotListProps {
  shots: Shot[]
  selectedId: string | number | null
  onSelect: (id: string | number) => void
  /** 正在生成分镜图/视频的镜头(键为 shot.id),显示转圈 */
  generating?: Record<string | number, boolean>
  onShotsChange: (shots: Shot[]) => void
  /** 卡右下角状态角标(如视频生成页:待生成/已生成) */
  badgeOf?: (shot: Shot) => string
  /** 锁定(视频生成页):禁用插入/复制/删除,仅保留选择查看 */
  locked?: boolean
  /** 该镜是否勾选「参与视频生成」(配合 onToggleInclude 在锁定态显示勾选框) */
  includeOf?: (shot: Shot) => boolean
  onToggleInclude?: (id: string | number) => void
}

let uid = 1
const newId = () => `s_${uid++}`

// "5s" / "08" → "0:05"
function formatDur(d: string): string {
  const n = parseInt(String(d || '').replace(/[^0-9]/g, ''), 10)
  if (!Number.isFinite(n) || n <= 0) return '0:05'
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}
function renumber(list: Shot[]): Shot[] {
  return list.map((s, i) => ({ ...s, no: `镜头${i + 1}` }))
}
function blankShot(): Shot {
  return { id: newId(), no: '镜头', duration: '5s', desc: '', subjects: [] }
}

export default function ShotList({
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

  return (
    <div className="shotlist">
      <div className="shotlist__title">分镜列表</div>
      {shots.map((s, i) => {
        // 只用「分镜图」做缩略图;没有则显示等待态(不退回素材图,避免误以为已生成)
        const thumb = s.image
        const included = includeOf ? includeOf(s) : true
        return (
          <div key={s.id}>
            <div
              className={`shotlist__card${s.id === selectedId ? ' is-active' : ''}${
                locked && includeOf && !included ? ' is-excluded' : ''
              }`}
              onClick={() => onSelect(s.id)}
            >
              <div className="shotlist__info">
                <span className="shotlist__no">{s.no}</span>
                <span className="shotlist__sep">|</span>
                <span className="shotlist__dur">{formatDur(s.duration)}</span>
                {/* 标题/备注:双击编辑、回车确认(空时显示「添加标题」),镜头编号固定不可改 */}
                <span className="shotlist__note" onClick={(e) => e.stopPropagation()}>
                  <InlineEdit
                    className="shotlist__note-ie"
                    value={s.title || ''}
                    placeholder="添加标题"
                    editable={!!onShotsChange}
                    maxLength={20}
                    onCommit={(v) => onShotsChange(shots.map((x) => (x.id === s.id ? { ...x, title: v.trim() } : x)))}
                  />
                </span>
                {badgeOf && <span className="shotlist__badge">{badgeOf(s)}</span>}
                {locked && includeOf && onToggleInclude && (
                  <label
                    className="shotlist__pick"
                    title={included ? '取消勾选则不参与视频生成' : '勾选以参与视频生成'}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => onToggleInclude(s.id)}
                    />
                  </label>
                )}
              </div>

              <div className="shotlist__thumb">
                {thumb ? (
                  <>
                    <img src={thumb} alt="" />
                    <AiBadge />
                  </>
                ) : (
                  <span className="shotlist__thumb-ph">{generating[s.id] ? '生成中…' : '待生成'}</span>
                )}
                {generating[s.id] && (
                  <div className="shotlist__gen">
                    <span className="shotlist__gen-spin" aria-hidden="true" />
                  </div>
                )}
                {!locked && (
                  <div className="shotlist__thumb-actions">
                    <button
                      type="button"
                      title="编辑"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(s.id)
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17v3z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(s.id)
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {!locked && (
                <div className="shotlist__more-wrap" ref={s.id === menuId ? menuWrapRef : undefined}>
                  <button
                    type="button"
                    className="shotlist__more"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuId(s.id === menuId ? null : s.id)
                    }}
                    aria-label="更多"
                  >
                    ⋯
                  </button>
                  {s.id === menuId && (
                    <div className="shotlist__menu" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => insertAt(i)}>
                        向上插入分镜
                      </button>
                      <button type="button" onClick={() => insertAt(i + 1)}>
                        向下插入分镜
                      </button>
                      <button type="button" onClick={() => duplicate(s.id)}>
                        复制分镜
                      </button>
                      <button type="button" className="is-danger" onClick={() => remove(s.id)}>
                        删除分镜
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {!locked && (
              <button type="button" className="shotlist__insert" onClick={() => insertAt(i + 1)} aria-label="插入分镜">
                +
              </button>
            )}
          </div>
        )
      })}
      {!shots.length && <div className="shotlist__empty">暂无分镜</div>}
    </div>
  )
}
