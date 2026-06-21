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
  { key: 'remake', title: '同款翻拍', sub: '拆解爆点逻辑,保留节奏换产品', tip: '保留原视频镜头节奏与爆点结构,把主体替换为你的产品。(案例示例待补充)' },
  { key: 'replica', title: '精准复刻', sub: '还原爆款巅峰,复刻热门原版', tip: '尽量 1:1 还原原视频画面与运镜,适合高度复用爆款模板。(案例示例待补充)' },
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
  const [linkInputOpen, setLinkInputOpen] = useState(false)
  const videoFileRef = useRef<HTMLInputElement | null>(null)
  const videoMenuRef = useRef<HTMLDivElement | null>(null)

  // 替换素材(产品多图):保留 File 以便上传
  const [products, setProducts] = useState<{ url: string; file: File }[]>([])
  const productFileRef = useRef<HTMLInputElement | null>(null)

  const [text, setText] = useState('')
  const [style, setStyle] = useState('商业')
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

  const chooseSource = (src: 'local' | 'library' | 'link') => {
    setVideoMenuOpen(false)
    if (src === 'local') {
      videoFileRef.current?.click()
    } else if (src === 'library') {
      setVideoSource('library')
      setVideoFileName('素材库视频')
      setVideoLink('')
      setLinkInputOpen(false)
      showToast('从素材库选择(待接入)', 'info')
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
    videoSource === 'local' ? videoFileName : videoSource === 'library' ? '素材库视频' : videoSource === 'link' ? (videoLink.trim() || '视频链接') : ''
  const hasHotVideo = (videoSource === 'local' && !!videoFile) || (videoSource === 'link' && !!videoLink.trim())

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
    // 当前直连 video.replicate 仅支持「本地上传」的源视频;链接/素材库待后端解析接口
    if (videoSource !== 'local' || !videoFile) {
      showToast('暂仅支持「本地上传」的爆款视频(链接/素材库待接入)', 'info')
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
      setPhase('上传源视频…')
      const videoAssetId = await uploadHotCopyAsset(ws, videoFile)
      if (!videoAssetId) throw new Error('源视频上传失败')
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
        style && `整体风格:${style}。`,
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
                  <span className="hotcopy__tip" title={t.tip} onClick={(e) => { e.stopPropagation(); showToast(t.tip, 'info') }}>
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
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="6" width="13" height="12" rx="2" />
                        <path d="m16 10 5-3v10l-5-3z" />
                      </svg>
                      上传爆款视频
                      <span className="hotcopy__req">*</span>
                    </button>
                    {videoMenuOpen && (
                      <div className="hotcopy__menu" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => chooseSource('local')}>本地上传</button>
                        <button type="button" onClick={() => chooseSource('library')}>素材库</button>
                        <button type="button" onClick={() => chooseSource('link')}>视频链接</button>
                      </div>
                    )}
                  </div>

                  {/* 上传替换素材 */}
                  <button type="button" className={`hotcopy__upbtn${products.length ? ' is-done' : ''}`} onClick={() => productFileRef.current?.click()}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 5h6l2 2h8v10a2 2 0 0 1-2 2H4z" />
                    </svg>
                    上传替换素材
                    <span className="hotcopy__req">*</span>
                  </button>

                  {/* 已选爆款视频 chip */}
                  {videoLabel && (
                    <span className="hotcopy__chip" title={videoLabel}>
                      🎬 {videoLabel}
                      <button type="button" onClick={clearVideo} aria-label="移除">×</button>
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
                          <button type="button" onClick={() => setProducts((arr) => arr.filter((_, j) => j !== i))} aria-label="移除">×</button>
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
                  <EntryDropdown value={style} options={STYLE_OPTIONS} onChange={setStyle} icon={<span className="hotcopy__tool-i">✦</span>} />
                  <EntryDropdown value={ratio} options={RATIO_OPTIONS} onChange={setRatio} icon={<span className="hotcopy__tool-i">▭</span>} />
                  <EntryDropdown value={duration} options={DURATION_OPTIONS} onChange={setDuration} icon={<span className="hotcopy__tool-i">◷</span>} />
                  <button type="button" className="hotcopy__at" onClick={() => showToast('@参考素材(待接入)', 'info')} title="引用参考素材">@</button>
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
                  <video className="hotcopy__result-video" src={resultUrl} controls playsInline preload="metadata" onLoadedMetadata={fixVideoDuration} />
                  <div className="hotcopy__result-actions">
                    <a className="hotcopy__result-dl" href={resultUrl} target="_blank" rel="noopener">下载视频</a>
                    <button type="button" className="hotcopy__create" onClick={createTask}>重新生成</button>
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
    </div>
  )
}
