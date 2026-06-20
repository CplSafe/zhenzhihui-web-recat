/**
 * SubjectMaterialBoard — 顶部「素材主体」总览(脚本步)。
 * 把本页所有去重后的主体素材汇总:左=用户上传、右=AI 生成,未准备的单列一行。
 * 点任一主体卡 → 打开统一素材弹窗管理(与分镜里同源,同名联动)。
 */
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
}

function Card({ s, onOpen }: { s: BoardSubject; onOpen: (n: string) => void }) {
  return (
    <button type="button" className="smb__card" onClick={() => onOpen(s.name)} title="管理素材">
      <div className="smb__thumb">
        {s.image ? <img src={s.image} alt="" /> : <span className="smb__plus">+</span>}
      </div>
      <div className="smb__meta">
        <span className="smb__name">@{s.name}</span>
        {s.kind && <span className="smb__kind">{s.kind}</span>}
      </div>
    </button>
  )
}

export default function SubjectMaterialBoard({ subjects, onOpen }: SubjectMaterialBoardProps) {
  if (!subjects.length) return null
  return (
    <div className="smb">
      <div className="smb__title">素材主体</div>
      <div className="smb__grid">
        {subjects.map((s) => (
          <Card key={s.name} s={s} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}
