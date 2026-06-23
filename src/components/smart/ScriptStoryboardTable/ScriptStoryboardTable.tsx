/**
 * ScriptStoryboardTable — 分镜脚本(卡片式,可编辑)。
 * 每个分镜一张卡:镜头名称 / 时长(秒) / 画面描述 均可改;准备素材(@主体)可增删、改名、选类型、出图。
 * 受控:shots + onShotsChange(整列回写,父级持久化)。onOpenSubject 用于打开素材管理/AI生成。
 */
import InlineEdit from '@/components/common/InlineEdit'
import EllipsisText from '@/components/common/EllipsisText'
import styles from './ScriptStoryboardTable.module.less'

export interface ShotSubject {
  tag: string // 如 @小雅 / @室内场景
  kind?: string // 人物 / 物体 / 场景
  image?: string // AI 匹配到的素材图(或用户上传);无则展示「+」
  assetId?: number // 该素材图的后端 asset_id(持久化/刷新签名URL用)
}
export interface Shot {
  id: string | number
  no: string // 镜头1(固定,定顺序,不可改)
  title?: string // 用户给该镜头的标题/备注(默认空,可在脚本/编排/视频步添加)
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
  // 该镜「素材编辑态」(持久化,刷新/切换不丢):选中参与出图的素材 url + 额外添加的素材
  selectedRefs?: string[] // 当前选中参与出图的素材 url(元素图 + extraRefs)
  extraRefs?: { url: string; assetId?: number }[] // 额外添加的素材(项目选/上传)
  // 每版带 asset_id(供水合刷新签名URL)+ 该版用到的提示词与素材 url
  imageVersions?: { url: string; assetId: number; prompt?: string; refs?: string[] }[]
  // 人脸脱敏(正式出视频前对分镜图脱敏):脱敏版图 + asset_id,以及它脱敏自哪张原图(缓存有效性判定)
  blurredImageUrl?: string
  blurredImageAssetId?: number
  blurredFromAssetId?: number // 该脱敏版对应的原图 asset_id;原图变了(重生成)则缓存失效需重做
  videoUrl?: string // 该镜生成的视频片段
  videoAssetId?: number
  // 视频生成页:是否勾选「参与视频生成」(undefined/true=参与,false=不参与)
  includeInVideo?: boolean
}

interface ScriptStoryboardTableProps {
  shots: Shot[]
  /** 打开某主体的素材管理弹窗(同名主体共享);autoGen=true 表示无版本时自动生成一次 */
  onOpenSubject?: (name: string, autoGen?: boolean) => void
  /** 编辑回写(镜头名/时长/画面描述/主体增删改);缺省则只读 */
  onShotsChange?: (next: Shot[]) => void
}

const stripAt = (t: string) =>
  String(t || '')
    .replace(/^@/, '')
    .trim()

export default function ScriptStoryboardTable({ shots, onOpenSubject, onShotsChange }: ScriptStoryboardTableProps) {
  const editable = !!onShotsChange
  const patchShot = (id: Shot['id'], p: Partial<Shot>) =>
    onShotsChange?.(shots.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const patchSubjects = (shot: Shot, subjects: ShotSubject[]) => patchShot(shot.id, { subjects })

  return (
    <div className={styles.sbc}>
      {shots.map((shot) => (
        <div className={styles.sbcCard} key={shot.id}>
          {/* 头部:镜头编号(固定,定顺序)+ 标题(可双击编辑)+ 时长(秒) */}
          <div className={styles.sbcHead}>
            <span className={styles.sbcNo}>{shot.no}</span>
            <InlineEdit
              className={styles.sbcTitle}
              value={shot.title || ''}
              placeholder="添加标题"
              editable={editable}
              maxLength={20}
              onCommit={(v) => patchShot(shot.id, { title: v.trim() })}
            />
            <span className={styles.sbcDur}>
              <InlineEdit
                className={styles.sbcDurVal}
                value={String(shot.duration || '').replace(/[^0-9.]/g, '')}
                numeric
                placeholder="—"
                editable={editable}
                onCommit={(v) => patchShot(shot.id, { duration: v ? `${v}s` : '' })}
              />
              <span className={styles.sbcDurUnit}>秒</span>
            </span>
          </div>

          {/* 画面描述(双击编辑,回车确认) */}
          <div className={styles.sbcField}>
            <div className={styles.sbcLabel}>画面描述</div>
            <InlineEdit
              className={styles.sbcDesc}
              value={shot.desc || ''}
              multiline
              placeholder="双击添加画面描述…"
              editable={editable}
              onCommit={(v) => patchShot(shot.id, { desc: v })}
            />
          </div>

          {/* 准备素材(@主体,卡片网格,可增删改) */}
          <div className={styles.sbcField}>
            <div className={styles.sbcLabel}>准备素材</div>
            <div className={styles.sbcSubjects}>
              {shot.subjects.map((su, idx) => {
                const name = stripAt(su.tag)
                // 浏览态:整卡点击进入素材管理(改类型 / 替换 / 生成);不在卡上放下拉框与 AI 按钮
                return (
                  <div
                    className={styles.sbcSubj}
                    key={`${su.tag}-${idx}`}
                    role="button"
                    tabIndex={0}
                    title="点击管理该主体素材"
                    onClick={() => onOpenSubject?.(name)}
                    onKeyDown={(e) => e.key === 'Enter' && onOpenSubject?.(name)}
                  >
                    {editable && (
                      <button
                        type="button"
                        className={styles.sbcSubjDel}
                        aria-label="删除主体"
                        title="删除主体"
                        onClick={(e) => {
                          e.stopPropagation()
                          patchSubjects(
                            shot,
                            shot.subjects.filter((_, i) => i !== idx),
                          )
                        }}
                      >
                        ×
                      </button>
                    )}
                    <div className={styles.sbcSubjThumb}>
                      {su.image ? (
                        <img src={su.image} alt={name} />
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      )}
                    </div>
                    <div className={styles.sbcSubjTagline}>
                      <span className={styles.sbcAt}>@</span>
                      <EllipsisText
                        className={styles.sbcSubjName}
                        text={name}
                        title={su.kind ? `@${name}（${su.kind}）` : `@${name}`}
                      />
                      {su.kind && <span className={styles.sbcSubjKindtag}>{su.kind}</span>}
                    </div>
                  </div>
                )
              })}
              {editable && (
                <button
                  type="button"
                  className={styles.sbcSubjAdd}
                  onClick={() => patchSubjects(shot, [...shot.subjects, { tag: '@新主体', kind: '' }])}
                >
                  <span>+</span>
                  添加主体
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
