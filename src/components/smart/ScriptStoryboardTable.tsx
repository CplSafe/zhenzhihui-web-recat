/**
 * ScriptStoryboardTable — 分镜脚本表(按 Figma 79:4123)。
 * 列:镜头编号 / 镜头时长 / 画面描述 / 准备素材。
 * 准备素材按脚本拆出的主体(人物/场景)分行,每行:@主体 + 上传(+) + AI自动生成。
 */
import './ScriptStoryboardTable.css'

export interface ShotSubject {
  tag: string // 如 @小雅 / @室内场景
  kind?: string // 人物 / 场景
  image?: string // AI 匹配到的素材图(或用户上传);无则展示「+」
  assetId?: number // 该素材图的后端 asset_id(持久化/刷新签名URL用)
}
export interface Shot {
  id: string | number
  no: string // 镜头1
  duration: string // 5s
  desc: string // 画面描述
  subjects: ShotSubject[]
  // 镜头编排阶段可编辑的脚本词
  matDesc?: string // 素材描述/修改建议
  line?: string // 台词/旁白
  subtitle?: string // 字幕
  sfx?: string // 音效
  image?: string // 当前分镜图(成片画面)
  imageAssetId?: number // 当前分镜图的后端 asset_id
  imagePrompt?: string // 生成该分镜图实际用到的提示词(可见/可编辑/可重生成)
  imageVersions?: string[] // 分镜图历史版本
  videoUrl?: string // 该镜生成的视频片段
  videoAssetId?: number
}

interface ScriptStoryboardTableProps {
  shots: Shot[]
  /** 打开某主体的素材管理弹窗(同名主体共享);autoGen=true 表示无版本时自动生成一次 */
  onOpenSubject?: (name: string, autoGen?: boolean) => void
}

export default function ScriptStoryboardTable({ shots, onOpenSubject }: ScriptStoryboardTableProps) {
  return (
    <div className="sbt">
      <div className="sbt__head">
        <div className="sbt__c sbt__c--no">镜头编号</div>
        <div className="sbt__c sbt__c--dur">镜头时长</div>
        <div className="sbt__c sbt__c--desc">画面描述</div>
        <div className="sbt__c sbt__c--mat">准备素材</div>
      </div>

      {shots.map((shot) => (
        <div className="sbt__row" key={shot.id}>
          <div className="sbt__c sbt__c--no">{shot.no}</div>
          <div className="sbt__c sbt__c--dur">{shot.duration}</div>
          <div className="sbt__c sbt__c--desc">{shot.desc}</div>
          <div className="sbt__c sbt__c--mat">
            {shot.subjects.map((s, idx) => {
              const name = s.tag.replace(/^@/, '').trim()
              return (
                <div className="sbt__subj" key={`${s.tag}-${idx}`}>
                  <div className="sbt__subj-info">
                    <span className="sbt__subj-tag">{s.tag}</span>
                    {s.kind && <span className="sbt__subj-kind">{s.kind}</span>}
                  </div>
                  {s.image ? (
                    <button type="button" className="sbt__thumb" onClick={() => onOpenSubject?.(name)} title="管理素材">
                      <img src={s.image} alt="" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="sbt__upload"
                      onClick={() => onOpenSubject?.(name)}
                      aria-label={`为 ${s.tag} 准备素材`}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                  )}
                  <button type="button" className="sbt__aigen" onClick={() => onOpenSubject?.(name, true)}>
                    AI自动生成
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
