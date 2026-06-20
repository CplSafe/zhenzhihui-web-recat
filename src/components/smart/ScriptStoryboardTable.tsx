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
  image?: string // 选用的素材图(素材历史可切换)
}

interface ScriptStoryboardTableProps {
  shots: Shot[]
  /** 正在 AI 生成的主体,键为 `${shotId}:${subjectIndex}` */
  generating?: Record<string, boolean>
  onUpload?: (shot: Shot, subject: ShotSubject, subjectIndex: number) => void
  onAiGenerate?: (shot: Shot, subject: ShotSubject, subjectIndex: number) => void
}

export default function ScriptStoryboardTable({
  shots,
  generating = {},
  onUpload,
  onAiGenerate,
}: ScriptStoryboardTableProps) {
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
            {shot.subjects.map((s, idx) => (
              <div className="sbt__subj" key={`${s.tag}-${idx}`}>
                <span className="sbt__subj-tag" title={s.kind}>
                  {s.tag}
                </span>
                {s.image ? (
                  <button
                    type="button"
                    className="sbt__thumb"
                    onClick={() => onUpload?.(shot, s, idx)}
                    title="点击替换素材"
                  >
                    <img src={s.image} alt="" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sbt__upload"
                    onClick={() => onUpload?.(shot, s, idx)}
                    aria-label={`为 ${s.tag} 上传素材`}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  className="sbt__aigen"
                  disabled={!!generating[`${shot.id}:${idx}`]}
                  onClick={() => onAiGenerate?.(shot, s, idx)}
                >
                  {generating[`${shot.id}:${idx}`] ? '生成中…' : 'AI自动生成'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
