/**
 * HotCopyEntry — 爆款复制「入口/上传」步(三步流程的第 1 步)。
 * 标题 + 两 Tab(同款翻拍 / 精准复刻)+ 卡片(左:上传爆款视频 / 上传替换素材;右:文案输入)
 * + @ 引用替换素材 + 圆形发送。受控:点发送回调 onSubmit(payload),由编排器(HotCopyCreateView)进入「准备素材」。
 * 不含壳子(侧栏/顶栏)与出视频逻辑——那些在编排器里。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useToast } from '@/composables/useToast'
import { fileToDataUrl } from '@/utils/imageFile'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { listAssets, extractAssetPageItems, getAssetDownloadUrl } from '@/api/business'
import { createMaterialFromAsset } from '@/utils/materials'
import MaterialLibraryPicker from '@/components/material/MaterialLibraryPicker'
import videoIcon from '@/assets/icons/hotcopy-video.svg'
import materialIcon from '@/assets/icons/hotcopy-material.svg'
import helpIcon from '@/assets/icons/help-circle.svg'
import './HotCopyEntry.css'

export type HotCopyTab = 'remake' | 'replica'
export type HotCopyVideoSource = '' | 'local' | 'library' | 'link'
export interface HotCopyProduct {
  url: string
  file: File
  isVideo: boolean
}
export interface HotCopyEntryPayload {
  tab: HotCopyTab
  videoSource: HotCopyVideoSource
  videoFile: File | null
  libraryVideo: { assetId: number; src: string } | null
  videoLink: string
  videoFileName: string
  videoPreview: string
  products: HotCopyProduct[]
  text: string
}

interface HotCopyEntryProps {
  onSubmit: (payload: HotCopyEntryPayload) => void
  /** 返回上一步时回填上次输入(数据存在编排器 state) */
  initial?: Partial<HotCopyEntryPayload>
}

const TABS = [
  {
    key: 'remake',
    title: '同款翻拍',
    sub: '拆解底层逻辑,创造爆款视频',
    tip: '保留原视频镜头节奏与爆点结构,把主体替换为你的产品。(案例示例待补充)',
  },
  {
    key: 'replica',
    title: '精准复刻',
    sub: '还原原作巅峰,复刻热门爆款',
    tip: '尽量 1:1 还原原视频画面与运镜,适合高度复用爆款模板。(案例示例待补充)',
  },
] as const

const LINK_PLATFORMS = '抖音 / 快手 / 小红书 / 视频号'
const MAX_PRODUCTS = 9

export default function HotCopyEntry({ onSubmit, initial }: HotCopyEntryProps) {
  const { showToast } = useToast()
  const workspaceId = useWorkspaceId()
  const [tab, setTab] = useState<HotCopyTab>((initial?.tab as HotCopyTab) ?? 'remake')

  // 爆款视频来源(本地/素材库/链接,三选一)
  const [videoMenuOpen, setVideoMenuOpen] = useState(false)
  const [videoSource, setVideoSource] = useState<HotCopyVideoSource>(initial?.videoSource ?? '')
  const [videoFile, setVideoFile] = useState<File | null>(initial?.videoFile ?? null)
  const [videoFileName, setVideoFileName] = useState(initial?.videoFileName ?? '')
  const [videoPreview, setVideoPreview] = useState(initial?.videoPreview ?? '')
  const [videoLink, setVideoLink] = useState(initial?.videoLink ?? '')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryMaterials, setLibraryMaterials] = useState<any[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryTab, setLibraryTab] = useState('mine')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryVideo, setLibraryVideo] = useState<{ assetId: number; src: string } | null>(
    initial?.libraryVideo ?? null,
  )
  const [linkInputOpen, setLinkInputOpen] = useState(initial?.videoSource === 'link')
  const videoFileRef = useRef<HTMLInputElement | null>(null)
  const videoMenuRef = useRef<HTMLDivElement | null>(null)

  // 替换素材(产品图/视频):保留 File 以便上传;isVideo 决定缩略图用 <video> 还是 <img>
  const [products, setProducts] = useState<HotCopyProduct[]>(initial?.products ?? [])
  const productFileRef = useRef<HTMLInputElement | null>(null)

  const [text, setText] = useState(initial?.text ?? '')
  // @ 引用替换素材(交互对齐智能成片;数据源是上传的替换素材 products)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const hlRef = useRef<HTMLDivElement | null>(null)
  const caretRef = useRef(0) // 最近一次光标位置(点 @ 会失焦,需提前记下)
  const [atOpen, setAtOpen] = useState(false)

  useEffect(() => {
    if (!videoMenuOpen) return
    const onDown = (e: PointerEvent) => {
      if (videoMenuRef.current && !videoMenuRef.current.contains(e.target as Node)) setVideoMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [videoMenuOpen])

  // 加载素材库里的视频素材(复用现有 listAssets + 签名URL + material 映射)
  const loadLibraryVideos = async () => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间', 'error')
      return
    }
    setLibraryLoading(true)
    try {
      const payload = await listAssets({ workspaceId: ws, type: 'video', limit: 100 })
      const assets = extractAssetPageItems(payload).filter((a: any) => a?.id && a.type === 'video')
      const mats = await Promise.all(
        assets.map(async (a: any) => {
          let src = ''
          try {
            src = await getAssetDownloadUrl({ workspaceId: ws, assetId: a.id })
          } catch {
            /* 取签名URL失败则回退缩略图 */
          }
          if (!src) src = a?.thumbnail_url || a?.preview_url || a?.cover_url || a?.url || ''
          return createMaterialFromAsset(a, src)
        }),
      )
      setLibraryMaterials(mats.filter((m: any) => m.src))
    } catch (e: any) {
      showToast(e?.message || '素材库加载失败', 'error')
    } finally {
      setLibraryLoading(false)
    }
  }

  // 素材库确认选择:取选中的(第一个)视频作为爆款视频源
  const confirmLibraryVideo = (picked: any[]) => {
    const v =
      (picked || []).find((m: any) => /video/i.test(String(m?.type || m?.serverAsset?.type || ''))) || picked?.[0]
    if (!v) {
      setLibraryOpen(false)
      return
    }
    const assetId = Number(v?.assetId || v?.serverAsset?.id || v?.id || 0) || 0
    if (!assetId) {
      showToast('该素材无法识别,请换一个', 'error')
      return
    }
    setLibraryVideo({ assetId, src: v?.src || '' })
    setVideoSource('library')
    setVideoFile(null)
    setVideoFileName(v?.name || v?.serverAsset?.name || '素材库视频')
    setVideoPreview((prev) => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return v?.src || ''
    })
    setVideoLink('')
    setLinkInputOpen(false)
    setLibraryOpen(false)
  }

  const chooseSource = (src: 'local' | 'library' | 'link') => {
    setVideoMenuOpen(false)
    if (src === 'local') {
      videoFileRef.current?.click()
    } else if (src === 'library') {
      setLibraryOpen(true)
      void loadLibraryVideos()
    } else {
      setVideoSource('link')
      setLinkInputOpen(true)
      setVideoFileName('')
    }
  }

  const pickVideo = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setVideoSource('local')
    setVideoFile(f)
    setVideoFileName(f.name)
    setVideoPreview((prev) => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
    setVideoLink('')
    setLinkInputOpen(false)
  }

  const clearVideo = () => {
    setVideoSource('')
    setVideoFile(null)
    setVideoFileName('')
    setVideoPreview((prev) => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return ''
    })
    setVideoLink('')
    setLinkInputOpen(false)
    setLibraryVideo(null)
  }

  const pickProducts = async (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_PRODUCTS - products.length
    if (room <= 0) {
      showToast(`最多上传 ${MAX_PRODUCTS} 张替换素材`, 'info')
      return
    }
    const sel = Array.from(files).slice(0, room)
    const picked = (
      await Promise.all(
        sel.map(async (f) => {
          const isVideo = /^video\//.test(f.type)
          // 视频用 objectURL 预览(fileToDataUrl 走 <img>,视频会读取失败);图片仍缩放成 dataURL
          const url = isVideo ? URL.createObjectURL(f) : (await fileToDataUrl(f).catch(() => '')) || ''
          return { url, file: f, isVideo }
        }),
      )
    ).filter((p) => p.url)
    if (picked.length) setProducts((prev) => [...prev, ...picked])
  }

  // 移除替换素材:视频的 objectURL 需回收,避免内存泄漏
  const removeProduct = (i: number) =>
    setProducts((arr) => {
      const p = arr[i]
      if (p?.isVideo && p.url.startsWith('blob:')) URL.revokeObjectURL(p.url)
      return arr.filter((_, j) => j !== i)
    })

  // ── @ 引用替换素材(对齐智能成片)──
  const insertAtCaret = (snippet: string) => {
    const pos = Math.min(caretRef.current, text.length)
    const next = text.slice(0, pos) + snippet + text.slice(pos)
    setText(next)
    const newPos = pos + snippet.length
    caretRef.current = newPos
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(newPos, newPos)
      }
    })
  }
  const handleAt = () => {
    const ta = taRef.current
    caretRef.current = ta ? (ta.selectionStart ?? text.length) : text.length
    if (products.length === 0) {
      insertAtCaret('@')
      return
    }
    setAtOpen(true)
  }
  // 某条替换素材的引用标签:图片→@图片N、视频→@视频N(各自按同类型顺序独立编号)
  const refLabel = (index: number) => {
    const p = products[index]
    const kind = p?.isVideo ? '视频' : '图片'
    const n = products.slice(0, index + 1).filter((q) => !!q.isVideo === !!p?.isVideo).length
    return `@${kind}${n}`
  }
  const pickRef = (index: number) => {
    insertAtCaret(`${refLabel(index)} `)
    setAtOpen(false)
  }
  // 高亮渲染:把「@图片N / @视频N」标绿,其余为普通文本(textarea 文字透明叠在此层上)
  const renderHighlight = (t: string): ReactNode[] | null => {
    if (!t) return null
    const out: ReactNode[] = []
    const re = /@(?:图片|视频)\d+/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) {
      if (m.index > last) out.push(t.slice(last, m.index))
      out.push(
        <span className="hotcopy__refTag" key={m.index}>
          {m[0]}
        </span>,
      )
      last = m.index + m[0].length
    }
    out.push(t.slice(last))
    return out
  }

  const videoLabel =
    videoSource === 'local'
      ? videoFileName
      : videoSource === 'library'
        ? videoFileName || '素材库视频'
        : videoSource === 'link'
          ? videoLink.trim() || '视频链接'
          : ''
  const hasHotVideo =
    (videoSource === 'local' && !!videoFile) ||
    (videoSource === 'library' && !!libraryVideo) ||
    (videoSource === 'link' && !!videoLink.trim())
  // 可进入下一步:爆款视频必传;替换素材可选
  const canSend = hasHotVideo

  const submit = () => {
    if (!hasHotVideo) {
      showToast('请先上传爆款视频(本地 / 素材库 / 视频链接)', 'error')
      return
    }
    if (videoSource === 'link') {
      showToast('暂不支持「视频链接」(需后端解析),请用本地上传或素材库', 'info')
      return
    }
    onSubmit({
      tab,
      videoSource,
      videoFile,
      libraryVideo,
      videoLink,
      videoFileName,
      videoPreview,
      products,
      text,
    })
  }

  return (
    <section className="hotcopy__main">
      {/* 背景渐变光晕(对齐智能成片做法,配色用本页 Figma 的粉紫) */}
      <div className="hotcopy__bg" aria-hidden="true">
        <div className="hotcopy__bg-lg" />
        <div className="hotcopy__bg-veil" />
      </div>

      <h1 className="hotcopy__title">爆款作业直接抄,你的产品当主角!</h1>

      <div className="hotcopy__panel">
        {/* 分段 Tab:同款翻拍 / 精准复刻(选中态白卡 + 名称 + ? + 副标题) */}
        <div className="hotcopy__tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`hotcopy__tab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className="hotcopy__tab-head">
                <span className="hotcopy__tab-name">{t.title}</span>
                <img
                  className="hotcopy__tip"
                  src={helpIcon}
                  alt=""
                  title={t.tip}
                  onClick={(e) => {
                    e.stopPropagation()
                    showToast(t.tip, 'info')
                  }}
                />
              </span>
              <span className="hotcopy__tab-sub">{t.sub}</span>
            </button>
          ))}
        </div>

        {/* 主卡片:左 两个上传方块 + 右 文案输入;底部 @ + 圆形发送 */}
        <div className="hotcopy__card">
          <div className="hotcopy__body">
            <div className="hotcopy__tiles">
              {/* 上传爆款视频(必填,点选三来源) */}
              <div className="hotcopy__tilewrap" ref={videoMenuRef}>
                <button
                  type="button"
                  className={`hotcopy__tile${hasHotVideo ? ' is-done' : ''}`}
                  onClick={() => setVideoMenuOpen((v) => !v)}
                >
                  <img className="hotcopy__tile-icon" src={videoIcon} alt="" />
                  <span className="hotcopy__tile-label">上传爆款视频</span>
                  {hasHotVideo && <span className="hotcopy__tile-badge">✓</span>}
                </button>
                {videoMenuOpen && (
                  <div className="hotcopy__menu" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => chooseSource('local')}>
                      本地上传
                    </button>
                    <button type="button" onClick={() => chooseSource('library')}>
                      素材库
                    </button>
                    <button type="button" onClick={() => chooseSource('link')}>
                      视频链接
                    </button>
                  </div>
                )}
              </div>

              {/* 上传替换素材(产品图/视频) */}
              <button
                type="button"
                className={`hotcopy__tile${products.length ? ' is-done' : ''}`}
                onClick={() => productFileRef.current?.click()}
              >
                <img className="hotcopy__tile-icon" src={materialIcon} alt="" />
                <span className="hotcopy__tile-label">上传替换素材</span>
                {products.length > 0 && <span className="hotcopy__tile-badge">{products.length}</span>}
              </button>
            </div>

            <div className="hotcopy__inputWrap">
              {/* 高亮层:渲染文本并把 @图片N 标绿;textarea 文字透明叠在其上 */}
              <div className="hotcopy__inputHl" ref={hlRef} aria-hidden="true">
                {renderHighlight(text)}
              </div>
              <textarea
                ref={taRef}
                className="hotcopy__text"
                value={text}
                placeholder="最多上传9张图片,输入文字或@参考素材,生成精彩广告视频。例如:把 @图片1 中的产品放到 @图片2 中的场景里"
                onChange={(e) => {
                  setText(e.target.value)
                  caretRef.current = e.target.selectionStart ?? e.target.value.length
                }}
                onScroll={(e) => {
                  if (hlRef.current) hlRef.current.scrollTop = e.currentTarget.scrollTop
                }}
                onSelect={(e) => {
                  caretRef.current = e.currentTarget.selectionStart ?? 0
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) submit()
                }}
              />
            </div>
          </div>

          {/* 已选爆款视频 / 视频链接 / 替换素材缩略(有内容才显示) */}
          {(videoLabel || linkInputOpen || products.length > 0) && (
            <div className="hotcopy__selected">
              {/* 爆款视频:有预览(本地/素材库)用缩略图,否则(链接)用文字 chip */}
              {videoPreview ? (
                <div className="hotcopy__product hotcopy__product--hot" title={videoLabel}>
                  <video src={videoPreview} muted playsInline />
                  <span className="hotcopy__hotTag">爆款</span>
                  <button type="button" onClick={clearVideo} aria-label="移除">
                    ×
                  </button>
                </div>
              ) : (
                videoLabel && (
                  <span className="hotcopy__chip" title={videoLabel}>
                    🎬 {videoLabel}
                    <button type="button" onClick={clearVideo} aria-label="移除">
                      ×
                    </button>
                  </span>
                )
              )}
              {linkInputOpen && (
                <input
                  className="hotcopy__link"
                  value={videoLink}
                  autoFocus
                  placeholder={`粘贴视频链接(${LINK_PLATFORMS})`}
                  onChange={(e) => setVideoLink(e.target.value)}
                />
              )}
              {products.length > 0 && (
                <div className="hotcopy__products">
                  {products.map((p, i) => (
                    <div className="hotcopy__product" key={i}>
                      {p.isVideo ? <video src={p.url} muted playsInline /> : <img src={p.url} alt="" />}
                      <button type="button" onClick={() => removeProduct(i)} aria-label="移除">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 底部:@ 参考素材(左) + 圆形发送(右) */}
          <div className="hotcopy__bottom">
            <span className="hotcopy__atAnchor">
              <button type="button" className="hotcopy__at" onClick={handleAt} title="引用替换素材">
                @
              </button>
              {/* @ 素材选择:在 @ 按钮上方弹出,数据源是上传的替换素材 */}
              {atOpen && (
                <>
                  <div className="hotcopy__atMask" onClick={() => setAtOpen(false)} />
                  <div className="hotcopy__atMenu">
                    <div className="hotcopy__atMenuTitle">选择替换素材</div>
                    <div className="hotcopy__atMenuGrid">
                      {products.map((p, i) => (
                        <button type="button" className="hotcopy__atItem" key={i} onClick={() => pickRef(i)}>
                          {p.isVideo ? <video src={p.url} muted playsInline /> : <img src={p.url} alt="" />}
                          <span className="hotcopy__atItemName">{refLabel(i)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </span>
            <button
              type="button"
              className="hotcopy__send"
              disabled={!canSend}
              onClick={submit}
              aria-label="下一步"
              title="下一步:准备素材(需先上传爆款视频)"
            >
              {/* 发送图标:就绪=品牌绿(#1FCFA9),否则禁用灰(#D9D9D9)——与智能成片一致 */}
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M34.1395 5.85926C26.3291 -1.95309 13.6662 -1.95309 5.85779 5.85926C-1.95064 13.6716 -1.95455 26.332 5.85779 34.1424C13.6701 41.9528 26.3305 41.9523 34.1409 34.1424C41.9513 26.3325 41.9494 13.6677 34.1395 5.85926ZM30.6669 18.5416L22.8687 24.4673C22.8072 24.5144 22.7338 24.5435 22.6567 24.5512C22.5796 24.5589 22.5019 24.545 22.4323 24.5109C22.3627 24.4769 22.304 24.4241 22.2627 24.3585C22.2215 24.2929 22.1993 24.2171 22.1988 24.1397V21.4981C22.1983 21.3926 22.1577 21.2911 22.0851 21.2145C22.0126 21.1378 21.9135 21.0917 21.8082 21.0855C18.2711 20.8629 15.1711 21.2349 13.072 23.4409C11.9978 24.5703 10.7024 26.81 10.3924 27.4672C10.3484 27.56 10.2674 27.7319 10.0721 27.7968L10.055 27.8022C9.98791 27.8233 9.9166 27.8271 9.84765 27.8134C9.77869 27.7997 9.71431 27.7688 9.66045 27.7236C9.47589 27.5688 9.36407 27.475 10.1058 24.4468C11.3631 19.3199 16.2702 15.9689 21.8282 15.3527C21.9297 15.3421 22.0238 15.2944 22.0923 15.2187C22.1607 15.143 22.1989 15.0447 22.1993 14.9426V12.2883C22.2002 12.2111 22.2227 12.1357 22.264 12.0704C22.3054 12.0052 22.3641 11.9528 22.4335 11.919C22.503 11.8852 22.5804 11.8714 22.6573 11.8791C22.7341 11.8868 22.8073 11.9157 22.8687 11.9627L30.6669 17.8864C30.7176 17.9246 30.7588 17.9741 30.7872 18.0309C30.8155 18.0878 30.8303 18.1505 30.8303 18.214C30.8303 18.2775 30.8155 18.3402 30.7872 18.3971C30.7588 18.4539 30.7176 18.5034 30.6669 18.5416Z"
                  fill={canSend ? '#1FCFA9' : '#D9D9D9'}
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <input
        ref={videoFileRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          pickVideo(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={productFileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          pickProducts(e.target.files)
          e.target.value = ''
        }}
      />

      {/* 素材库选择器(选爆款视频):直接复用现有 MaterialLibraryPicker */}
      <MaterialLibraryPicker
        modelValue={libraryOpen}
        onModelValueChange={setLibraryOpen}
        workspaceId={Number(workspaceId || 0)}
        projectName="爆款复刻"
        materials={libraryMaterials}
        tab={libraryTab}
        query={libraryQuery}
        isLoading={libraryLoading}
        onTabChange={setLibraryTab}
        onQueryChange={setLibraryQuery}
        onConfirm={confirmLibraryVideo}
      />
    </section>
  )
}
