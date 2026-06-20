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
  const unprepared = subjects.filter((s) => !s.image)
  const uploaded = subjects.filter((s) => s.image && s.source !== 'ai')
  const ai = subjects.filter((s) => s.image && s.source === 'ai')

  return (
    <div className="smb">
      <div className="smb__title">素材主体</div>

      {unprepared.length > 0 && (
        <div className="smb__pending">
          <span className="smb__pending-label">待准备</span>
          <div className="smb__grid">
            {unprepared.map((s) => (
              <Card key={s.name} s={s} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}

      <div className="smb__cols">
        <div className="smb__col">
          <div className="smb__col-head">
            <span className="smb__dot smb__dot--upload" />
            用户上传素材
          </div>
          {uploaded.length ? (
            <div className="smb__grid">
              {uploaded.map((s) => (
                <Card key={s.name} s={s} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <div className="smb__empty">暂无</div>
          )}
        </div>
        <div className="smb__col">
          <div className="smb__col-head">
            <span className="smb__dot smb__dot--ai" />
            AI 生成素材
          </div>
          {ai.length ? (
            <div className="smb__grid">
              {ai.map((s) => (
                <Card key={s.name} s={s} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <div className="smb__empty">暂无</div>
          )}
        </div>
      </div>
    </div>
  )
}
