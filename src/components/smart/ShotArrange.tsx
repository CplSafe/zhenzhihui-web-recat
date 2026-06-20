/**
 * ShotArrange — 镜头编排(2.1)。
 * 左:分镜列表(选中 / hover 编辑·删除 / 「…」菜单:向上插入·向下插入·复制·删除 / +插入)。
 * 右:镜头内容修改(画面描述 / 台词 / 字幕 / 音效,均可 AI 润色)。
 * 受控:shots + onShotsChange(整列变更后由父级保存)。
 */
import { useEffect, useRef, useState } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import MaterialEditPanel from './MaterialEditPanel'
import SubjectMaterialBoard, { type BoardSubject } from './SubjectMaterialBoard'
import './ShotArrange.css'

interface ShotArrangeProps {
  shots: Shot[]
  /** 正在生成分镜图的镜头(键为 shot.id) */
  generating?: Record<string | number, boolean>
  /** 顶部素材主体总览(可新增/编辑/重生成素材) */
  subjects?: BoardSubject[]
  onOpenSubject?: (name: string) => void
  onShotsChange: (shots: Shot[]) => void
  onRegenerateShot?: (shot: Shot) => void
}

let uid = 1
const newId = () => `s_${uid++}`

// "5s" / "08" → "0:05"(mm:ss)
function formatDur(d: string): string {
  const n = parseInt(String(d || '').replace(/[^0-9]/g, ''), 10)
  if (!Number.isFinite(n) || n <= 0) return '0:05'
  const mm = Math.floor(n / 60)
  const ss = n % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

function renumber(list: Shot[]): Shot[] {
  return list.map((s, i) => ({ ...s, no: `镜头${i + 1}` }))
}
function blankShot(): Shot {
  return { id: newId(), no: '镜头', duration: '5s', desc: '', subjects: [] }
}

export default function ShotArrange({
  shots,
  generating = {},
  subjects = [],
  onOpenSubject,
  onShotsChange,
  onRegenerateShot,
}: ShotArrangeProps) {
  const [selectedId, setSelectedId] = useState<string | number | null>(shots[0]?.id ?? null)
  const [menuId, setMenuId] = useState<string | number | null>(null)
  const menuWrapRef = useRef<HTMLDivElement>(null)

  // 选中项失效时回退到第一个
  useEffect(() => {
    if (!shots.some((s) => s.id === selectedId)) setSelectedId(shots[0]?.id ?? null)
  }, [shots, selectedId])

  useEffect(() => {
    if (menuId == null) return
    const onDown = (e: PointerEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) setMenuId(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [menuId])

  const selected = shots.find((s) => s.id === selectedId) || null

  const commit = (list: Shot[]) => onShotsChange(renumber(list))
  const indexOf = (id: any) => shots.findIndex((s) => s.id === id)

  const insertAt = (idx: number) => {
    const list = shots.slice()
    const s = blankShot()
    list.splice(idx, 0, s)
    commit(list)
    setSelectedId(s.id)
    setMenuId(null)
  }
  const duplicate = (id: any) => {
    const i = indexOf(id)
    if (i < 0) return
    const copy: Shot = { ...shots[i], id: newId(), subjects: shots[i].subjects.map((x) => ({ ...x })) }
    const list = shots.slice()
    list.splice(i + 1, 0, copy)
    commit(list)
    setSelectedId(copy.id)
    setMenuId(null)
  }
  const remove = (id: any) => {
    commit(shots.filter((s) => s.id !== id))
    setMenuId(null)
  }
  const patchSelected = (patch: Partial<Shot>) => {
    if (!selected) return
    commit(shots.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)))
  }

  return (
    <div className="shotarr-wrap">
      {/* 顶部素材主体总览(可新增/编辑/重生成素材,再回去重生成分镜图) */}
      {onOpenSubject && <SubjectMaterialBoard subjects={subjects} onOpen={onOpenSubject} />}

      <div className="shotarr">
      {/* 左:分镜列表 */}
      <div className="shotarr__list">
        <div className="shotarr__list-title">分镜列表</div>
        {shots.map((s, i) => {
          const thumb = s.image || s.subjects.find((x) => x.image)?.image
          return (
            <div key={s.id}>
              <div
                className={`shotarr__card${s.id === selectedId ? ' is-active' : ''}`}
                onClick={() => setSelectedId(s.id)}
              >
                {/* 左:分镜N | 时长 */}
                <div className="shotarr__info">
                  <span className="shotarr__no">{s.no}</span>
                  <span className="shotarr__sep">|</span>
                  <span className="shotarr__dur">{formatDur(s.duration)}</span>
                </div>

                {/* 右:缩略图 + 右下角 编辑/删除(hover) */}
                <div className="shotarr__thumb">
                  {thumb ? <img src={thumb} alt="" /> : <span className="shotarr__thumb-ph">{s.no}</span>}
                  {generating[s.id] && (
                    <div className="shotarr__gen">
                      <span className="shotarr__gen-spin" aria-hidden="true" />
                      生成中…
                    </div>
                  )}
                  <div className="shotarr__thumb-actions">
                    <button
                      type="button"
                      title="编辑"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedId(s.id)
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
                </div>

                {/* … 菜单 */}
                <div className="shotarr__more-wrap" ref={s.id === menuId ? menuWrapRef : undefined}>
                  <button
                    type="button"
                    className="shotarr__more"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuId(s.id === menuId ? null : s.id)
                    }}
                    aria-label="更多"
                  >
                    ⋯
                  </button>
                  {s.id === menuId && (
                    <div className="shotarr__menu" onClick={(e) => e.stopPropagation()}>
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
              </div>
              {/* 两分镜间 + 插入 */}
              <button type="button" className="shotarr__insert" onClick={() => insertAt(i + 1)} aria-label="插入分镜">
                +
              </button>
            </div>
          )
        })}
        {!shots.length && <div className="shotarr__empty">暂无分镜</div>}
      </div>

      {/* 右:素材修改(素材/历史/素材描述/台词/字幕/音效) */}
      <div className="shotarr__editor">
        {selected ? (
          <MaterialEditPanel
            shot={selected}
            onPatch={patchSelected}
            onRegenerate={onRegenerateShot}
            regenerating={!!generating[selected.id]}
          />
        ) : (
          <div className="shotarr__empty">请选择左侧分镜进行编辑</div>
        )}
      </div>
      </div>
    </div>
  )
}
