import { useCallback, useEffect, useState } from 'react'
import { Input, Modal, Select } from 'antd'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import {
  archiveCommunityWork,
  createCommunityWork,
  getCommunityWork,
  getCommunityWorkManage,
  listMyCommunityWorks,
  publishCommunityWork,
  updateCommunityWork,
  type CommunityWorkInput,
  type CommunityWorkItem,
} from '@/api/communityIp'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useToast } from '@/composables/useToast'
import './CommunityWorksView.css'

interface CreateWorkState {
  createWork?: { assetId?: number; title?: string; category?: string }
}

function isPublished(work: CommunityWorkItem): boolean {
  return work.status === 'published' || work.visibility === 'public'
}

function revealVideoPreview(video: HTMLVideoElement): void {
  const duration = Number(video.duration)
  if (!Number.isFinite(duration) || duration <= 0) return
  const previewTime = Math.min(2, Math.max(0.2, duration * 0.1))
  if (Math.abs(video.currentTime - previewTime) > 0.05) video.currentTime = previewTime
  video.dataset.previewTime = String(previewTime)
  video.pause()
}

function playVideoPreview(video: HTMLVideoElement): void {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) void video.play().catch(() => undefined)
}

function pauseVideoPreview(video: HTMLVideoElement): void {
  video.pause()
  const previewTime = Number(video.dataset.previewTime)
  if (Number.isFinite(previewTime)) video.currentTime = previewTime
}

function WorkMedia({
  work,
  detail = false,
  priority = false,
}: {
  work: CommunityWorkItem
  detail?: boolean
  priority?: boolean
}) {
  if (work.mediaType === 'video' && work.mediaUrl) {
    return (
      <video
        src={work.mediaUrl}
        poster={work.coverUrl || undefined}
        controls={detail}
        muted={!detail}
        playsInline
        preload="metadata"
        aria-label={`${work.title}视频${detail ? '' : '预览'}`}
        onLoadedMetadata={detail ? undefined : (event) => revealVideoPreview(event.currentTarget)}
        onMouseEnter={detail ? undefined : (event) => playVideoPreview(event.currentTarget)}
        onMouseLeave={detail ? undefined : (event) => pauseVideoPreview(event.currentTarget)}
      />
    )
  }
  const src = work.coverUrl || work.mediaUrl
  return src ? (
    <img
      src={src}
      alt={work.title}
      loading={detail || priority ? 'eager' : 'lazy'}
      fetchPriority={detail || priority ? 'high' : 'auto'}
    />
  ) : (
    <span className="cworks__empty-art" aria-hidden="true">
      作品
    </span>
  )
}

function inputFromWork(work: CommunityWorkItem): CommunityWorkInput {
  return {
    title: work.title,
    summary: work.description,
    content: work.content,
    category: work.category,
    assetIds: work.assetIds,
    coverAssetId: work.coverAssetId,
  }
}

const EMPTY_INPUT: CommunityWorkInput = { title: '', summary: '', content: '', category: 'video', assetIds: [] }

export default function CommunityWorksView({ manage = false, list = false }: { manage?: boolean; list?: boolean }) {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const handleSidebarNavigate = useSidebarNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [works, setWorks] = useState<CommunityWorkItem[]>([])
  const [work, setWork] = useState<CommunityWorkItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorInput, setEditorInput] = useState<CommunityWorkInput>(EMPTY_INPUT)
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (list) {
        const result = await listMyCommunityWorks({ signal })
        setWorks(result.items)
        return
      }
      const result = manage
        ? await getCommunityWorkManage(Number(id), signal)
        : await getCommunityWork(Number(id), signal)
      setWork(result)
    },
    [id, list, manage],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    load(controller.signal)
      .catch((reason: any) => {
        if (reason?.name !== 'AbortError') setError(reason?.message || '作品加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    if (!list) return
    const createWork = (location.state as CreateWorkState | null)?.createWork
    const assetId = Number(createWork?.assetId || 0)
    if (!assetId) return
    setEditorInput({
      title: String(createWork?.title || ''),
      summary: '',
      content: '',
      category: String(createWork?.category || 'video'),
      assetIds: [assetId],
      coverAssetId: assetId,
    })
    setEditorOpen(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [list, location.pathname, location.state, navigate])

  const saveDraft = async (publishAfterSave: boolean) => {
    if (!editorInput.title.trim()) return showToast('请填写作品标题', 'error')
    if (!editorInput.assetIds.length) return showToast('请先从“我的素材”选择要发布的图片或视频', 'error')
    setSaving(true)
    try {
      let saved = work ? await updateCommunityWork(work.id, editorInput) : await createCommunityWork(editorInput)
      if (publishAfterSave && !isPublished(saved)) saved = await publishCommunityWork(saved.id)
      showToast(publishAfterSave ? '作品已公开发布' : '作品草稿已保存', 'success')
      setEditorOpen(false)
      if (list) {
        if (publishAfterSave) {
          navigate('/resources', { replace: true })
        } else {
          await load()
        }
      } else {
        setWork(saved)
      }
    } catch (reason: any) {
      showToast(reason?.message || '作品保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const togglePublished = async () => {
    if (!work) return
    setSaving(true)
    try {
      const wasPublished = isPublished(work)
      const next = wasPublished ? await archiveCommunityWork(work.id) : await publishCommunityWork(work.id)
      setWork(next)
      showToast(wasPublished ? '作品已下架' : '作品已公开发布', 'success')
    } catch (reason: any) {
      showToast(reason?.message || '操作失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cworks">
      <AppSidebar
        activeKey="home"
        onNavigate={handleSidebarNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="cworks__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <div className="cworks__content">
          <header className="cworks__header">
            <button type="button" className="cworks__back" onClick={() => navigate(-1)} aria-label="返回上一页">
              ←
            </button>
            <div className="cworks__heading">
              <span className="cworks__eyebrow">{list || manage ? 'CREATOR STUDIO' : 'COMMUNITY WORK'}</span>
              <h1>{list ? '我的作品' : manage ? '作品管理' : '作品详情'}</h1>
              {list ? <p>这里展示你创作并发布到社区的作品。</p> : null}
            </div>
            {list ? (
              <button
                type="button"
                className="cworks__primary cworks__header-action"
                onClick={() => navigate('/resources')}
              >
                从我的素材发布
              </button>
            ) : null}
          </header>
          {loading ? (
            <div className="cworks__state" role="status">
              正在加载作品…
            </div>
          ) : null}
          {!loading && error ? (
            <div className="cworks__state cworks__state--error" role="alert">
              {error}
              <button
                type="button"
                onClick={() => {
                  if (list) navigate('/home')
                  else navigate(-1)
                }}
              >
                返回
              </button>
            </div>
          ) : null}
          {!loading && !error && list ? (
            works.length ? (
              <section className="cworks__grid" aria-label="我的作品列表">
                {works.map((item, index) => (
                  <button
                    type="button"
                    className="cworks__card"
                    key={item.id}
                    onClick={() => navigate(`/works/${item.id}/manage`)}
                  >
                    <span className="cworks__media">
                      <WorkMedia work={item} priority={index < 4} />
                    </span>
                    <span className="cworks__card-copy">
                      <strong>{item.title}</strong>
                      <span>
                        {isPublished(item) ? '已公开' : item.status === 'archived' ? '已下架' : '草稿'} · 查看管理详情
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            ) : (
              <div className="cworks__state">
                <strong>还没有作品</strong>
                <span>从我的素材选择图片或视频，就可以发布到个人主页。</span>
                <button type="button" onClick={() => navigate('/resources')}>
                  选择素材
                </button>
              </div>
            )
          ) : null}
          {!loading && !error && !list && work ? (
            <article className="cworks__detail">
              <div className="cworks__detail-media">
                <WorkMedia work={work} detail />
              </div>
              <div className="cworks__detail-copy">
                {manage ? (
                  <span className="cworks__badge">
                    {isPublished(work) ? '已公开发布' : work.status === 'archived' ? '已下架' : '草稿'}
                  </span>
                ) : null}
                <h1>{work.title}</h1>
                {work.description ? <p>{work.description}</p> : <p className="cworks__muted">作者暂未添加作品介绍。</p>}
                {work.authorName ? (
                  <button type="button" className="cworks__author" onClick={() => navigate(`/ip/${work.authorId}`)}>
                    {work.authorAvatar ? <img src={work.authorAvatar} alt="" /> : null}
                    <span>
                      {work.authorName}
                      <small>查看创作者主页</small>
                    </span>
                  </button>
                ) : null}
                {manage ? (
                  <div className="cworks__actions">
                    <button
                      type="button"
                      className="cworks__secondary"
                      onClick={() => {
                        setEditorInput(inputFromWork(work))
                        setEditorOpen(true)
                      }}
                    >
                      编辑作品
                    </button>
                    <button
                      type="button"
                      className={isPublished(work) ? 'cworks__secondary cworks__secondary--danger' : 'cworks__primary'}
                      disabled={saving}
                      onClick={() => void togglePublished()}
                    >
                      {isPublished(work) ? '下架作品' : '公开发布'}
                    </button>
                    {isPublished(work) ? (
                      <button type="button" className="cworks__secondary" onClick={() => navigate(`/works/${work.id}`)}>
                        查看公开页面
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          ) : null}
        </div>
      </main>
      <Modal
        title={work ? '编辑作品' : '发布作品'}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <div className="cworks__form">
          <label>
            <span>作品标题</span>
            <Input
              maxLength={80}
              showCount
              value={editorInput.title}
              onChange={(event) => setEditorInput((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label>
            <span>作品类型</span>
            <Select
              value={editorInput.category || 'video'}
              options={[
                { value: 'video', label: '视频' },
                { value: 'image', label: '图片' },
              ]}
              onChange={(category) => setEditorInput((current) => ({ ...current, category }))}
            />
          </label>
          <label>
            <span>作品简介</span>
            <Input.TextArea
              rows={4}
              maxLength={300}
              showCount
              value={editorInput.summary}
              onChange={(event) => setEditorInput((current) => ({ ...current, summary: event.target.value }))}
            />
          </label>
          <p className="cworks__asset-note">已关联 {editorInput.assetIds.length} 个创作素材</p>
          <div className="cworks__form-actions">
            <button type="button" className="cworks__secondary" disabled={saving} onClick={() => void saveDraft(false)}>
              保存草稿
            </button>
            <button type="button" className="cworks__primary" disabled={saving} onClick={() => void saveDraft(true)}>
              {saving ? '正在保存…' : '保存并公开'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
