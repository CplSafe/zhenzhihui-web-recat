/**
 * HotCopyView — 爆款复制(2.1)入口页(按设计稿:紧凑面板,粉色系)。
 * 标题 + 两 Tab(同款翻拍 / 精准复刻,名称 + ? + 副标题)+ 卡片(左:上传爆款视频 / 上传替换素材;右:文案输入)
 * + 底部工具(风格/比例/时长/@)+ 创建复刻任务。
 * 爆款视频必填(本地 / 素材库 / 视频链接);创建前校验。后续步骤复用智能成片流程。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import AppToast from '@/components/AppToast'
import EntryDropdown from '@/components/smart/EntryDropdown'
import { useToast } from '@/composables/useToast'
import { fileToDataUrl } from '@/utils/imageFile'
import {
  useWorkspaceId,
  useModelPlanCandidates,
  useWorkspaceSessionStore,
  deriveModelPlanCandidates,
} from '@/stores/workspaceSession'
import { replicateHotVideo, uploadHotCopyAsset } from '@/api/hotCopy'
import { listAssets, extractAssetPageItems, getAssetDownloadUrl } from '@/api/business'
import { createMaterialFromAsset } from '@/utils/materials'
import MaterialLibraryPicker from '@/components/material/MaterialLibraryPicker'
import './HotCopyView.css'

const ROUTE_MAP: Record<string, string> = {
  home: '/home',
  creative: '/smart',
  'hot-copy': '/hot-copy',
  projects: '/projects',
  resources: '/resources',
  templates: '/templates',
}

const TABS = [
  {
    key: 'remake',
    title: '同款翻拍',
    sub: '拆解爆点逻辑,保留节奏换产品',
    tip: '保留原视频镜头节奏与爆点结构,把主体替换为你的产品。(案例示例待补充)',
  },
  {
    key: 'replica',
    title: '精准复刻',
    sub: '还原爆款巅峰,复刻热门原版',
    tip: '尽量 1:1 还原原视频画面与运镜,适合高度复用爆款模板。(案例示例待补充)',
  },
] as const

const STYLE_OPTIONS = ['叫卖', '幽默', '商业', '治愈', '科技感', '剧情']
const RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const DURATION_OPTIONS = ['5s', '10s', '15s']
const LINK_PLATFORMS = '抖音 / 快手 / 小红书 / 视频号'
const MAX_PRODUCTS = 9

// 修进度条 bug:部分 MP4 初始 duration=Infinity → 进度条从中间开始
function fixVideoDuration(e: React.SyntheticEvent<HTMLVideoElement>) {
  const v = e.currentTarget
  if (!Number.isFinite(v.duration)) {
    const back = () => {
      v.currentTime = 0
      v.removeEventListener('timeupdate', back)
    }
    v.addEventListener('timeupdate', back)
    v.currentTime = 1e7
  }
}

export default function HotCopyView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const workspaceId = useWorkspaceId()
  const modelPlanCandidates = useModelPlanCandidates() as string[]
  const ensureModelPlanCandidatesLoaded = useWorkspaceSessionStore((s) => s.ensureModelPlanCandidatesLoaded)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('remake')

  // 爆款视频来源(本地/素材库/链接,三选一)
  const [videoMenuOpen, setVideoMenuOpen] = useState(false)
  const [videoSource, setVideoSource] = useState<'' | 'local' | 'library' | 'link'>('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoFileName, setVideoFileName] = useState('')
  const [videoLink, setVideoLink] = useState('')
  // 素材库选择器(从素材库选爆款视频);选中的视频已是后端 asset,创建时直接用 assetId,无需再上传
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryMaterials, setLibraryMaterials] = useState<any[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryTab, setLibraryTab] = useState('mine')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryVideo, setLibraryVideo] = useState<{ assetId: number; src: string } | null>(null)
  const [linkInputOpen, setLinkInputOpen] = useState(false)
  const videoFileRef = useRef<HTMLInputElement | null>(null)
  const videoMenuRef = useRef<HTMLDivElement | null>(null)

  // 替换素材(产品多图):保留 File 以便上传
  const [products, setProducts] = useState<{ url: string; file: File }[]>([])
  const productFileRef = useRef<HTMLInputElement | null>(null)

  const [text, setText] = useState('')
  // 风格多选(对齐智能成片),提交时合并成风格串
  const [styleTags, setStyleTags] = useState<string[]>(['商业'])
  const [ratio, setRatio] = useState('9:16')
  const [duration, setDuration] = useState('10s')
  const [creating, setCreating] = useState(false)
  const [phase, setPhase] = useState('')
  const [resultUrl, setResultUrl] = useState('')

  const resolvePlanCandidates = async (): Promise<string[]> => {
    try {
      await ensureModelPlanCandidatesLoaded()
    } catch {
      /* 失败用兜底候选 */
    }
    return (deriveModelPlanCandidates(useWorkspaceSessionStore.getState()) as string[]) || modelPlanCandidates
  }

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
    setVideoLink('')
    setLinkInputOpen(false)
  }

  const clearVideo = () => {
    setVideoSource('')
    setVideoFile(null)
    setVideoFileName('')
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
      await Promise.all(sel.map(async (f) => ({ url: (await fileToDataUrl(f).catch(() => '')) || '', file: f })))
    ).filter((p) => p.url)
    if (picked.length) setProducts((prev) => [...prev, ...picked])
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

  const createTask = async () => {
    if (creating) return
    if (!hasHotVideo) {
      showToast('请先上传爆款视频(本地 / 素材库 / 视频链接)', 'error')
      return
    }
    const ws = Number(workspaceId || 0)
    if (!ws) {
      showToast('未选择工作空间', 'error')
      return
    }
    // 视频链接源需后端解析接口,暂不支持;本地上传与素材库可直接用
    if (videoSource === 'link') {
      showToast('暂不支持「视频链接」(需后端解析),请用本地上传或素材库', 'info')
      return
    }
    // video.replicate 后端要求:源视频 + 1~9 张主体图(替换素材)均必填
    if (!products.length) {
      showToast('请至少上传 1 张替换素材(产品主体图)', 'error')
      return
    }
    setCreating(true)
    setResultUrl('')
    try {
      const plans = await resolvePlanCandidates()
      // 源视频 asset:素材库已是 asset 直接用其 assetId;本地上传需先传得 assetId
      let videoAssetId = 0
      if (videoSource === 'library' && libraryVideo) {
        videoAssetId = libraryVideo.assetId
      } else if (videoSource === 'local' && videoFile) {
        setPhase('上传源视频…')
        videoAssetId = await uploadHotCopyAsset(ws, videoFile)
      }
      if (!videoAssetId) throw new Error('源视频获取失败')
      setPhase('上传替换素材…')
      const productAssetIds: number[] = []
      for (const p of products) {
        try {
          const id = await uploadHotCopyAsset(ws, p.file)
          if (id) productAssetIds.push(id)
        } catch {
          /* 单张失败跳过 */
        }
      }
      const prompt = [
        text.trim(),
        productAssetIds.length ? '把源视频中的主体替换为参考图中的产品,保留原视频的镜头节奏与爆点结构。' : '',
        tab === 'replica' ? '尽量 1:1 还原原视频画面与运镜。' : '',
        styleTags.length > 0 && `整体风格:${styleTags.join('、')}。`,
      ]
        .filter(Boolean)
        .join('\n')
      setPhase('AI 拆解源视频并复刻生成中…(耗时较长)')
      const { url } = await replicateHotVideo({
        workspaceId: ws,
        videoAssetId,
        productAssetIds,
        prompt,
        ratio,
        durationSec: parseInt(duration, 10) || 10,
        modelPlanCandidates: plans,
      })
      setResultUrl(url)
      showToast('复刻完成', 'success')
    } catch (e: any) {
      showToast(`复刻失败:${e?.message || '请稍后重试'}`, 'error')
    } finally {
      setPhase('')
      setCreating(false)
    }
  }

  const activeTab = TABS.find((t) => t.key === tab)!

  return (
    <div className="hotcopy">
      <AppSidebar
        activeKey="hot-copy"
        onNavigate={(k) => (ROUTE_MAP[k] ? navigate(ROUTE_MAP[k]) : showToast('功能待开放', 'info'))}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="hotcopy__shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} onMember={() => showToast('会员中心待开放', 'info')} />
        <AppToast />

        <section className="hotcopy__main">
          <h1 className="hotcopy__title">爆款作业直接抄,你的产品当主角</h1>

          <div className="hotcopy__panel">
            {/* 两 Tab:名称 + ? + 副标题 */}
            <div className="hotcopy__tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`hotcopy__tab${tab === t.key ? ' is-active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  <span className="hotcopy__tab-name">{t.title}</span>
                  <span
                    className="hotcopy__tip"
                    title={t.tip}
                    onClick={(e) => {
                      e.stopPropagation()
                      showToast(t.tip, 'info')
                    }}
                  >
                    ?
                  </span>
                  <span className="hotcopy__tab-sub">{t.sub}</span>
                </button>
              ))}
            </div>

            {/* 卡片:左 上传(爆款视频 / 替换素材) + 右 文案 */}
            <div className="hotcopy__card">
              <div className="hotcopy__card-body">
                <div className="hotcopy__uploads">
                  {/* 上传爆款视频(必填,下拉三来源) */}
                  <div className="hotcopy__videowrap" ref={videoMenuRef}>
                    <button
                      type="button"
                      className={`hotcopy__upbtn${hasHotVideo ? ' is-done' : ''}`}
                      onClick={() => setVideoMenuOpen((v) => !v)}
                    >
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
                        <rect x="3" y="6" width="13" height="12" rx="2" />
                        <path d="m16 10 5-3v10l-5-3z" />
                      </svg>
                      上传爆款视频
                      <span className="hotcopy__req">*</span>
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

                  {/* 上传替换素材 */}
                  <button
                    type="button"
                    className={`hotcopy__upbtn${products.length ? ' is-done' : ''}`}
                    onClick={() => productFileRef.current?.click()}
                  >
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
                      <path d="M4 5h6l2 2h8v10a2 2 0 0 1-2 2H4z" />
                    </svg>
                    上传替换素材
                    <span className="hotcopy__req">*</span>
                  </button>

                  {/* 已选爆款视频 chip */}
                  {videoLabel && (
                    <span className="hotcopy__chip" title={videoLabel}>
                      🎬 {videoLabel}
                      <button type="button" onClick={clearVideo} aria-label="移除">
                        ×
                      </button>
                    </span>
                  )}
                  {/* 视频链接输入 */}
                  {linkInputOpen && (
                    <input
                      className="hotcopy__link"
                      value={videoLink}
                      autoFocus
                      placeholder={`粘贴视频链接(${LINK_PLATFORMS})`}
                      onChange={(e) => setVideoLink(e.target.value)}
                    />
                  )}
                  {/* 替换素材缩略 */}
                  {products.length > 0 && (
                    <div className="hotcopy__products">
                      {products.map((p, i) => (
                        <div className="hotcopy__product" key={i}>
                          <img src={p.url} alt="" />
                          <button
                            type="button"
                            onClick={() => setProducts((arr) => arr.filter((_, j) => j !== i))}
                            aria-label="移除"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <textarea
                  className="hotcopy__text"
                  value={text}
                  placeholder="输入文字或@参考素材,生成精彩广告视频。例如:把 @图片1 中的产品放到 @图片2 中的场景里"
                  onChange={(e) => setText(e.target.value)}
                />
              </div>

              {/* 底部工具 + 创建 */}
              <div className="hotcopy__toolbar">
                <div className="hotcopy__tools">
                  <EntryDropdown
                    multiple
                    placeholder="风格"
                    value={styleTags}
                    options={STYLE_OPTIONS}
                    onChange={setStyleTags}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                          d="M9.75 2C12.0706 2 14.2962 2.92187 15.9372 4.56282C17.5781 6.20376 18.5 8.42936 18.5 10.75C18.5 13.1838 17.2038 13.38 15.65 13.295L14.4325 13.2075C13.3888 13.1425 12.3488 13.1675 11.595 13.8113C9.33625 15.1213 15.4825 19.5 9.75 19.5C7.42936 19.5 5.20376 18.5781 3.56282 16.9372C1.92187 15.2962 1 13.0706 1 10.75C1 8.42936 1.92187 6.20376 3.56282 4.56282C5.20376 2.92187 7.42936 2 9.75 2ZM9.75 3.25C8.76509 3.25 7.78982 3.44399 6.87987 3.8209C5.96993 4.19781 5.14314 4.75026 4.4467 5.4467C3.75026 6.14314 3.19781 6.96993 2.8209 7.87987C2.44399 8.78982 2.25 9.76509 2.25 10.75C2.25 11.7349 2.44399 12.7102 2.8209 13.6201C3.19781 14.5301 3.75026 15.3569 4.4467 16.0533C5.14314 16.7497 5.96993 17.3022 6.87987 17.6791C7.78982 18.056 8.76509 18.25 9.75 18.25C10.245 18.25 10.62 18.2125 10.8725 18.1538L11.0075 18.1162L10.9363 17.9175C10.8434 17.6818 10.7429 17.4492 10.635 17.22L10.535 17.0087C9.53375 14.9012 9.335 13.7662 10.7975 12.8337L10.8787 12.7825L10.895 12.77L10.965 12.7137L10.98 12.7013C11.845 12.0525 12.8225 11.8837 14.2263 11.945L14.5588 11.9637L15.5113 12.0325C16.3238 12.0837 16.675 12.0612 16.9088 11.9563C17.1187 11.8625 17.25 11.5988 17.25 10.75C17.25 8.76088 16.4598 6.85322 15.0533 5.4467C13.6468 4.04018 11.7391 3.25 9.75 3.25ZM6.625 12.0562C7.12228 12.0562 7.59919 12.2538 7.95083 12.6054C8.30246 12.9571 8.5 13.434 8.5 13.9312C8.5 14.4285 8.30246 14.9054 7.95083 15.2571C7.59919 15.6087 7.12228 15.8062 6.625 15.8062C6.12772 15.8062 5.65081 15.6087 5.29917 15.2571C4.94754 14.9054 4.75 14.4285 4.75 13.9312C4.75 13.434 4.94754 12.9571 5.29917 12.6054C5.65081 12.2538 6.12772 12.0563 6.625 12.0562ZM6.625 13.3062C6.45924 13.3062 6.30027 13.3721 6.18306 13.4893C6.06585 13.6065 6 13.7655 6 13.9312C6 14.097 6.06585 14.256 6.18306 14.3732C6.30027 14.4904 6.45924 14.5562 6.625 14.5562C6.79076 14.5562 6.94973 14.4904 7.06694 14.3732C7.18415 14.256 7.25 14.097 7.25 13.9312C7.25 13.7655 7.18415 13.6065 7.06694 13.4893C6.94973 13.3721 6.79076 13.3062 6.625 13.3062ZM12.8763 5.7525C13.1225 5.7525 13.3663 5.801 13.5938 5.89523C13.8213 5.98945 14.028 6.12756 14.2021 6.30167C14.3762 6.47578 14.5143 6.68248 14.6085 6.90997C14.7028 7.13745 14.7513 7.38127 14.7513 7.6275C14.7513 7.87373 14.7028 8.11755 14.6085 8.34503C14.5143 8.57252 14.3762 8.77922 14.2021 8.95333C14.028 9.12744 13.8213 9.26555 13.5938 9.35977C13.3663 9.454 13.1225 9.5025 12.8763 9.5025C12.379 9.5025 11.9021 9.30496 11.5504 8.95333C11.1988 8.60169 11.0013 8.12478 11.0013 7.6275C11.0013 7.13022 11.1988 6.65331 11.5504 6.30167C11.9021 5.95004 12.379 5.7525 12.8763 5.7525ZM6.625 5.75C6.87123 5.75 7.11505 5.7985 7.34253 5.89273C7.57002 5.98695 7.77672 6.12506 7.95083 6.29917C8.12494 6.47328 8.26305 6.67998 8.35727 6.90747C8.4515 7.13495 8.5 7.37877 8.5 7.625C8.5 7.87123 8.4515 8.11505 8.35727 8.34253C8.26305 8.57002 8.12494 8.77672 7.95083 8.95083C7.77672 9.12494 7.57002 9.26305 7.34253 9.35727C7.11505 9.4515 6.87123 9.5 6.625 9.5C6.12772 9.5 5.65081 9.30246 5.29917 8.95083C4.94754 8.59919 4.75 8.12228 4.75 7.625C4.75 7.12772 4.94754 6.65081 5.29917 6.29917C5.65081 5.94754 6.12772 5.75 6.625 5.75ZM12.8763 7.0025C12.7105 7.0025 12.5515 7.06835 12.4343 7.18556C12.3171 7.30277 12.2513 7.46174 12.2513 7.6275C12.2513 7.79326 12.3171 7.95223 12.4343 8.06944C12.5515 8.18665 12.7105 8.2525 12.8763 8.2525C13.042 8.2525 13.201 8.18665 13.3182 8.06944C13.4354 7.95223 13.5013 7.79326 13.5013 7.6275C13.5013 7.46174 13.4354 7.30277 13.3182 7.18556C13.201 7.06835 13.042 7.0025 12.8763 7.0025ZM6.625 7C6.45924 7 6.30027 7.06585 6.18306 7.18306C6.06585 7.30027 6 7.45924 6 7.625C6 7.79076 6.06585 7.94973 6.18306 8.06694C6.30027 8.18415 6.45924 8.25 6.625 8.25C6.79076 8.25 6.94973 8.18415 7.06694 8.06694C7.18415 7.94973 7.25 7.79076 7.25 7.625C7.25 7.45924 7.18415 7.30027 7.06694 7.18306C6.94973 7.06585 6.79076 7 6.625 7Z"
                          fill="#333333"
                        />
                      </svg>
                    }
                  />
                  <EntryDropdown
                    value={ratio}
                    options={RATIO_OPTIONS}
                    onChange={setRatio}
                    icon={
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                      >
                        <rect x="3" y="6" width="18" height="12" rx="2" />
                      </svg>
                    }
                  />
                  <EntryDropdown
                    value={duration}
                    options={DURATION_OPTIONS}
                    onChange={setDuration}
                    icon={
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                      >
                        <circle cx="12" cy="12" r="8" />
                        <path d="M12 8v4l3 2" />
                      </svg>
                    }
                  />
                  <button
                    type="button"
                    className="hotcopy__at"
                    onClick={() => showToast('@参考素材(待接入)', 'info')}
                    title="引用参考素材"
                  >
                    @
                  </button>
                </div>
                <button type="button" className="hotcopy__create" disabled={creating} onClick={createTask}>
                  {creating ? '创建中…' : '创建复刻任务'}
                </button>
              </div>
            </div>
          </div>

          {/* 生成中 / 成片结果 */}
          {(creating || resultUrl) && (
            <div className="hotcopy__result">
              {creating ? (
                <div className="hotcopy__result-wait">
                  <span className="hotcopy__spin" aria-hidden="true" />
                  {phase || '复刻生成中…'}
                </div>
              ) : (
                <>
                  <video
                    className="hotcopy__result-video"
                    src={resultUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={fixVideoDuration}
                  />
                  <div className="hotcopy__result-actions">
                    <a className="hotcopy__result-dl" href={resultUrl} target="_blank" rel="noopener">
                      下载视频
                    </a>
                    <button type="button" className="hotcopy__create" onClick={createTask}>
                      重新生成
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <p className="hotcopy__hint">{activeTab.sub}</p>
        </section>
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
    </div>
  )
}
