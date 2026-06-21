/**
 * SubjectMaterialBoard — 顶部「素材」总览(脚本步)。
 * 一行内合并展示:用户上传的入口素材 + 各主体素材 + 「+」继续添加(上传不多时不再单占一行,省空间)。
 * 点任一卡片打开统一素材弹窗管理(同名联动)。图片失效(签名过期)时优雅回退占位,不显示破图。
 */
import { useState } from 'react'
import AiBadge from '@/components/common/AiBadge'
import './SubjectMaterialBoard.css'

export interface BoardSubject {
  name: string
  kind?: string
  image?: string
  source?: 'ai' | 'upload' | null
}

interface SubjectMaterialBoardProps {
  subjects: BoardSubject[]
  onOpen: (name: string) => void
  /** 用户上传的入口素材(原图 url),作为前置卡片一并展示 */
  uploads?: string[]
  /** 「+」继续添加素材 */
  onAdd?: () => void
}

// 图片失效(签名 URL 过期等)→ 回退占位,避免破图
function Thumb({ src, alt }: { src?: string; alt?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <span className="smb__plus">+</span>
  return <img src={src} alt={alt || ''} loading="lazy" onError={() => setBroken(true)} />
}

function SubjectCard({ s, onOpen }: { s: BoardSubject; onOpen: (n: string) => void }) {
  const isUser = s.source === 'upload'
  return (
    <button type="button" className="smb__card" onClick={() => onOpen(s.name)} title="管理素材">
      <div className={`smb__thumb${isUser && s.image ? ' smb__thumb--user' : ''}`}>
        <Thumb src={s.image} alt={s.name} />
        {s.image && s.source === 'ai' && <AiBadge size={16} />}
        {isUser && s.image && <span className="smb__user-tag">用户</span>}
      </div>
      <div className="smb__meta">
        <span className="smb__name">@{s.name}</span>
        {s.kind && <span className="smb__kind">{s.kind}</span>}
      </div>
    </button>
  )
}

export default function SubjectMaterialBoard({ subjects, onOpen, uploads = [], onAdd }: SubjectMaterialBoardProps) {
  if (!subjects.length && !uploads.length && !onAdd) return null
  // 去重:入口上传图若已作为某主体图出现,则不重复显示
  const subjectImages = new Set(subjects.map((s) => s.image).filter(Boolean) as string[])
  const dedupUploads = uploads.filter((u) => u && !subjectImages.has(u))

  return (
    <div className="smb">
      <div className="smb__title">素材</div>
      <div className="smb__grid">
        {onAdd && (
          <button type="button" className="smb__card smb__card--add" onClick={onAdd} title="添加素材">
            <div className="smb__thumb smb__thumb--add">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <div className="smb__meta">
              <span className="smb__name">添加素材</span>
            </div>
          </button>
        )}
        {dedupUploads.map((url, i) => (
          <div className="smb__card smb__card--upload" key={`up-${i}`} title="用户上传素材">
            <div className="smb__thumb smb__thumb--user">
              <Thumb src={url} />
              <span className="smb__user-tag">用户</span>
            </div>
            <div className="smb__meta">
              <span className="smb__name">用户素材</span>
            </div>
          </div>
        ))}
        {subjects.map((s) => (
          <SubjectCard key={s.name} s={s} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}
