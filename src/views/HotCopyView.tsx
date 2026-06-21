/**
 * HotCopyView — 爆款复制(2.1)入口页。
 * 粉色系;两 Tab(同款翻拍 / 精准复刻,副标题在主标题下方);
 * 上传爆款视频(本地/素材库/视频链接)与 上传产品素材 横向并排;爆款视频必填。
 * 创建复刻任务后进入「分镜脚本 → 准备素材 → 生成视频」(与智能成片一致,后续接入)。
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import AppToast from '@/components/AppToast'
import { useToast } from '@/composables/useToast'
import { fileToDataUrl } from '@/utils/imageFile'
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
  { key: 'remake', title: '同款翻拍', sub: '拆解爆点逻辑,保留节奏换成你的产品', tip: '保留原视频的镜头节奏与爆点结构,把主体替换为你的产品。' },
  { key: 'replica', title: '精准复刻', sub: '还原爆款巅峰,复刻热门原版', tip: '尽可能 1:1 还原原视频画面与运镜,适合高度复用爆款模板。' },
] as const

const LINK_PLATFORMS = '抖音 / 快手 / 小红书 / 视频号'
const MAX_PRODUCTS = 9

export default function HotCopyView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('remake')

  // 爆款视频来源:本地文件 / 素材库 asset / 视频链接(三选一)
  const [videoSource, setVideoSource] = useState<'local' | 'library' | 'link'>('local')
  const [videoFileName, setVideoFileName] = useState('')
  const [videoLink, setVideoLink] = useState('')
  const videoFileRef = useRef<HTMLInputElement | null>(null)

  // 产品素材(多图)
  const [products, setProducts] = useState<string[]>([])
  const productFileRef = useRef<HTMLInputElement | null>(null)

  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)

  const activeTab = TABS.find((t) => t.key === tab)!

  const pickVideo = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setVideoSource('local')
    setVideoFileName(f.name)
    setVideoLink('')
  }

  const pickProducts = async (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_PRODUCTS - products.length
    if (room <= 0) {
      showToast(`最多上传 ${MAX_PRODUCTS} 张产品素材`, 'info')
      return
    }
    const sel = Array.from(files).slice(0, room)
    const picked = (await Promise.all(sel.map((f) => fileToDataUrl(f).catch(() => null)))).filter(Boolean) as string[]
    if (picked.length) setProducts((prev) => [...prev, ...picked])
  }

  // 爆款视频是否已提供(必填校验)
  const hasHotVideo =
    (videoSource === 'local' && !!videoFileName) ||
    (videoSource === 'link' && !!videoLink.trim()) ||
    (videoSource === 'library' && !!videoFileName)

  const createTask = () => {
    if (!hasHotVideo) {
      showToast('请先上传爆款视频(本地 / 素材库 / 视频链接)', 'error')
      return
    }
    setCreating(true)
    // TODO: 接入复刻任务创建 + 进入分镜脚本流程(与智能成片一致)
    showToast('复刻任务已创建,进入分镜流程…', 'success')
    setTimeout(() => navigate('/smart'), 600)
  }

  return (
    <div className="hotcopy">
      <AppSidebar activeKey="hot-copy" onNavigate={(k) => (ROUTE_MAP[k] ? navigate(ROUTE_MAP[k]) : showToast('功能待开放', 'info'))} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="hotcopy__shell">
        <AppTopbar onMenu={() => setSidebarOpen(true)} onMember={() => showToast('会员中心待开放', 'info')} />
        <AppToast />

        <section className="hotcopy__main">
          <h1 className="hotcopy__title">爆款作业直接抄,你的产品当主角</h1>

          {/* 两 Tab:主标题 + 副标题(副标题在主标题下方)+ ? 案例提示 */}
          <div className="hotcopy__tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`hotcopy__tab${tab === t.key ? ' is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span className="hotcopy__tab-head">
                  {t.title}
                  <span
                    className="hotcopy__tip"
                    title={`${t.tip}(案例示例待补充)`}
                    onClick={(e) => {
                      e.stopPropagation()
                      showToast('案例示例待补充', 'info')
                    }}
                  >
                    ?
                  </span>
                </span>
                <span className="hotcopy__tab-sub">{t.sub}</span>
              </button>
            ))}
          </div>

          <div className="hotcopy__panel">
            {/* 上传爆款视频 + 上传产品素材 横向并排 */}
            <div className="hotcopy__uploads">
              {/* 爆款视频(必填,三种来源) */}
              <div className="hotcopy__upbox hotcopy__upbox--req">
                <div className="hotcopy__upbox-title">
                  上传爆款视频 <span className="hotcopy__req">*</span>
                </div>
                <div className="hotcopy__src-tabs">
                  {([
                    { k: 'local', l: '本地上传' },
                    { k: 'library', l: '素材库' },
                    { k: 'link', l: '视频链接' },
                  ] as const).map((s) => (
                    <button
                      key={s.k}
                      type="button"
                      className={`hotcopy__src${videoSource === s.k ? ' is-active' : ''}`}
                      onClick={() => setVideoSource(s.k)}
                    >
                      {s.l}
                    </button>
                  ))}
                </div>

                {videoSource === 'local' && (
                  <button type="button" className="hotcopy__drop" onClick={() => videoFileRef.current?.click()}>
                    {videoFileName ? (
                      <span className="hotcopy__drop-file">🎬 {videoFileName}</span>
                    ) : (
                      <>
                        <span className="hotcopy__drop-plus">+</span>
                        <span>点击上传本地视频</span>
                      </>
                    )}
                  </button>
                )}
                {videoSource === 'library' && (
                  <button
                    type="button"
                    className="hotcopy__drop"
                    onClick={() => showToast('从素材库选择(待接入)', 'info')}
                  >
                    <span className="hotcopy__drop-plus">⊞</span>
                    <span>从素材库选择视频</span>
                  </button>
                )}
                {videoSource === 'link' && (
                  <input
                    className="hotcopy__link"
                    value={videoLink}
                    placeholder={`粘贴视频链接(${LINK_PLATFORMS})`}
                    onChange={(e) => setVideoLink(e.target.value)}
                  />
                )}
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
              </div>

              {/* 产品素材 */}
              <div className="hotcopy__upbox">
                <div className="hotcopy__upbox-title">上传产品素材</div>
                <div className="hotcopy__products">
                  {products.map((url, i) => (
                    <div className="hotcopy__product" key={i}>
                      <img src={url} alt="" />
                      <button type="button" className="hotcopy__product-x" onClick={() => setProducts((p) => p.filter((_, j) => j !== i))} aria-label="移除">
                        ×
                      </button>
                    </div>
                  ))}
                  {products.length < MAX_PRODUCTS && (
                    <button type="button" className="hotcopy__drop hotcopy__drop--sm" onClick={() => productFileRef.current?.click()}>
                      <span className="hotcopy__drop-plus">+</span>
                      <span>上传产品图</span>
                    </button>
                  )}
                </div>
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
            </div>

            {/* 文案 + 创建 */}
            <div className="hotcopy__compose">
              <textarea
                className="hotcopy__text"
                value={text}
                placeholder="输入文字或@参考素材,生成精彩广告视频。例如:把 @图片1 中的产品放到 @图片2 中的场景里"
                onChange={(e) => setText(e.target.value)}
              />
              <button type="button" className="hotcopy__create" disabled={creating} onClick={createTask}>
                {creating ? '创建中…' : '创建复刻任务'}
              </button>
            </div>
          </div>

          <p className="hotcopy__hint">{activeTab.sub}</p>
        </section>
      </div>
    </div>
  )
}
