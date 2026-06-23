/**
 * ScriptStoryboardTable — 分镜脚本(表格式,还原 Figma 299:2524)。
 * 圆角卡片容器 + 渐变表头(镜头编号/时长/画面描述[/准备素材]) + 行(圆形序号+镜头名、时长药丸、画面描述) + 表尾「共 N 个镜头」。
 * 时长/画面描述双击可编辑(受控 onShotsChange,缺省只读)。
 * showSubjects=false:分镜脚本阶段隐藏「准备素材」列;materialMode:准备素材阶段每个主体「@名称 + AI自动生成 + 上传图片」(图二)。
 */
import InlineEdit from '@/components/common/InlineEdit'
import EllipsisText from '@/components/common/EllipsisText'
import aiSparkIcon from '@/assets/icons/ai-spark.svg'
import materialUploadIcon from '@/assets/icons/material-upload.svg'
import regenerateIcon from '@/assets/icons/regenerate.svg'
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
  /** 编辑回写(时长/画面描述);缺省则只读 */
  onShotsChange?: (next: Shot[]) => void
  /**
   * 是否显示「准备素材」列。分镜脚本阶段传 false 隐藏;准备素材阶段传 true,
   * 列内每个主体按图二「@名称 + AI自动生成 + 上传图片」展示。默认显示。
   */
  showSubjects?: boolean
  /** 正在 AI 自动出图的主体名集合(按画面描述生成时,上传框显示转圈) */
  generating?: Record<string, boolean>
  /** 点击主体的「AI自动生成」:按画面描述为该主体出图(点一个生成一个) */
  onGenerateSubject?: (name: string, kind: string) => void
  /** 提供则在「画面描述」表头右侧显示「↻ 重新生成」(分镜脚本阶段;准备素材阶段不传) */
  onRegenerate?: () => void
  /** 重新生成进行中:禁用表头的重新生成按钮 */
  regenerating?: boolean
  /** 该镜头没有主体素材时,点击「上传图片」为它添加一个素材(准备素材阶段) */
  onAddMaterial?: (shot: Shot) => void
}

const stripAt = (t: string) =>
  String(t || '')
    .replace(/^@/, '')
    .trim()

export default function ScriptStoryboardTable({
  shots,
  onOpenSubject,
  onShotsChange,
  showSubjects = true,
  generating = {},
  onGenerateSubject,
  onRegenerate,
  regenerating = false,
  onAddMaterial,
}: ScriptStoryboardTableProps) {
  const editable = !!onShotsChange
  const patchShot = (id: Shot['id'], p: Partial<Shot>) =>
    onShotsChange?.(shots.map((s) => (s.id === id ? { ...s, ...p } : s)))

  return (
    <div className={styles.sbTable}>
      {/* 表头(渐变) */}
      <div className={styles.sbHead}>
        <div className={`${styles.sbHeadCell} ${styles.sbColNo}`}>镜头编号</div>
        <div className={`${styles.sbHeadCell} ${styles.sbColDur}`}>时长</div>
        <div className={`${styles.sbHeadCell} ${styles.sbColDesc}`}>画面描述</div>
        {showSubjects && <div className={`${styles.sbHeadCell} ${styles.sbColMat}`}>准备素材</div>}
      </div>

      {/* 行 */}
      <div className={styles.sbBody}>
        {shots.map((shot, i) => (
          <div className={styles.sbRow} key={shot.id}>
            {/* 镜头编号:圆形序号 + 镜头名 */}
            <div className={`${styles.sbCell} ${styles.sbColNo}`}>
              <span className={styles.sbNoBadge}>{i + 1}</span>
              <span className={styles.sbNoLabel}>{shot.no}</span>
            </div>

            {/* 时长:青色药丸(可编辑) */}
            <div className={`${styles.sbCell} ${styles.sbColDur}`}>
              <span className={styles.sbDurPill}>
                <InlineEdit
                  className={styles.sbDurVal}
                  value={String(shot.duration || '').replace(/[^0-9.]/g, '')}
                  numeric
                  placeholder="—"
                  editable={editable}
                  onCommit={(v) => patchShot(shot.id, { duration: v ? `${v}s` : '' })}
                />
                <span className={styles.sbDurUnit}>s</span>
              </span>
            </div>

            {/* 画面描述(可编辑) */}
            <div className={`${styles.sbCell} ${styles.sbColDesc}`}>
              <InlineEdit
                className={styles.sbDesc}
                value={shot.desc || ''}
                multiline
                placeholder="双击添加画面描述…"
                editable={editable}
                onCommit={(v) => patchShot(shot.id, { desc: v })}
              />
            </div>

            {/* 准备素材(materialMode=图二:@名称 + AI自动生成 + 上传图片) */}
            {showSubjects && (
              <div className={`${styles.sbCell} ${styles.sbColMat}`}>
                <div className={styles.sbcMatList}>
                  {shot.subjects.map((su, idx) => {
                    const name = stripAt(su.tag)
                    return (
                      <div className={styles.sbcMatRow} key={`${su.tag}-${idx}`}>
                        <div className={styles.sbcMatInfo}>
                          <EllipsisText
                            className={styles.sbcMatName}
                            text={`@${name}`}
                            title={su.kind ? `@${name}（${su.kind}）` : `@${name}`}
                          />
                          <button
                            type="button"
                            className={styles.sbcMatBadge}
                            disabled={generating[name]}
                            title="按画面描述生成该素材"
                            onClick={() => onGenerateSubject?.(name, su.kind || '')}
                          >
                            <img className={styles.sbcMatBadgeIcon} src={aiSparkIcon} alt="" width={12} height={12} />
                            AI自动生成
                          </button>
                        </div>
                        <button
                          type="button"
                          className={styles.sbcMatUpload}
                          title={generating[name] ? 'AI 生成中…' : '上传图片'}
                          onClick={() => onOpenSubject?.(name)}
                        >
                          {generating[name] ? (
                            <>
                              <span className={styles.sbcMatSpin} aria-hidden="true" />
                              <span className={styles.sbcMatUploadText}>生成中…</span>
                            </>
                          ) : su.image ? (
                            <img className={styles.sbcMatUploadImg} src={su.image} alt={name} />
                          ) : (
                            <>
                              <img src={materialUploadIcon} alt="" width={20} height={20} />
                              <span className={styles.sbcMatUploadText}>上传图片</span>
                            </>
                          )}
                        </button>
                      </div>
                    )
                  })}
                  {/* 该镜头无主体素材:给一个上传入口,点击后为它添加素材 */}
                  {shot.subjects.length === 0 && onAddMaterial && (
                    <button
                      type="button"
                      className={styles.sbcMatUpload}
                      title="为该镜头上传素材"
                      onClick={() => onAddMaterial(shot)}
                    >
                      <img src={materialUploadIcon} alt="" width={20} height={20} />
                      <span className={styles.sbcMatUploadText}>上传图片</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 表尾:分镜脚本阶段(传 onRegenerate)显示「重新生成」,其余阶段显示「共 N 个镜头」 */}
      <div className={styles.sbFoot}>
        {onRegenerate ? (
          <button
            type="button"
            className={styles.sbRegen}
            disabled={regenerating}
            onClick={onRegenerate}
            title="按当前需求重新生成分镜脚本"
          >
            <img src={regenerateIcon} alt="" width={16} height={16} />
            {regenerating ? '生成中…' : '重新生成'}
          </button>
        ) : (
          `共 ${shots.length} 个镜头`
        )}
      </div>
    </div>
  )
}
