/**
 * ScriptStoryboardTable — 分镜脚本(表格式,还原 Figma 299:2524)。
 * 圆角卡片容器 + 渐变表头(镜头编号/时长/画面描述[/准备素材]) + 行(圆形序号+镜头名、时长药丸、画面描述) + 表尾「共 N 个镜头」。
 * 时长单击可编辑;可由父级选择把时长限制延后到步骤确认时统一校验。画面描述双击可编辑(受控 onShotsChange,缺省只读)。
 * showSubjects=false:分镜脚本阶段隐藏「准备素材」列;materialMode:准备素材阶段每个主体「@名称 + AI自动生成 + 上传图片」(图二)。
 */
import { Fragment, useMemo, useRef, useState } from 'react'
import InlineEdit from '@/components/common/InlineEdit'
import EllipsisText from '@/components/common/EllipsisText'
import { useToast } from '@/composables/useToast'
import { requestConfirm } from '@/stores/ui'
import ShotTrashBin, { type ShotTrashItem } from '../ShotTrashBin/ShotTrashBin'
import aiSparkIcon from '@/assets/icons/ai-spark.svg'
import materialUploadIcon from '@/assets/icons/material-upload.svg'
import regenerateIcon from '@/assets/icons/regenerate.svg'
import styles from './ScriptStoryboardTable.module.less'

/** 分镜中一个人物、物体或场景主体及其素材生成/参考图状态。 */
export interface ShotSubject {
  tag: string // 如 @小雅 / @室内场景
  kind?: string // 人物 / 物体 / 场景
  image?: string // AI 匹配到的素材图(或用户上传);无则展示「+」
  assetId?: number // 该素材图的后端 asset_id(持久化/刷新签名URL用)
  // 主推产品锚定:该主体应「以这张用户上传素材为参考做图生图」(保真还原产品),而非纯文生图。
  // 有 refImage 的主体:不参与合并;生成时走图生图(从上传素材抠成干净单品)。
  refImage?: string // 参考用的上传素材图(签名URL/ dataURL);多张时取第一张供展示
  refAssetId?: number // 主参考图的后端 asset_id(持久化/刷新签名URL用)
  refAssetIds?: number[] // 同一产品的多张上传素材 asset_id(多图归组时全部作图生图参考)
  // VL 没能把上传素材匹配到任何现有主体时「注入的主推产品」标记:排除出「AI一键生成」批量,须用户手动生成。
  manualGen?: boolean
}
/**
 * 智能成片各步骤共享的镜头模型。
 * 除脚本字段外还承载分镜图版本、编辑素材、人脸脱敏结果和视频片段，以便草稿完整恢复。
 */
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
  // 镜头编排阶段「插入的新分镜」标记:仅这类分镜显示「生成分镜」按钮(带新描述全量重生成);
  // 一旦该镜生成出图即清除。
  isNew?: boolean
}

/** 分镜表格的受控镜头数据及素材生成、编辑、删除和回收站回调。 */
interface ScriptStoryboardTableProps {
  shots: Shot[]
  /** 打开某主体的素材管理弹窗(同名主体共享);autoGen=true 表示无版本时自动生成一次 */
  onOpenSubject?: (name: string, autoGen?: boolean) => void
  /** 编辑回写(时长/画面描述);缺省则只读 */
  onShotsChange?: (next: Shot[]) => void
  /** 在指定行边界插入一条新分镜;index 范围为 0..shots.length。 */
  onInsertShot?: (index: number) => void
  /** 脚本/素材生成期间保留加号但禁止插入,避免异步结果覆盖手工新增内容。 */
  insertDisabled?: boolean
  /** 新增分镜的 AI 分镜词生成状态;键为 shot.id。 */
  shotTextGenerating?: Record<string, boolean>
  /** 分镜脚本阶段延后到「确认脚本」再统一校验时长;编辑数字时只保存正数。 */
  deferDurationValidation?: boolean
  /**
   * 是否显示「准备素材」列。分镜脚本阶段传 false 隐藏;准备素材阶段传 true,
   * 列内每个主体按图二「@名称 + AI自动生成 + 上传图片」展示。默认显示。
   */
  showSubjects?: boolean
  /** 提供则在「画面描述」表头右侧显示「↻ 重新生成」(分镜脚本阶段;准备素材阶段不传) */
  onRegenerate?: () => void
  /** 重新生成进行中:禁用表头的重新生成按钮 */
  regenerating?: boolean
  /** 该镜头没有主体素材时,点击「AI自动生成」为它加占位主体并自动生成(准备素材阶段) */
  onGenerateMaterial?: (shot: Shot) => void
  /** 提供则「AI自动生成」直接后台生成该主体(可并发,不阻塞);缺省回退打开素材弹窗 */
  onGenerateSubject?: (name: string) => void
  /** 各主体是否正在生成(键为主体名),用于显示「生成中…」 */
  subjectGenerating?: Record<string, boolean>
  /** 提供则在「准备素材」表头右侧显示「AI一键生成图片」:批量为【还没有图】的主体生成(已上传/已生成的跳过) */
  onGenerateAll?: () => void
  /** 一键批量生成进行中:按钮置「生成中…」并禁用 */
  batchGenning?: boolean
  /** 提供则在已有图的素材缩略图右上角显示「×」,点击去掉该主体当前的图(回到占位,可重新生成/上传) */
  onRemoveSubject?: (name: string) => void
  /** 删除整条分镜(分镜脚本/准备素材阶段) */
  onDeleteShot?: (shot: Shot, index: number) => Promise<void> | void
  trashItems?: ShotTrashItem[]
  trashLoading?: boolean
  onLoadTrash?: () => Promise<void> | void
  onRestoreTrash?: (item: ShotTrashItem) => Promise<void> | void
  onDeleteTrash?: (item: ShotTrashItem) => Promise<void> | void
  onRestoreAllTrash?: (items: ShotTrashItem[]) => Promise<void> | void
  onClearTrash?: (items: ShotTrashItem[]) => Promise<void> | void
}

/** 去掉主体名称开头的 @，用于无标记展示与查找。 */
const stripAt = (t: string) =>
  String(t || '')
    .replace(/^@/, '')
    .trim()

interface VisibleShotSubject {
  subject: ShotSubject
  name: string
  originalIndex: number
}

/**
 * 准备素材按分镜顺序只展示每个主体的首次出现。
 * 这里只收敛展示，不修改 shot.subjects，保证后续镜头编排仍能读取每个镜头的完整主体关系。
 */
const collectFirstVisibleSubjects = (shots: Shot[]): VisibleShotSubject[][] => {
  const seenNames = new Set<string>()

  return shots.map((shot) =>
    shot.subjects.reduce<VisibleShotSubject[]>((visible, subject, originalIndex) => {
      const name = stripAt(subject.tag)
      if (name && seenNames.has(name)) return visible
      if (name) seenNames.add(name)
      visible.push({ subject, name, originalIndex })
      return visible
    }, []),
  )
}

/** 从“5s”等输入中提取可校验的秒数。 */
const durationSeconds = (value: unknown) => {
  const parsed = Number(String(value || '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/** 同一镜头快速重复操作的最短间隔。 */
const RAPID_ACTION_GUARD_MS = 400

/** 渲染可编辑分镜脚本，并协调素材生成、快速操作防抖和删除到回收站流程。 */
export default function ScriptStoryboardTable({
  shots,
  onOpenSubject,
  onShotsChange,
  onInsertShot,
  insertDisabled = false,
  shotTextGenerating = {},
  deferDurationValidation = false,
  showSubjects = true,
  onRegenerate,
  regenerating = false,
  onGenerateMaterial,
  onGenerateSubject,
  subjectGenerating,
  onGenerateAll,
  batchGenning = false,
  onRemoveSubject,
  onDeleteShot,
  trashItems = [],
  trashLoading = false,
  onLoadTrash,
  onRestoreTrash,
  onDeleteTrash,
  onRestoreAllTrash,
  onClearTrash,
}: ScriptStoryboardTableProps) {
  const { showToast } = useToast()
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const recentActionsRef = useRef(new Map<string, number>())
  const deletingShotsRef = useRef(new Set<Shot['id']>())
  const editable = !!onShotsChange
  const visibleSubjectsByShot = useMemo(
    () => (showSubjects ? collectFirstVisibleSubjects(shots) : []),
    [shots, showSubjects],
  )
  const patchShot = (id: Shot['id'], p: Partial<Shot>) =>
    onShotsChange?.(shots.map((s) => (s.id === id ? { ...s, ...p } : s)))
  // 同一行按钮在短时间内只执行一次，防止触控 click 合成或连点重复创建/删除镜头。
  const runRapidActionOnce = (key: string, action: () => void) => {
    const now = Date.now()
    const previous = recentActionsRef.current.get(key)
    if (previous !== undefined && now - previous < RAPID_ACTION_GUARD_MS) return
    recentActionsRef.current.set(key, now)
    action()
  }
  const insertSlot = (index: number, label: string, visible = false) =>
    onInsertShot ? (
      <div className={styles.sbInsertSlot}>
        <button
          type="button"
          className={`${styles.sbInsertButton}${visible ? ` ${styles.sbInsertButtonVisible}` : ''}`}
          disabled={insertDisabled}
          title={insertDisabled ? '生成进行中，暂时不能新增分镜' : label}
          aria-label={label}
          onClick={() => onInsertShot(index)}
        >
          +
        </button>
      </div>
    ) : null

  return (
    <div className={styles.sbWrap}>
      <div className={styles.sbTable}>
        {/* 表头(渐变) */}
        <div className={styles.sbHead}>
          <div className={`${styles.sbHeadCell} ${styles.sbColNo}`}>镜头编号</div>
          <div className={`${styles.sbHeadCell} ${styles.sbColDur}`}>时长</div>
          <div className={`${styles.sbHeadCell} ${styles.sbColDesc}`}>画面描述</div>
          {showSubjects && (
            <div className={`${styles.sbHeadCell} ${styles.sbColMat}`}>
              <span>准备素材</span>
              {onGenerateAll && (
                <button
                  type="button"
                  className={styles.sbHeadGen}
                  disabled={batchGenning}
                  aria-label={batchGenning ? '批量素材生成中' : undefined}
                  onClick={() => runRapidActionOnce('generate-all', onGenerateAll)}
                  title="为所有还没有图的主体批量生成(已上传 / 已生成的会自动跳过,不覆盖)"
                >
                  {batchGenning ? (
                    <span className={styles.sbHeadGenSpin} aria-hidden="true" />
                  ) : (
                    <img className={styles.sbHeadGenIcon} src={aiSparkIcon} alt="" width={16} height={16} />
                  )}
                  {batchGenning ? '生成中…' : 'AI一键生成图片'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 行 */}
        <div className={styles.sbBody}>
          {shots.length === 0 && insertSlot(0, '新增第一条分镜')}
          {shots.map((shot, i) => (
            <Fragment key={shot.id}>
              {i === 0 && insertSlot(0, `在${shot.no || '第一条分镜'}前新增分镜`, hoveredRow === 0)}
              <div
                className={styles.sbRow}
                onMouseEnter={() => setHoveredRow(i)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                {/* 镜头编号:圆形序号 + 镜头名 + 删除按钮(右上角) */}
                <div className={`${styles.sbCell} ${styles.sbColNo}`}>
                  <span className={styles.sbNoBadge}>{i + 1}</span>
                  <span className={styles.sbNoLabel}>{shot.no}</span>
                  {onDeleteShot && (
                    <button
                      type="button"
                      className={styles.sbRowTrash}
                      aria-label="删除镜头"
                      title="删除镜头"
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (deletingShotsRef.current.has(shot.id)) return
                        deletingShotsRef.current.add(shot.id)
                        try {
                          const ok = await requestConfirm(`确认删除「${shot.no || `镜头${i + 1}`}」吗？`, {
                            title: '删除镜头',
                            confirmLabel: '删除',
                            cancelLabel: '取消',
                            danger: true,
                          })
                          if (!ok) return
                          try {
                            await onDeleteShot(shot, i)
                          } catch (err: any) {
                            showToast(err?.message || '删除失败', 'error')
                          }
                        } finally {
                          deletingShotsRef.current.delete(shot.id)
                        }
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* 时长:单击可编辑(青色药丸)，>15s 报错，变更时弹确认 */}
                <div className={`${styles.sbCell} ${styles.sbColDur}`}>
                  <span className={styles.sbDurPill}>
                    <InlineEdit
                      className={styles.sbDurInline}
                      value={String(shot.duration || '').replace(/[^0-9.]/g, '') || '—'}
                      numeric
                      placeholder="—"
                      editable={editable}
                      trigger="click"
                      onCommit={async (v) => {
                        const sec = durationSeconds(v)
                        const orig = durationSeconds(shot.duration)
                        if (sec < 1) return
                        if (!deferDurationValidation) {
                          if (sec > 15) {
                            showToast('最长仅支持15秒，请修改秒数', 'error')
                            return
                          }
                          // 总时长约束:改完后所有镜头之和必须在 [5s, 15s]，超出弹提示、不允许改。
                          const othersTotal = shots.reduce(
                            (sum, s) => sum + (s.id === shot.id ? 0 : durationSeconds(s.duration)),
                            0,
                          )
                          const newTotal = othersTotal + sec
                          if (newTotal > 15) {
                            showToast(`总时长不能超过15秒（改后为 ${newTotal}s），请调整`, 'error')
                            return
                          }
                          if (newTotal < 5) {
                            showToast(`总时长不能少于5秒（改后为 ${newTotal}s），请调整`, 'error')
                            return
                          }
                          if (sec !== orig) {
                            const ok = await requestConfirm(
                              `镜头「${shot.no}」时长从 ${orig}s 改为 ${sec}s，确认修改吗？`,
                              {
                                title: '确认时长',
                                confirmLabel: '确认修改',
                                cancelLabel: '取消',
                              },
                            )
                            if (!ok) return
                          }
                        }
                        patchShot(shot.id, { duration: `${sec}s` })
                      }}
                    />
                    <span className={styles.sbDurUnit}>s</span>
                  </span>
                </div>

                {/* 画面描述(可编辑);新增分镜的 AI 文案返回前显示生成状态。 */}
                <div
                  className={`${styles.sbCell} ${styles.sbColDesc}`}
                  aria-busy={shotTextGenerating[String(shot.id)] || undefined}
                >
                  {shotTextGenerating[String(shot.id)] ? (
                    <div className={styles.sbDescLoading} role="status" aria-live="polite">
                      <span className={styles.sbDescSpinner} aria-hidden="true" />
                      <span>正在生成分镜词…</span>
                    </div>
                  ) : (
                    <InlineEdit
                      className={styles.sbDesc}
                      value={shot.desc || ''}
                      multiline
                      placeholder="双击添加画面描述…"
                      editable={editable}
                      onCommit={(v) => patchShot(shot.id, { desc: v })}
                    />
                  )}
                </div>

                {/* 准备素材(materialMode=图二:@名称 + AI自动生成 + 上传图片) */}
                {showSubjects && (
                  <div className={`${styles.sbCell} ${styles.sbColMat}`}>
                    <div className={styles.sbcMatList}>
                      {visibleSubjectsByShot[i].map(({ subject: su, name, originalIndex }) => {
                        const genning = !!subjectGenerating?.[name]
                        return (
                          <div className={styles.sbcMatRow} key={`${su.tag}-${originalIndex}`}>
                            <div className={styles.sbcMatInfo}>
                              <EllipsisText
                                className={styles.sbcMatName}
                                text={`@${name}`}
                                title={su.kind ? `@${name}（${su.kind}）` : `@${name}`}
                              />
                              <button
                                type="button"
                                className={styles.sbcMatBadge}
                                disabled={genning}
                                aria-label={genning ? `${name}生成中` : undefined}
                                title={
                                  onGenerateSubject
                                    ? '后台生成该主体(可同时生成多个)'
                                    : '打开素材弹窗,在弹窗内生成该素材'
                                }
                                onClick={() =>
                                  runRapidActionOnce(`generate-subject:${name}`, () =>
                                    onGenerateSubject ? onGenerateSubject(name) : onOpenSubject?.(name, true),
                                  )
                                }
                              >
                                <img
                                  className={styles.sbcMatBadgeIcon}
                                  src={aiSparkIcon}
                                  alt=""
                                  width={12}
                                  height={12}
                                />
                                {genning ? '生成中…' : 'AI自动生成'}
                              </button>
                            </div>
                            <span style={{ position: 'relative', display: 'inline-flex' }}>
                              <button
                                type="button"
                                className={styles.sbcMatUpload}
                                aria-label={genning ? `${name}素材生成中` : undefined}
                                title={su.image ? '查看 / 重新生成该素材' : '点击上传 / 生成该素材'}
                                onClick={() => onOpenSubject?.(name)}
                              >
                                {genning ? (
                                  <span className={styles.sbcMatSpin} aria-hidden="true" />
                                ) : su.image ? (
                                  <img className={styles.sbcMatUploadImg} src={su.image} alt={name} />
                                ) : (
                                  <>
                                    <img src={materialUploadIcon} alt="" width={20} height={20} />
                                    <span className={styles.sbcMatUploadText}>上传图片</span>
                                  </>
                                )}
                              </button>
                              {su.image && !genning && onRemoveSubject && (
                                <button
                                  type="button"
                                  className={styles.sbcMatImgX}
                                  aria-label="去掉这张图"
                                  title="去掉这张图"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onRemoveSubject(name)
                                  }}
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          </div>
                        )
                      })}
                      {/* 该镜头无主体素材:加占位主体并 AI 自动生成(用户上传已下线) */}
                      {shot.subjects.length === 0 && onGenerateMaterial && (
                        <div className={styles.sbcMatRow}>
                          <div className={styles.sbcMatInfo}>
                            <EllipsisText
                              className={styles.sbcMatName}
                              text="@待补充"
                              title="该镜头脚本未拆出主体,可补充素材"
                            />
                            <button
                              type="button"
                              className={styles.sbcMatBadge}
                              title="为该镜头加一个素材并自动生成"
                              onClick={() =>
                                runRapidActionOnce(`generate-material:${String(shot.id)}`, () =>
                                  onGenerateMaterial(shot),
                                )
                              }
                            >
                              <img className={styles.sbcMatBadgeIcon} src={aiSparkIcon} alt="" width={12} height={12} />
                              AI自动生成
                            </button>
                          </div>
                          <button
                            type="button"
                            className={styles.sbcMatUpload}
                            title="点击 AI 生成该素材"
                            onClick={() =>
                              runRapidActionOnce(`generate-material:${String(shot.id)}`, () => onGenerateMaterial(shot))
                            }
                          >
                            <img src={aiSparkIcon} alt="" width={20} height={20} />
                            <span className={styles.sbcMatUploadText}>AI生成</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {insertSlot(
                i + 1,
                `在${shot.no || `第${i + 1}条分镜`}后新增分镜`,
                hoveredRow === i || hoveredRow === i + 1,
              )}
            </Fragment>
          ))}
        </div>

        {/* 表尾:分镜脚本阶段(传 onRegenerate)显示「重新生成」,其余阶段显示「共 N 个镜头」 */}
        <div className={styles.sbFoot}>
          {onRegenerate ? (
            <button
              type="button"
              className={styles.sbRegen}
              disabled={regenerating}
              onClick={() => runRapidActionOnce('regenerate-script', onRegenerate)}
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
      <ShotTrashBin
        items={trashItems}
        loading={trashLoading}
        onLoad={onLoadTrash}
        onRestore={onRestoreTrash}
        onDelete={onDeleteTrash}
        onRestoreAll={onRestoreAllTrash}
        onClearAll={onClearTrash}
        buttonClassName={styles.trashFabDock}
        dataGuide={showSubjects ? undefined : 'smart-script-trash'}
        dragStorageKey={showSubjects ? 'smart-material-trash-fab' : 'smart-script-trash-fab'}
        dragBoundarySelector=".smart__main"
        dragTopObstacleSelector=".smart__progress"
      />
    </div>
  )
}
