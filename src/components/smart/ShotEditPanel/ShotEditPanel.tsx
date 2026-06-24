/**
 * ShotEditPanel — 右侧「素材修改」面板(镜头编排 / 视频生成 两页共用)。
 *
 * 布局:
 *  - 上半「分镜图修改区」分两栏:
 *      左栏 = 当前分镜图(大) + 历史版本(点击切换/高亮)
 *      右栏 = 素材(元素:点选参与出图 / 上传新增) + 生成提示词(可编辑) + 携带当前分镜图 + 生成按钮
 *  - 下半「台词 / 字幕 / 音效」全宽,即时自动保存(无提交按钮),带图标区分。
 *
 * 统一出图:提示词 + 选中的素材(refUrls) + 是否携带当前分镜图(carryCurrent) → onRegenerateImage。
 */
import { useEffect, useState } from 'react'
import type { Shot } from '../ScriptStoryboardTable'
import { fileToDataUrl } from '@/utils/imageFile'
import AiBadge from '@/components/common/AiBadge'
import InlineEdit from '@/components/common/InlineEdit'
import ShotImageDialog, { type ShotImageVersion } from '@/components/smart/ShotImageDialog'
import { useToast } from '@/composables/useToast'
import styles from './ShotEditPanel.module.less'

// 缩略图:签名URL过期等导致加载失败时回退占位,不显示破图
function Thumb({ src, alt, fallback }: { src?: string; alt?: string; fallback?: React.ReactNode }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <>{fallback ?? <span>—</span>}</>
  return <img src={src} alt={alt || ''} onError={() => setBroken(true)} />
}

interface ShotEditPanelProps {
  /** 额外类名:父组件控制布局(如 VideoStage 收窄面板宽) */
  className?: string
  shot: Shot
  regenerating?: boolean
  /** compact=视频生成页:只留 分镜图缩略 + 素材 + 台词/字幕/音效(分镜图编辑在镜头编排页做) */
  compact?: boolean
  /** 当前项目所有图(带来源+asset_id),供"从项目素材添加" */
  projectImages?: { url: string; source: 'ai' | 'upload'; assetId?: number }[]
  /** 上传额外参考图 → 直传后端成 asset(返回 http url + asset_id,供云端持久化);缺省回退本地 dataURL */
  onUploadRef?: (file: File) => Promise<{ url: string; assetId?: number }>
  onOpenElement?: (name: string) => void
  /** 即时保存字段(台词/字幕/音效/生成提示词/切换分镜图版本/画面描述) */
  onPatch: (patch: Partial<Shot>) => void
  /** 出图:editPrompt 提示词 + refUrls 选中素材 + carryCurrent 是否带当前图 */
  onRegenerateImage: (shot: Shot, opts: { editPrompt?: string; refUrls?: string[]; carryCurrent?: boolean }) => void
  /** 「插入的新分镜」点「生成分镜」:带该镜新描述,结合其他分镜全量重生成(仅 isNew 分镜可见) */
  onRegenerateAll?: (shotId: string | number, desc: string) => void
  /** 是否正在(全量/单镜)生成,禁用「生成分镜」按钮 */
  busy?: boolean
  /** 据画面描述+大纲+选中素材(看图)优化生成提示词,返回 {prompt, debug} */
  onOptimizePrompt?: (
    shot: Shot,
    materials: { name?: string; kind?: string; url?: string }[],
  ) => Promise<{ prompt: string; debug?: any }>
  /** 台词/字幕/音效 的「AI一键润色」:传入类型与原文,返回润色后的文本 */
  onPolishText?: (kind: 'line' | 'subtitle' | 'sound', text: string) => Promise<string>
}

const stripAt = (t: string) =>
  String(t || '')
    .replace(/^@/, '')
    .trim()

export default function ShotEditPanel({
  shot,
  regenerating,
  className,
  compact,
  projectImages = [],
  onUploadRef,
  onPatch,
  onRegenerateImage,
  onRegenerateAll,
  busy,
  onOptimizePrompt,
  onPolishText,
}: ShotEditPanelProps) {
  const { showToast } = useToast()
  const [dlgOpen, setDlgOpen] = useState(false) // 「上传素材」分镜图弹窗
  const [optimizing, setOptimizing] = useState(false)
  const [optDebug, setOptDebug] = useState<any>(null) // 优化提示词调试信息
  const [showOptDebug, setShowOptDebug] = useState(false)
  const debugEnabled = import.meta.env.DEV

  const current = shot.image || ''
  // 兼容旧草稿(字符串)与新结构({url, assetId})
  const versions = (shot.imageVersions || []).map((v: any) => (typeof v === 'string' ? { url: v, assetId: 0 } : v))
  const elUrls = Array.from(new Set(shot.subjects.map((s) => s.image).filter(Boolean))) as string[]

  // 本地草稿:提示词(默认回退到画面描述,生成前也能看/改)/ 选中素材 / 额外参考图 / 是否携带当前图。
  // 初值取自分镜已持久化的字段(selectedRefs/extraRefs),刷新/切换/重进都能还原。
  const [imgPrompt, setImgPrompt] = useState(shot.imagePrompt || shot.desc || '')
  const [selected, setSelected] = useState<Set<string>>(
    new Set(shot.selectedRefs && shot.selectedRefs.length ? shot.selectedRefs : elUrls),
  )
  const [extraRefs, setExtraRefs] = useState<string[]>((shot.extraRefs || []).map((r) => r.url))
  const [bigImg, setBigImg] = useState('') // 放大查看分镜图(视频生成页)
  // 仅「切换分镜」时从该镜已存字段重置本地态(不能依赖 imagePrompt,否则点"优化提示词"
  // 改了 imagePrompt → 重置 → 刚选的素材/刚加的图被清掉)
  useEffect(() => {
    const els = Array.from(new Set(shot.subjects.map((s) => s.image).filter(Boolean))) as string[]
    setImgPrompt(shot.imagePrompt || shot.desc || '')
    setSelected(new Set(shot.selectedRefs && shot.selectedRefs.length ? shot.selectedRefs : els))
    setExtraRefs((shot.extraRefs || []).map((r) => r.url))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.id])
  // 提示词外部变化(生成完成/优化)单独同步到输入框,不影响素材选择
  useEffect(() => {
    setImgPrompt(shot.imagePrompt || shot.desc || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.imagePrompt])

  // 台词/字幕/音效 的「AI一键润色」:用本地模型按类型润色当前文本,写回。compact(视频页)不提供。
  const makePolish = (kind: 'line' | 'subtitle' | 'sound', value: string, key: 'line' | 'subtitle' | 'sfx') =>
    !compact && onPolishText
      ? async () => {
          if (!value.trim()) return
          try {
            const out = await onPolishText(kind, value)
            if (out) onPatch({ [key]: out })
          } catch (e: any) {
            showToast(`AI 润色失败:${e?.message || '请稍后重试'}`, 'error')
          }
        }
      : undefined

  // 台词/字幕/音效(两种布局共用)
  const texts = (
    <div className={`${styles.seditTexts}${compact ? ' ' + styles.seditTextsCol : ''}`}>
      <TextField
        title="台词修改"
        value={shot.line || ''}
        placeholder={`${shot.no}的台词/旁白…`}
        onChange={(v) => onPatch({ line: v })}
        onPolish={makePolish('line', shot.line || '', 'line')}
      />
      <TextField
        title="字幕修改"
        value={shot.subtitle || ''}
        placeholder={`${shot.no}的字幕…`}
        onChange={(v) => onPatch({ subtitle: v })}
        onPolish={makePolish('subtitle', shot.subtitle || '', 'subtitle')}
      />
      <TextField
        title="音效修改"
        value={shot.sfx || ''}
        placeholder={`${shot.no}的音效…`}
        onChange={(v) => onPatch({ sfx: v })}
        onPolish={makePolish('sound', shot.sfx || '', 'sfx')}
      />
    </div>
  )

  // 视频生成页:精简(视频才是重点;此步只改台词/字幕/音效,分镜图/素材只读)
  if (compact) {
    return (
      <div className={`${styles.sedit} ${styles.seditCompact}${className ? ' ' + className : ''}`}>
        <div className={styles.seditSub}>分镜图（点击放大）</div>
        <div
          className={`${styles.seditCur} ${styles.seditCurSm}${current ? ' ' + styles.seditCurZoom : ''}`}
          onClick={() => current && setBigImg(current)}
          title={current ? '点击放大查看' : ''}
        >
          {current ? (
            <>
              <img src={current} alt="" />
              <AiBadge />
            </>
          ) : (
            <span className={styles.seditCurPh}>暂无分镜图</span>
          )}
        </div>
        <div className={styles.seditSub}>素材（此步只读）</div>
        <div className={styles.seditEls}>
          {shot.subjects.map((su, i) => {
            const name = stripAt(su.tag)
            return (
              <div key={`${su.tag}-${i}`} className={`${styles.seditElThumb} ${styles.seditElThumbRo}`} title={name}>
                <Thumb src={su.image} alt={name} />
              </div>
            )
          })}
        </div>
        {texts}
        {bigImg && (
          <div className={styles.seditLightbox} onClick={() => setBigImg('')} role="dialog" aria-label="分镜图放大">
            <img src={bigImg} alt="" onClick={(e) => e.stopPropagation()} />
            <button type="button" className={styles.seditLightboxClose} onClick={() => setBigImg('')} aria-label="关闭">
              ×
            </button>
          </div>
        )}
      </div>
    )
  }

  // 切到某历史版本:还原其当时用到的提示词与选中素材(面板缩略图与弹窗共用)
  const pickVersion = (v: ShotImageVersion) => {
    const refs = v.refs && v.refs.length ? v.refs : undefined
    if (refs) {
      setExtraRefs((prev) => Array.from(new Set([...prev, ...refs.filter((u) => !elUrls.includes(u))])))
      setSelected(new Set(refs))
    }
    if (v.prompt) setImgPrompt(v.prompt)
    onPatch({
      image: v.url,
      imageAssetId: v.assetId || 0,
      ...(v.prompt ? { imagePrompt: v.prompt } : {}),
      ...(refs ? { selectedRefs: refs } : {}),
    })
  }
  // 设为当前分镜图(替换展示图);若不在历史里则追加,确保「也在历史生成中展示」
  const applyAsCurrent = (url: string, assetId: number) => {
    const exists = versions.some((v) => v.url === url)
    onPatch({
      image: url,
      imageAssetId: assetId || 0,
      ...(exists ? {} : { imageVersions: [...versions, { url, assetId: assetId || 0, prompt: imgPrompt }] }),
    })
  }
  // 弹窗上传本地图为新分镜图:优先直传后端成 asset(http + asset_id),失败回退本地 dataURL
  const handleDialogUpload = async (f: File) => {
    let url = ''
    let assetId = 0
    if (onUploadRef) {
      const r = await onUploadRef(f).catch(() => null)
      if (r?.url) {
        url = r.url
        assetId = r.assetId || 0
      }
    }
    if (!url) url = await fileToDataUrl(f).catch(() => '')
    if (!url) return
    applyAsCurrent(url, assetId)
  }
  // 弹窗重新生成:提示词 + 参考图(主体 + 额外)+ 携带当前图 → 统一出图(替换展示图并进历史)
  const handleDialogGenerate = (p: string, opts: { refUrls: string[]; carryCurrent: boolean }) => {
    setImgPrompt(p)
    onPatch({ imagePrompt: p })
    onRegenerateImage(shot, {
      editPrompt: p.trim() || undefined,
      refUrls: opts.refUrls,
      carryCurrent: opts.carryCurrent,
    })
  }

  return (
    <div className={`${styles.sedit}${className ? ' ' + className : ''}`}>
      {/* ── 顶部:当前分镜图 + 历史生成 ── */}
      <div className={styles.seTop}>
        <div className={styles.seCurBox}>
          <div className={styles.seditCur}>
            {regenerating ? (
              <span className={styles.seditCurPh}>
                <span className={styles.seditSpin} aria-hidden="true" />
                生成中…
              </span>
            ) : current ? (
              <>
                <img src={current} alt="" />
                <AiBadge />
              </>
            ) : (
              <span className={styles.seditCurPh}>暂无分镜图</span>
            )}
          </div>
        </div>
        <button
          type="button"
          className={styles.seUploadBox}
          onClick={() => setDlgOpen(true)}
          title="上传 / 替换 / 重新生成分镜图"
        >
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M5 20h14" />
          </svg>
          上传素材
        </button>
        <div className={styles.seHistory}>
          <div className={styles.seHistTitle}>历史生成</div>
          {versions.length > 0 ? (
            <div className={styles.seHistGrid}>
              {versions
                .slice()
                .reverse()
                .map((v, ri) => {
                  const i = versions.length - 1 - ri
                  return (
                    <div className={styles.seHistCell} key={i}>
                      <button
                        type="button"
                        className={`${styles.seHistItem}${v.url === current ? ' ' + styles.active : ''}`}
                        onClick={() => pickVersion(v)}
                      >
                        <img src={v.url} alt="" />
                      </button>
                      <span className={styles.seHistLabel}>V{i + 1}</span>
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className={styles.seHistEmpty}>生成后在此查看 / 切换历史版本</div>
          )}
        </div>
      </div>

      {/* ── 镜头N:图片修改描述 + AI一键润色(优化提示词)+ 携带当前图 + 生成 ── */}
      <div className={styles.seCard}>
        <div className={styles.seCardHead}>
          <span className={styles.seCardTitle}>{shot.no}-分镜描述</span>
        </div>
        <InlineEdit
          className={`${styles.seditIe} ${styles.seditIePrompt} ${styles.seditIePlain}`}
          trigger="click"
          multiline
          value={imgPrompt}
          placeholder="输入你的分镜图片修改描述…"
          onCommit={(v) => {
            setImgPrompt(v)
            if (v !== (shot.imagePrompt || '')) onPatch({ imagePrompt: v })
          }}
        />
        {optimizing && (
          <div className={styles.seditOptStatus}>
            <span className={styles.seditSpin} aria-hidden="true" />
            正在读取选中素材图,并结合脚本/大纲优化提示词…(看图较慢,请稍候)
          </div>
        )}
        {/* 底部:AI一键润色(优化提示词)+ 生成分镜(右对齐) */}
        <div className={styles.seditGenrow}>
          <span className={styles.seCardActions}>
            {debugEnabled && optDebug && (
              <button type="button" className={styles.seditPolish} onClick={() => setShowOptDebug(true)}>
                🐞 调试
              </button>
            )}
            {onOptimizePrompt && (
              <button
                type="button"
                className={styles.seditPolish}
                disabled={optimizing}
                onClick={async () => {
                  setOptimizing(true)
                  try {
                    // 只把「当前选中参与出图」的素材交给优化(看图分析其真实外观)
                    const mats = [
                      ...shot.subjects
                        .filter((su) => su.image && selected.has(su.image))
                        .map((su) => ({ name: stripAt(su.tag), kind: su.kind, url: su.image })),
                      ...extraRefs.filter((u) => selected.has(u)).map((u) => ({ name: '参考素材', url: u })),
                    ]
                    const r = await onOptimizePrompt(shot, mats)
                    if (r?.prompt) {
                      setImgPrompt(r.prompt)
                      onPatch({ imagePrompt: r.prompt })
                    }
                    setOptDebug(r?.debug || null)
                  } catch (e: any) {
                    showToast(`优化提示词失败:${e?.message || '请稍后重试'}`, 'error')
                  } finally {
                    setOptimizing(false)
                  }
                }}
              >
                {optimizing ? '润色中…' : 'AI一键润色'}
              </button>
            )}
            {/* 「生成分镜」仅插入的新分镜显示:带这条新描述,结合其他分镜全量重生成 */}
            {shot.isNew && onRegenerateAll && (
              <button
                type="button"
                className={styles.seditGen}
                disabled={!!busy || !!regenerating}
                onClick={() => {
                  if (imgPrompt !== (shot.imagePrompt || '')) onPatch({ imagePrompt: imgPrompt })
                  onRegenerateAll(shot.id, imgPrompt)
                }}
                title="根据这条新分镜描述,结合其他分镜重新生成全部分镜"
              >
                {busy || regenerating ? '生成中…' : '生成分镜'}
              </button>
            )}
          </span>
        </div>
      </div>

      {/* ── 台词 / 字幕 / 音效(全宽,即时自动保存)── */}
      {texts}

      {/* 「上传素材」分镜图弹窗:改提示词/加参考图/携带当前图/重新生成;新图替换展示图并进历史生成 */}
      <ShotImageDialog
        open={dlgOpen}
        shotNo={shot.no}
        currentImage={current}
        versions={versions}
        defaultPrompt={imgPrompt}
        subjects={shot.subjects.map((su) => ({ name: stripAt(su.tag), url: su.image }))}
        projectImages={projectImages}
        generating={!!regenerating}
        onClose={() => setDlgOpen(false)}
        onGenerate={handleDialogGenerate}
        onPickVersion={pickVersion}
        onUseImage={applyAsCurrent}
        onUpload={handleDialogUpload}
      />

      {/* 优化提示词 · 调试弹窗(开发可见) */}
      {debugEnabled && showOptDebug && optDebug && (
        <div className={styles.seditDbgMask} onClick={(e) => e.target === e.currentTarget && setShowOptDebug(false)}>
          <div className={styles.seditDbg} role="dialog" aria-label="优化提示词调试">
            <div className={styles.seditDbgHead}>
              <span>优化提示词 · 调试</span>
              <button type="button" onClick={() => setShowOptDebug(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className={styles.seditDbgBody}>
              <div className={styles.seditDbgT}>模型 / 通道</div>
              <pre className={styles.seditDbgPre}>{`${optDebug.model || ''}  ·  ${optDebug.endpoint || ''}`}</pre>
              <div className={styles.seditDbgT}>① 选中素材(交给模型看图的)</div>
              {optDebug.materials?.length ? (
                <div className={styles.seditDbgImgs}>
                  {optDebug.materials.map((m: any, i: number) => (
                    <figure key={i}>
                      {m.url ? <img src={m.url} alt="" /> : <span className={styles.seditDbgNoimg}>无图</span>}
                      <figcaption>
                        {m.name || '素材'}
                        {m.kind ? `/${m.kind}` : ''}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <div className={styles.seditDbgMuted}>无</div>
              )}
              <div className={styles.seditDbgT}>② System(规则)</div>
              <pre className={styles.seditDbgPre}>{optDebug.system}</pre>
              <div className={styles.seditDbgT}>③ 输入(大纲 + 脚本 + 素材列表)</div>
              <pre className={styles.seditDbgPre}>{optDebug.userText}</pre>
              <div className={styles.seditDbgT}>④ 模型原始返回</div>
              <pre className={styles.seditDbgPre}>{optDebug.raw || '(空)'}</pre>
              <div className={styles.seditDbgT}>⑤ 清洗后写入的提示词</div>
              <pre className={styles.seditDbgPre}>{optDebug.prompt || '(空)'}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TextField({
  title,
  value,
  placeholder,
  onChange,
  onPolish,
}: {
  title: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
  onPolish?: () => Promise<void>
}) {
  const [polishing, setPolishing] = useState(false)
  return (
    <div className={styles.seditTf}>
      <div className={styles.seditTfMain}>
        <span className={styles.seditTfTitle}>{title}</span>
        <InlineEdit
          className={`${styles.seditIe} ${styles.seditIePlain}`}
          trigger="click"
          multiline
          value={value}
          maxLength={500}
          placeholder={placeholder}
          onCommit={onChange}
        />
      </div>
      {onPolish && (
        <div className={styles.seditTfAside}>
          <button
            type="button"
            className={styles.seditPolish}
            disabled={polishing || !value.trim()}
            onClick={async () => {
              setPolishing(true)
              try {
                await onPolish()
              } finally {
                setPolishing(false)
              }
            }}
          >
            {polishing ? '润色中…' : 'AI一键润色'}
          </button>
        </div>
      )}
    </div>
  )
}
