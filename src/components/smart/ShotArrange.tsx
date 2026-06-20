/**
 * ShotArrange — 镜头编排(2.1)。
 * 左:分镜列表(选中 / hover 编辑·删除 / 「…」菜单:向上插入·向下插入·复制·删除 / +插入)。
 * 右:镜头内容修改(画面描述 / 台词 / 字幕 / 音效,均可 AI 润色)。
 * 受控:shots + onShotsChange(整列变更后由父级保存)。
 */
import { useEffect, useRef, useState } from 'react'
import type { Shot } from './ScriptStoryboardTable'
import EditField from './EditField'
import './ShotArrange.css'

interface ShotArrangeProps {
  shots: Shot[]
  onShotsChange: (shots: Shot[]) => void
}

let uid = 1
const newId = () => `s_${uid++}`

function renumber(list: Shot[]): Shot[] {
  return list.map((s, i) => ({ ...s, no: `镜头${i + 1}` }))
}
function blankShot(): Shot {
  return { id: newId(), no: '镜头', duration: '5s', desc: '', subjects: [] }
}

export default function ShotArrange({ shots, onShotsChange }: ShotArrangeProps) {
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
    <div className="shotarr">
      {/* 左:分镜列表 */}
      <div className="shotarr__list">
        <div className="shotarr__list-title">分镜列表</div>
        {shots.map((s, i) => (
          <div key={s.id}>
            <div
              className={`shotarr__card${s.id === selectedId ? ' is-active' : ''}`}
              onClick={() => setSelectedId(s.id)}
            >
              <div className="shotarr__thumb">
                {s.image || s.subjects.find((x) => x.image)?.image ? (
                  <img src={s.image || s.subjects.find((x) => x.image)?.image} alt="" />
                ) : (
                  <span className="shotarr__thumb-ph">{s.no}</span>
                )}
                {/* hover:编辑/删除 居中放大并排 */}
                <div className="shotarr__hover">
                  <button
                    type="button"
                    className="shotarr__hover-btn"
                    title="编辑"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(s.id)
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17v3z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="shotarr__hover-btn shotarr__hover-btn--danger"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(s.id)
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="shotarr__meta">
                <span className="shotarr__no">{s.no}</span>
                <span className="shotarr__dur">{s.duration}</span>
              </div>
              <div className="shotarr__desc" title={s.desc}>
                {s.desc || '画面描述'}
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
        ))}
        {!shots.length && <div className="shotarr__empty">暂无分镜</div>}
      </div>

      {/* 右:镜头内容修改 */}
      <div className="shotarr__editor">
        <div className="shotarr__list-title">
          镜头内容修改 {selected && <span className="shotarr__editor-hint">（{selected.no}）</span>}
        </div>
        {selected ? (
          <>
            <EditField
              label="画面描述"
              value={selected.desc || ''}
              onChange={(v) => patchSelected({ desc: v })}
              kind="script"
              placeholder="这一镜头的画面、运镜、节奏…"
              rows={4}
            />
            <EditField
              label="台词 / 旁白"
              value={selected.line || ''}
              onChange={(v) => patchSelected({ line: v })}
              kind="line"
              placeholder="这一镜头的台词/旁白…"
            />
            <EditField
              label="字幕"
              value={selected.subtitle || ''}
              onChange={(v) => patchSelected({ subtitle: v })}
              kind="subtitle"
              placeholder="这一镜头的字幕…"
            />
            <EditField
              label="音效"
              value={selected.sfx || ''}
              onChange={(v) => patchSelected({ sfx: v })}
              kind="sound"
              placeholder="这一镜头的音效…"
            />
          </>
        ) : (
          <div className="shotarr__empty">请选择左侧分镜进行编辑</div>
        )}
      </div>
    </div>
  )
}
