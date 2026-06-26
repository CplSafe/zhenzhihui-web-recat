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
import HotCopyCaseModal, { type HotCopyCaseTab } from '@/components/hotcopy/HotCopyCaseModal/HotCopyCaseModal'
import EntryCanvasBg, { type BgLayerStops } from '@/components/smart/EntryCanvasBg'
import videoIcon from '@/assets/icons/hotcopy-video.svg'
import materialIcon from '@/assets/icons/hotcopy-material.svg'
import helpIcon from '@/assets/icons/help-circle.svg'
import './HotCopyEntry.css'

export type HotCopyTab = 'remake' | 'replica'
export type HotCopyVideoSource = '' | 'local' | 'library'
export interface HotCopyProduct {
  url: string
  /** 本地选择带 File(待上传);素材库选择无 File(已有 assetId) */
  file: File | null
  isVideo: boolean
  /** 素材库选中的替换素材已有 asset_id;本地上传的留空,出片前再上传 */
  assetId?: number
}
export interface HotCopyEntryPayload {
  tab: HotCopyTab
  videoSource: HotCopyVideoSource
  videoFile: File | null
  libraryVideo: { assetId: number; src: string } | null
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

const MAX_PRODUCTS = 9

// 爆款复制背景配色(粉紫,取自本页 Figma):底部粉 + 紫色光晕 + 淡粉核
const HOTCOPY_LAYERS: BgLayerStops = {
  bottom: [
    [0, 'rgba(217,131,237,0)'],
    [0.38, 'rgba(217,131,237,0.12)'], // 紫
    [0.72, 'rgba(255,178,208,0.14)'], // 过渡粉
    [1, 'rgba(255,178,208,0.3)'], // 底部粉
  ],
  halo: [
    [0, 'rgba(217,131,237,0.08)'], // 紫核
    [0.45, 'rgba(190,108,233,0.12)'], // 紫
    [0.78, 'rgba(170,85,227,0.12)'], // 紫环
    [1, 'rgba(170,85,227,0)'],
  ],
  core: [
    [0, 'rgba(255,178,208,0.16)'], // 淡粉
    [1, 'rgba(255,178,208,0)'],
  ],
}

export default function HotCopyEntry({ onSubmit, initial }: HotCopyEntryProps) {
  const { showToast } = useToast()
  const workspaceId = useWorkspaceId()
  const [tab, setTab] = useState<HotCopyTab>((initial?.tab as HotCopyTab) ?? 'remake')
  // 点击 Tab 旁的「?」打开对应案例弹窗(Figma 还原);null=关闭
  const [caseTab, setCaseTab] = useState<HotCopyCaseTab | null>(null)
  // 切换 Tab:背景的位移/上升动画由 <EntryCanvasBg mode={tab}> 监听 tab 变化驱动
  const switchTab = (k: HotCopyTab) => {
    if (k === tab) return
    setTab(k)
  }

  // 爆款视频来源(本地 / 素材库,二选一)
  const [videoMenuOpen, setVideoMenuOpen] = useState(false)
  const [videoSource, setVideoSource] = useState<HotCopyVideoSource>(initial?.videoSource ?? '')
  const [videoFile, setVideoFile] = useState<File | null>(initial?.videoFile ?? null)
  const [videoFileName, setVideoFileName] = useState(initial?.videoFileName ?? '')
  const [videoPreview, setVideoPreview] = useState(initial?.videoPreview ?? '')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryMaterials, setLibraryMaterials] = useState<any[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryTab, setLibraryTab] = useState('mine')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryVideo, setLibraryVideo] = useState<{ assetId: number; src: string } | null>(
    initial?.libraryVideo ?? null,
  )
  const videoFileRef = useRef<HTMLInputElement | null>(null)
  const videoMenuRef = useRef<HTMLDivElement | null>(null)

  // 替换素材(仅图片):本地上传保留 File 待上传;素材库选择带 assetId
  const [products, setProducts] = useState<HotCopyProduct[]>(initial?.products ?? [])
  const productFileRef = useRef<HTMLInputElement | null>(null)
  // 替换素材来源菜单(本地 / 素材库)+ 素材库选图弹窗
  const [productMenuOpen, setProductMenuOpen] = useState(false)
  const productMenuRef = useRef<HTMLDivElement | null>(null)
  const [productLibOpen, setProductLibOpen] = useState(false)
  const [productLibMaterials, setProductLibMaterials] = useState<any[]>([])
  const [productLibLoading, setProductLibLoading] = useState(false)
  const [productLibTab, setProductLibTab] = useState('mine')
  const [productLibQuery, setProductLibQuery] = useState('')

  const [text, setText] = useState(initial?.text ?? '')
  // @ 引用替换素材(交互对齐智能成片;数据源是上传的替换素材 products)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const hlRef = useRef<HTMLDivElement | null>(null)
  const caretRef = useRef(0) // 最近一次光标位置(点 @ 会失焦,需提前记下)
  const [atOpen, setAtOpen] = useState(false)

  useEffect(() => {
    if (!videoMenuOpen && !productMenuOpen) return
    const onDown = (e: PointerEvent) => {
      if (videoMenuRef.current && !videoMenuRef.current.contains(e.target as Node)) setVideoMenuOpen(false)
      if (productMenuRef.current && !productMenuRef.current.contains(e.target as Node)) setProductMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [videoMenuOpen, productMenuOpen])

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
    setLibraryOpen(false)
  }

  const chooseSource = (src: 'local' | 'library') => {
    setVideoMenuOpen(false)
    if (src === 'local') {
      videoFileRef.current?.click()
    } else {
      setLibraryOpen(true)
      void loadLibraryVideos()
    }
  }

  // 加载素材库里的图片素材(替换素材只用图片)
  const loadLibraryImages = async () => {
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间', 'error')
      return
    }
    setProductLibLoading(true)
    try {
      const payload = await listAssets({ workspaceId: ws, type: 'image', limit: 100 })
      const assets = extractAssetPageItems(payload).filter((a: any) => a?.id && a.type === 'image')
      const mats = await Promise.all(
        assets.map(async (a: any) => {
          let src = ''
          try {
            src = await getAssetDownloadUrl({ workspaceId: ws, assetId: a.id })
          } catch {
            /* 取签名URL失败则回退缩略图 */
          }
          if (!src) src = a?.thumbnail_url || a?.preview_url || a?.url || ''
          return createMaterialFromAsset(a, src)
        }),
      )
      setProductLibMaterials(mats.filter((m: any) => m.src))
    } catch (e: any) {
      showToast(e?.message || '素材库加载失败', 'error')
    } finally {
      setProductLibLoading(false)
    }
  }

  // 替换素材来源:本地上传 / 素材库选图
  const chooseProductSource = (src: 'local' | 'library') => {
    setProductMenuOpen(false)
    if (src === 'local') {
      productFileRef.current?.click()
    } else {
      setProductLibOpen(true)
      void loadLibraryImages()
    }
  }

  // 素材库确认:把选中的图片素材(带 assetId)加入替换素材
  const confirmLibraryProducts = (picked: any[]) => {
    const room = MAX_PRODUCTS - products.length
    const imgs = (picked || [])
      .filter((m: any) => !/video/i.test(String(m?.type || m?.serverAsset?.type || '')))
      .slice(0, Math.max(0, room))
      .map((m: any) => ({
        url: m?.src || '',
        file: null as File | null,
        isVideo: false,
        assetId: Number(m?.assetId || m?.serverAsset?.id || m?.id || 0) || 0,
      }))
      .filter((p: HotCopyProduct) => p.url && p.assetId)
    if (imgs.length) setProducts((prev) => [...prev, ...imgs])
    if (room <= 0) showToast(`最多上传 ${MAX_PRODUCTS} 张替换素材`, 'info')
    setProductLibOpen(false)
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
  }

  const clearVideo = () => {
    setVideoSource('')
    setVideoFile(null)
    setVideoFileName('')
    setVideoPreview((prev) => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return ''
    })
    setLibraryVideo(null)
  }

  // 替换素材本地上传:仅图片,缩放成 dataURL 预览,留 File 待出片前上传成 asset
  const pickProducts = async (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_PRODUCTS - products.length
    if (room <= 0) {
      showToast(`最多上传 ${MAX_PRODUCTS} 张替换素材`, 'info')
      return
    }
    const sel = Array.from(files)
      .filter((f) => /^image\//.test(f.type))
      .slice(0, room)
    const picked = (
      await Promise.all(
        sel.map(async (f) => ({ url: (await fileToDataUrl(f).catch(() => '')) || '', file: f, isVideo: false })),
      )
    ).filter((p) => p.url)
    if (picked.length) setProducts((prev) => [...prev, ...picked])
  }

  const removeProduct = (i: number) => setProducts((arr) => arr.filter((_, j) => j !== i))

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
    videoSource === 'local' ? videoFileName : videoSource === 'library' ? videoFileName || '素材库视频' : ''
  const hasHotVideo = (videoSource === 'local' && !!videoFile) || (videoSource === 'library' && !!libraryVideo)
  // 至少一张替换素材【图片】(products 里 isVideo=false 的)
  const hasProductImage = products.some((p) => !p.isVideo)
  // 齐全(视频 + 图片都有)才点亮发送图标;但按钮始终可点,缺哪个由 submit 弹提示
  const canSend = hasHotVideo && hasProductImage

  const submit = () => {
    if (!hasHotVideo) {
      showToast('请先上传爆款视频(本地上传 / 素材库)', 'error')
      return
    }
    if (!hasProductImage) {
      showToast('请至少上传一张替换素材图片', 'error')
      return
    }
    onSubmit({
      tab,
      videoSource,
      videoFile,
      libraryVideo,
      videoFileName,
      videoPreview,
      products,
      text,
    })
  }

  return (
    <section className="hotcopy__main" data-tab={tab}>
      {/* 背景弥散:Canvas 实现(与智能成片同一套),配色用本页粉紫;切 Tab 时从底部上升 */}
      <div className="hotcopy__bg" aria-hidden="true">
        <EntryCanvasBg index={tab === 'replica' ? 1 : 0} count={2} anim="bloom" layers={HOTCOPY_LAYERS} />
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
              onClick={() => switchTab(t.key)}
            >
              <span className="hotcopy__tab-head">
                <span className="hotcopy__tab-name">{t.title}</span>
                <img
                  className="hotcopy__tip"
                  src={helpIcon}
                  alt=""
                  title={`查看${t.title}案例`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setCaseTab(t.key as HotCopyCaseTab)
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
                  </div>
                )}
              </div>

              {/* 上传替换素材(仅图片,点选 本地 / 素材库) */}
              <div className="hotcopy__tilewrap" ref={productMenuRef}>
                <button
                  type="button"
                  className={`hotcopy__tile${products.length ? ' is-done' : ''}`}
                  onClick={() => setProductMenuOpen((v) => !v)}
                >
                  <img className="hotcopy__tile-icon" src={materialIcon} alt="" />
                  <span className="hotcopy__tile-label">上传替换素材</span>
                  {products.length > 0 && <span className="hotcopy__tile-badge">{products.length}</span>}
                </button>
                {productMenuOpen && (
                  <div className="hotcopy__menu" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => chooseProductSource('local')}>
                      本地上传
                    </button>
                    <button type="button" onClick={() => chooseProductSource('library')}>
                      素材库
                    </button>
                  </div>
                )}
              </div>
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
                  // Ctrl/Cmd+Enter 也走 submit:缺视频/图片会弹提示(校验在 submit 内)
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
                }}
              />
            </div>
          </div>

          {/* 已选爆款视频 / 替换素材缩略(有内容才显示) */}
          {(videoLabel || products.length > 0) && (
            <div className="hotcopy__selected">
              {/* 爆款视频:有预览(本地/素材库)用缩略图,否则用文字 chip */}
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
              {products.length > 0 && (
                <div className="hotcopy__products">
                  {products.map((p, i) => (
                    <div className="hotcopy__product" key={i}>
                      <img src={p.url} alt="" />
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
                          <img src={p.url} alt="" />
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
              /* 不禁用:缺视频/图片时点击会弹提示(校验在 submit 内);图标颜色仍按 canSend 变绿/灰 */
              onClick={submit}
              aria-label="下一步"
              title="下一步:生成视频(需先上传爆款视频 + 至少一张替换素材图片)"
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
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          pickProducts(e.target.files)
          e.target.value = ''
        }}
      />

      {/* 素材库选择器(选爆款视频) */}
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

      {/* 素材库选择器(选替换素材图片,可多选) */}
      <MaterialLibraryPicker
        modelValue={productLibOpen}
        onModelValueChange={setProductLibOpen}
        workspaceId={Number(workspaceId || 0)}
        projectName="替换素材"
        materials={productLibMaterials}
        tab={productLibTab}
        query={productLibQuery}
        isLoading={productLibLoading}
        onTabChange={setProductLibTab}
        onQueryChange={setProductLibQuery}
        onConfirm={confirmLibraryProducts}
      />

      {/* 同款翻拍 / 精准复刻 案例弹窗(点 Tab 旁「?」打开) */}
      <HotCopyCaseModal tab={caseTab} onClose={() => setCaseTab(null)} />
    </section>
  )
}
