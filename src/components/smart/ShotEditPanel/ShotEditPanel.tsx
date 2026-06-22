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
import { useEffect, useRef, useState } from 'react'
import type { Shot } from '../ScriptStoryboardTable'
import { fileToDataUrl } from '@/utils/imageFile'
import AiBadge from '@/components/common/AiBadge'
import InlineEdit from '@/components/common/InlineEdit'
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
  /** 据画面描述+大纲+选中素材(看图)优化生成提示词,返回 {prompt, debug} */
  onOptimizePrompt?: (
    shot: Shot,
    materials: { name?: string; kind?: string; url?: string }[],
  ) => Promise<{ prompt: string; debug?: any }>
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
  onOpenElement,
  onPatch,
  onRegenerateImage,
  onOptimizePrompt,
}: ShotEditPanelProps) {
  const refFileRef = useRef<HTMLInputElement | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set()) // 选择器内多选暂存
  const [optimizing, setOptimizing] = useState(false)
  const [optDebug, setOptDebug] = useState<any>(null) // 优化提示词调试信息
  const [showOptDebug, setShowOptDebug] = useState(false)
  const debugEnabled = import.meta.env.DEV
  const togglePicked = (url: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(url)) n.delete(url)
      else n.add(url)
      return n
    })
  const confirmPicked = () => {
    const urls = [...picked]
    if (urls.length) {
      const nextExtra = [...extraRefs, ...urls.filter((u) => !extraRefs.includes(u))]
      const nextIds = { ...extraRefIds }
      urls.forEach((u) => {
        const found = projectImages.find((p) => p.url === u)
        if (found?.assetId) nextIds[u] = found.assetId
      })
      const nextSel = new Set(selected)
      urls.forEach((u) => nextSel.add(u))
      setExtraRefs(nextExtra)
      setExtraRefIds(nextIds)
      setSelected(nextSel)
      persistRefs(nextSel, nextExtra, nextIds)
    }
    setPicked(new Set())
    setPickerOpen(false)
  }
  const openPicker = () => {
    setPicked(new Set())
    setPickerOpen((v) => !v)
  }

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
  // 额外参考图的 asset_id(持久化用):url → assetId
  const [extraRefIds, setExtraRefIds] = useState<Record<string, number>>(
    Object.fromEntries((shot.extraRefs || []).map((r) => [r.url, r.assetId || 0])),
  )
  const [carry, setCarry] = useState(!!current)
  const [bigImg, setBigImg] = useState('') // 放大查看分镜图(视频生成页)
  // 把「选中素材 + 额外参考图」写回分镜(随 shots 进本地+云端草稿),供刷新/切换还原
  const persistRefs = (sel: Set<string>, ex: string[], exIds: Record<string, number>) =>
    onPatch({
      selectedRefs: [...sel],
      extraRefs: ex.map((u) => ({ url: u, assetId: exIds[u] || 0 })),
    })
  // 仅「切换分镜」时从该镜已存字段重置本地态(不能依赖 imagePrompt,否则点"优化提示词"
  // 改了 imagePrompt → 重置 → 刚选的素材/刚加的图被清掉)
  useEffect(() => {
    const els = Array.from(new Set(shot.subjects.map((s) => s.image).filter(Boolean))) as string[]
    setImgPrompt(shot.imagePrompt || shot.desc || '')
    setSelected(new Set(shot.selectedRefs && shot.selectedRefs.length ? shot.selectedRefs : els))
    setExtraRefs((shot.extraRefs || []).map((r) => r.url))
    setExtraRefIds(Object.fromEntries((shot.extraRefs || []).map((r) => [r.url, r.assetId || 0])))
    setCarry(!!shot.image)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.id])
  // 提示词外部变化(生成完成/优化)单独同步到输入框,不影响素材选择
  useEffect(() => {
    setImgPrompt(shot.imagePrompt || shot.desc || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.imagePrompt])

  // 台词/字幕/音效(两种布局共用)
  const texts = (
    <div className={`${styles.seditTexts}${compact ? ' ' + styles.seditTextsCol : ''}`}>
      <TextField
        icon={ICON.line}
        title="台词"
        value={shot.line || ''}
        placeholder={`${shot.no}的台词/旁白…`}
        onChange={(v) => onPatch({ line: v })}
      />
      <TextField
        icon={ICON.subtitle}
        title="字幕"
        value={shot.subtitle || ''}
        placeholder={`${shot.no}的字幕…`}
        onChange={(v) => onPatch({ subtitle: v })}
      />
      <TextField
        icon={ICON.sfx}
        title="音效"
        value={shot.sfx || ''}
        placeholder={`${shot.no}的音效…`}
        onChange={(v) => onPatch({ sfx: v })}
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

  const toggle = (url: string) => {
    const n = new Set(selected)
    if (n.has(url)) n.delete(url)
    else n.add(url)
    setSelected(n)
    persistRefs(n, extraRefs, extraRefIds)
  }
  const removeExtra = (url: string) => {
    const nextExtra = extraRefs.filter((u) => u !== url)
    const nextIds = { ...extraRefIds }
    delete nextIds[url]
    const nextSel = new Set(selected)
    nextSel.delete(url)
    setExtraRefs(nextExtra)
    setExtraRefIds(nextIds)
    setSelected(nextSel)
    persistRefs(nextSel, nextExtra, nextIds)
  }
  const addExtra = async (f: File) => {
    // 优先直传后端成 asset(http url + asset_id),才能存进云端草稿;失败/未提供回退本地 dataURL
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
    const nextExtra = [...extraRefs, url]
    const nextIds = { ...extraRefIds, [url]: assetId }
    const nextSel = new Set(selected).add(url)
    setExtraRefs(nextExtra)
    setExtraRefIds(nextIds)
    setSelected(nextSel)
    persistRefs(nextSel, nextExtra, nextIds)
  }
  const doGenerate = () => {
    const refUrls = [...elUrls.filter((u) => selected.has(u)), ...extraRefs.filter((u) => selected.has(u))]
    onPatch({
      imagePrompt: imgPrompt,
      selectedRefs: [...selected],
      extraRefs: extraRefs.map((u) => ({ url: u, assetId: extraRefIds[u] || 0 })),
    })
    onRegenerateImage(shot, { editPrompt: imgPrompt.trim() || undefined, refUrls, carryCurrent: carry })
  }

  return (
    <div className={`${styles.sedit}${className ? ' ' + className : ''}`}>
      {/* ── 画面描述(脚本):这一镜的剧情源头,也是出图依据 ── */}
      <div className={styles.seditScript}>
        <div className={styles.seditTfHead}>
          <span className={styles.seditTfIcon}>{ICON.script}</span>
          画面描述（脚本）
        </div>
        <InlineEdit
          className={styles.seditIe}
          trigger="click"
          multiline
          value={shot.desc || ''}
          placeholder="点击填写画面描述…"
          onCommit={(v) => onPatch({ desc: v })}
        />
      </div>

      {/* ── 分镜图修改区(两栏)── */}
      <div className={styles.seditEditrow}>
        {/* 左:当前分镜图 + 历史版本 */}
        <div className={styles.seditLeft}>
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
          {versions.length > 0 && (
            <>
              <div className={styles.seditSub}>历史版本（点击切换）</div>
              <div className={styles.seditHistRow}>
                {versions.map((v, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`${styles.seditHist}${v.url === current ? ' ' + styles.active : ''}`}
                    onClick={() => {
                      // 切到该历史版本:同时还原它当时用到的提示词与选中素材
                      const refs = v.refs && v.refs.length ? v.refs : undefined
                      if (refs) {
                        const nextExtra = Array.from(
                          new Set([...extraRefs, ...refs.filter((u) => !elUrls.includes(u))]),
                        )
                        setExtraRefs(nextExtra)
                        setSelected(new Set(refs))
                      }
                      if (v.prompt) setImgPrompt(v.prompt)
                      onPatch({
                        image: v.url,
                        imageAssetId: v.assetId,
                        ...(v.prompt ? { imagePrompt: v.prompt } : {}),
                        ...(refs ? { selectedRefs: refs } : {}),
                      })
                    }}
                  >
                    <img src={v.url} alt="" />
                    <AiBadge size={14} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 右:素材 + 提示词 + 携带 + 生成 */}
        <div className={styles.seditRight}>
          <div className={styles.seditSub}>素材（点选参与出图）</div>
          <div className={styles.seditEls}>
            {elUrls.length === 0 && shot.subjects.length === 0 && (
              <div className={styles.seditElEmpty}>该分镜暂无元素</div>
            )}
            {shot.subjects.map((su, i) => {
              const name = stripAt(su.tag)
              const url = su.image || ''
              const on = !!url && selected.has(url)
              return (
                <div className={styles.seditEl} key={`${su.tag}-${i}`}>
                  <button
                    type="button"
                    className={`${styles.seditElThumb}${on ? ' ' + styles.on : ''}`}
                    title="双击编辑"
                    onClick={() => (url ? toggle(url) : onOpenElement?.(name))}
                    onDoubleClick={() => onOpenElement?.(name)}
                  >
                    <Thumb src={url} alt={name} fallback={<span>+</span>} />
                    {on && <span className={styles.seditElCheck}>✓</span>}
                  </button>
                  <div className={styles.seditElMeta}>
                    <span className={styles.seditElName}>{name || '元素'}</span>
                    {su.kind && <span className={styles.seditElKind}>{su.kind}</span>}
                  </div>
                </div>
              )
            })}
            {/* 额外上传素材 */}
            {extraRefs.map((u, i) => (
              <div className={styles.seditEl} key={`extra-${i}`}>
                <button
                  type="button"
                  className={`${styles.seditElThumb}${selected.has(u) ? ' ' + styles.on : ''}`}
                  onClick={() => toggle(u)}
                  title="点选/取消参与出图"
                >
                  <Thumb src={u} />
                  {selected.has(u) && <span className={styles.seditElCheck}>✓</span>}
                </button>
                <div className={styles.seditElMeta}>
                  <span className={styles.seditElName}>上传</span>
                </div>
                <button type="button" className={styles.seditElMng} onClick={() => removeExtra(u)}>
                  移除
                </button>
              </div>
            ))}
            <button type="button" className={styles.seditElAdd} onClick={openPicker}>
              <span>+</span>
              添加素材
            </button>
          </div>

          {/* 从当前项目素材里多选(上传的 / AI 生成的),选好点「添加」 */}
          {pickerOpen && (
            <div className={styles.seditPicker}>
              <div className={styles.seditPickerBar}>
                <button type="button" className={styles.seditPickerUpload} onClick={() => refFileRef.current?.click()}>
                  <span>⬆</span> 上传本地
                </button>
                <span>
                  <button type="button" className={styles.seditPickerCancel} onClick={() => setPickerOpen(false)}>
                    取消
                  </button>
                  <button
                    type="button"
                    className={styles.seditPickerOk}
                    disabled={!picked.size}
                    onClick={confirmPicked}
                  >
                    添加{picked.size ? `(${picked.size})` : ''}
                  </button>
                </span>
              </div>
              {(['upload', 'ai'] as const).map((src) => {
                const list = projectImages.filter((p) => p.source === src)
                if (!list.length) return null
                return (
                  <div key={src}>
                    <div className={styles.seditPickerTitle}>{src === 'upload' ? '我上传的图' : 'AI 生成的图'}</div>
                    <div className={styles.seditPickerGrid}>
                      {list.map((p, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`${styles.seditPickerItem}${picked.has(p.url) ? ' ' + styles.picked : ''}`}
                          onClick={() => togglePicked(p.url)}
                        >
                          <Thumb src={p.url} />
                          {src === 'ai' && <AiBadge size={15} />}
                          {picked.has(p.url) && <span className={styles.seditPickerCheck}>✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              {!projectImages.length && <div className={styles.seditPickerEmpty}>项目里暂无可选图片</div>}
            </div>
          )}

          <div className={`${styles.seditSub} ${styles.seditSubRow}`}>
            生成提示词
            <span style={{ display: 'flex', gap: 6 }}>
              {debugEnabled && optDebug && (
                <button type="button" className={styles.seditOptimize} onClick={() => setShowOptDebug(true)}>
                  🐞 调试
                </button>
              )}
              {onOptimizePrompt && (
                <button
                  type="button"
                  className={styles.seditOptimize}
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
                    } finally {
                      setOptimizing(false)
                    }
                  }}
                >
                  {optimizing ? '优化中…' : '✦ 优化提示词'}
                </button>
              )}
            </span>
          </div>
          <InlineEdit
            className={`${styles.seditIe} ${styles.seditIePrompt}`}
            trigger="click"
            multiline
            value={imgPrompt}
            placeholder="点击填写生成提示词…(改了素材可点「优化提示词」)"
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

          <div className={styles.seditGenrow}>
            <label className={styles.seditCarry}>
              <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
              携带当前分镜图(在现有画面上修改)
            </label>
            <button type="button" className={styles.seditGen} disabled={!!regenerating} onClick={doGenerate}>
              {regenerating ? '生成中…' : '✦ 生成分镜图'}
            </button>
          </div>
        </div>
      </div>

      {/* ── 台词 / 字幕 / 音效(全宽,即时自动保存)── */}
      {texts}

      <input
        ref={refFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void addExtra(f)
          e.target.value = ''
        }}
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

const ICON = {
  script: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </svg>
  ),
  line: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 9 9 0 0 1-4-1L3 20l1-3.5a8.38 8.38 0 0 1-1-4A8.5 8.5 0 0 1 21 11.5z" />
    </svg>
  ),
  subtitle: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 14h4M14 14h3M7 11h3M13 11h4" />
    </svg>
  ),
  sfx: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
    </svg>
  ),
}

function TextField({
  icon,
  title,
  value,
  placeholder,
  onChange,
}: {
  icon: React.ReactNode
  title: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <div className={styles.seditTf}>
      <div className={styles.seditTfHead}>
        <span className={styles.seditTfIcon}>{icon}</span>
        {title}
      </div>
      <InlineEdit
        className={styles.seditIe}
        trigger="click"
        multiline
        value={value}
        maxLength={500}
        placeholder={placeholder}
        onCommit={onChange}
      />
    </div>
  )
}
