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
import { useState } from 'react'
import type { Shot } from '../ScriptStoryboardTable'
import AiBadge from '@/components/common/AiBadge'
import InlineEdit from '@/components/common/InlineEdit'
import { useToast } from '@/composables/useToast'
import { ratioToAspect } from '@/utils/aspectRatio'
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
  /** 画面比例:分镜图预览/历史版本按此显示(竖屏不被塞进横屏框) */
  ratio?: string
  regenerating?: boolean
  /** compact=视频生成页:只留 分镜图缩略 + 素材 + 台词/字幕/音效(分镜图编辑在镜头编排页做) */
  compact?: boolean
  /** 即时保存字段(台词/字幕/音效/切换分镜图版本) */
  onPatch: (patch: Partial<Shot>) => void
  /** 台词/字幕/音效 的「AI一键润色」:传入类型与原文,返回润色后的文本 */
  onPolishText?: (kind: 'line' | 'subtitle' | 'sound', text: string) => Promise<string>
}

const stripAt = (t: string) =>
  String(t || '')
    .replace(/^@/, '')
    .trim()

export default function ShotEditPanel({
  shot,
  ratio,
  regenerating,
  className,
  compact,
  onPatch,
  onPolishText,
}: ShotEditPanelProps) {
  const { showToast } = useToast()

  const aspect = ratioToAspect(ratio)
  const current = shot.image || ''
  // 兼容旧草稿(字符串)与新结构({url, assetId})
  const versions = (shot.imageVersions || []).map((v: any) => (typeof v === 'string' ? { url: v, assetId: 0 } : v))
  const [bigImg, setBigImg] = useState('') // 放大查看分镜图(视频生成页)

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
          style={{ aspectRatio: aspect }}
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

  // 历史生成:点击某版本 → 设为当前分镜图(还原其提示词)
  const pickVersion = (v: { url: string; assetId?: number; prompt?: string }) => {
    onPatch({
      image: v.url,
      imageAssetId: v.assetId || 0,
      ...(v.prompt ? { imagePrompt: v.prompt } : {}),
    })
  }

  return (
    <div className={`${styles.sedit}${className ? ' ' + className : ''}`}>
      {/* ── 使用到的主体和素材(图片展示,样式对齐分镜图)── */}
      {shot.subjects.length > 0 && (
        <div className={styles.seMats}>
          <div className={styles.seMatsTitle}>使用到的主体和素材</div>
          <div className={styles.seMatsGrid}>
            {shot.subjects.map((su, i) => {
              const name = stripAt(su.tag)
              return (
                <div className={styles.seMatCell} key={`${su.tag}-${i}`}>
                  <div className={styles.seMatThumb} title={name}>
                    <Thumb
                      src={su.image}
                      alt={name}
                      fallback={<span className={styles.seMatPh}>{name || '素材'}</span>}
                    />
                  </div>
                  <span className={styles.seMatLabel}>{name || '素材'}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 顶部:当前分镜图 + 历史生成 ── */}
      <div className={styles.seTop}>
        <div className={styles.seCurBox}>
          <div className={styles.seditCur} style={{ aspectRatio: aspect }}>
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
                        style={{ aspectRatio: aspect }}
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

      {/* ── 镜头N-分镜描述(只读;编辑/重新生成走左侧「编辑该分镜」弹框)── */}
      <div className={styles.seCard}>
        <div className={styles.seCardHead}>
          <span className={styles.seCardTitle}>{shot.no}-分镜描述</span>
        </div>
        <div className={styles.seDescRo}>{shot.desc || shot.imagePrompt || '（暂无分镜描述）'}</div>
      </div>

      {/* ── 台词 / 字幕 / 音效(全宽,即时自动保存)── */}
      {texts}
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
