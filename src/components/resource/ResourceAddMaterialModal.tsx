/**
 * ResourceAddMaterialModal — 资源项目添加素材弹窗
 * 在资源管理中上传本地素材、填写名称/标签、关联到指定资源项目。
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  addAssetToResourceProject,
  createResourceProject,
  deleteResourceProject,
  ensureSeededResourceProjects,
  loadResourceProjects,
} from '@/utils/resourceProjects'
import { useConfirmDialog } from '@/composables/useToast'
import './ResourceAddMaterialModal.css'

interface ResourceAddMaterialModalProps {
  visible?: boolean
  assets?: any[]
  assetToAdd?: any
  onClose?: () => void
  onAssetAdded?: (payload: { project: any; asset: any }) => void
}

const PROJECTS_PER_PAGE = 6

export default function ResourceAddMaterialModal({
  visible = false,
  assets = [],
  assetToAdd = null,
  onClose,
  onAssetAdded,
}: ResourceAddMaterialModalProps) {
  const { requestConfirm } = useConfirmDialog()

  const [currentPage, setCurrentPage] = useState(1)
  const [activeTab, setActiveTab] = useState('mine')
  const [searchText, setSearchText] = useState('')
  const [projects, setProjects] = useState<any[]>([])

  // 仅取有封面图的素材，作为项目卡片封面拼图素材池。
  const previewPool = useMemo(
    () =>
      assets
        .map((asset, index) => ({
          id: asset?.id || `preview-${index + 1}`,
          title: asset?.title || `素材 ${index + 1}`,
          image: asset?.posterUrl || (asset?.mediaKind === 'image' ? asset?.mediaUrl : ''),
          kind: asset?.type || '素材',
        }))
        .filter((asset) => asset.image),
    [assets],
  )

  const tabProjects = useMemo(
    () => projects.filter((project) => String(project?.tab || 'mine') === activeTab),
    [projects, activeTab],
  )

  const filteredProjects = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    const source = tabProjects.slice().sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))

    if (!keyword) return source
    return source.filter((project) =>
      String(project?.title || '')
        .toLowerCase()
        .includes(keyword),
    )
  }, [tabProjects, searchText])

  const projectTotal = filteredProjects.length
  const totalPages = Math.max(1, Math.ceil(projectTotal / PROJECTS_PER_PAGE))

  // 列表缩小（如删除最后一页的最后一项）后把 currentPage 收敛回有效范围，
  // 避免页码 state 与实际页数失配。
  useEffect(() => {
    setCurrentPage((p) => Math.min(Math.max(1, p), totalPages))
  }, [totalPages])

  const projectCards = useMemo(() => {
    const pool = previewPool
    const poolLength = pool.length

    return filteredProjects.map((project, index) => {
      const coverSet = poolLength
        ? Array.from({ length: 4 }, (_, offset) => pool[(index * 2 + offset) % poolLength])
        : []
      const collaborators = Number(project?.collaborators || 0)
      const metrics = [
        `图片 ${Number(project?.imageCount || 0)}`,
        `视频 ${Number(project?.videoCount || 0)}`,
        `音频 ${Number(project?.audioCount || 0)}`,
      ]

      return {
        ...project,
        metrics,
        score: `AI评分 ${Number(project?.aiScore || 0)}`,
        coverSet,
        cover: coverSet[0] || null,
        avatars: coverSet.slice(0, Math.min(Math.max(collaborators, 0), 4)),
      }
    })
  }, [filteredProjects, previewPool])

  const pagedProjectCards = useMemo(() => {
    const page = Math.min(Math.max(currentPage, 1), totalPages)
    const start = (page - 1) * PROJECTS_PER_PAGE
    return projectCards.slice(start, start + PROJECTS_PER_PAGE)
  }, [projectCards, currentPage, totalPages])

  const paginationTokens = useMemo<(number | 'ellipsis')[]>(() => {
    const total = totalPages
    const page = currentPage

    if (total <= 5) {
      return Array.from({ length: total }, (_, index) => index + 1)
    }

    if (page <= 2) {
      return [1, 2, 3, 'ellipsis', total]
    }

    if (page >= total - 1) {
      return [1, 'ellipsis', total - 2, total - 1, total]
    }

    return [1, 'ellipsis', page, page + 1, total]
  }, [totalPages, currentPage])

  function goToPage(page: number) {
    const nextPage = Number(page || 1)
    if (!nextPage || nextPage < 1 || nextPage > totalPages) {
      return
    }

    setCurrentPage(nextPage)
  }

  function goToPrevPage() {
    if (currentPage > 1) {
      setCurrentPage((p) => p - 1)
    }
  }

  function goToNextPage() {
    if (currentPage < totalPages) {
      setCurrentPage((p) => p + 1)
    }
  }

  function reloadProjects() {
    ensureSeededResourceProjects()
    setProjects(loadResourceProjects())
  }

  function handleTabSwitch(tab: string) {
    setActiveTab(tab)
    setSearchText('')
    setCurrentPage(1)
  }

  function createFolder() {
    createResourceProject({ tab: activeTab, title: '新建文件夹', layout: 'folder' })
    reloadProjects()
    setCurrentPage(1)
  }

  async function confirmDeleteProject(projectId: any) {
    if (!projectId) return
    const confirmed = await requestConfirm('确认删除该项目吗？', { danger: true })
    if (!confirmed) return
    deleteResourceProject(projectId)
    reloadProjects()
    // 页码收敛交由 totalPages 的 effect 处理（此处 totalPages 仍是删除前的旧值）
  }

  function handleProjectSelect(project: any) {
    if (!project?.id) return
    if (!assetToAdd) return
    const updated = addAssetToResourceProject({ projectId: project.id, asset: assetToAdd })
    if (updated) {
      onAssetAdded?.({ project: updated, asset: assetToAdd })
    }
    reloadProjects()
  }

  function closeModal() {
    onClose?.()
  }

  // 打开时重新加载项目并复位到第一页。
  useEffect(() => {
    if (!visible) return
    reloadProjects()
    setCurrentPage(1)
  }, [visible])

  if (!visible) return null

  return createPortal(
    <div
      className="resource-add-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="添加素材"
      onClick={closeModal}
    >
      <section className="resource-add-modal" onClick={(e) => e.stopPropagation()}>
        <header className="resource-add-modal-tabs">
          <button
            type="button"
            className={activeTab === 'mine' ? 'active' : undefined}
            onClick={() => handleTabSwitch('mine')}
          >
            我的素材
          </button>
          <button
            type="button"
            className={activeTab === 'team' ? 'active' : undefined}
            onClick={() => handleTabSwitch('team')}
          >
            团队素材
          </button>
          <button
            type="button"
            className={activeTab === 'favorite' ? 'active' : undefined}
            onClick={() => handleTabSwitch('favorite')}
          >
            我的收藏
          </button>
        </header>

        <div className="resource-add-toolbar">
          <label className="resource-add-search">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M13.9 13.1 17 16.2M15.4 8.7a6.7 6.7 0 1 1-13.4 0 6.7 6.7 0 0 1 13.4 0Z" />
            </svg>
            <input
              value={searchText}
              type="text"
              placeholder="搜索项目、素材、关键词..."
              onChange={(e) => {
                setSearchText(e.target.value)
                setCurrentPage(1)
              }}
            />
            <span>K</span>
          </label>

          <div className="resource-add-filters">
            <button type="button" className="is-primary ai-filter">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M7 6.8c0 .9-.7 1.6-1.6 1.6S3.8 7.7 3.8 6.8s.7-1.6 1.6-1.6S7 5.9 7 6.8Zm9.2 0c0 .9-.7 1.6-1.6 1.6S13 7.7 13 6.8s.7-1.6 1.6-1.6 1.6.7 1.6 1.6ZM10 13.2c0 .9-.7 1.6-1.6 1.6s-1.6-.7-1.6-1.6.7-1.6 1.6-1.6S10 12.3 10 13.2Z" />
                <path d="M6.9 7h6.2M8.6 12.9h6.7M5.4 8.4v3.2" />
              </svg>
              AI 智能筛选
            </button>
            <button type="button" className="platform-filter">
              投放平台 <i></i>
            </button>
            <button type="button" className="recent-filter">
              最近编辑 <i></i>
            </button>
            <button type="button" className="score-filter">
              AI 评分 <i></i>
            </button>
          </div>

          <div className="resource-add-actions">
            <div className="resource-add-view-group">
              <button type="button" className="resource-add-view-switch active" aria-label="卡片视图">
                <span></span>
                <span></span>
                <span></span>
                <span></span>
              </button>
              <button type="button" className="resource-add-view-switch" aria-label="列表视图">
                <span></span>
                <span></span>
                <span></span>
              </button>
            </div>
            <button type="button" className="resource-add-create" onClick={createFolder}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
              新建文件夹
            </button>
          </div>
        </div>

        <div className="resource-add-content">
          <section className="resource-add-projects">
            <div className="resource-add-projects-title">
              <h3>我的项目 ({projectTotal})</h3>
            </div>

            <div className="resource-add-project-grid-wrap">
              <div className="resource-add-project-grid">
                {pagedProjectCards.map((project) => (
                  <article
                    key={project.id}
                    className="resource-project-card"
                    onClick={() => handleProjectSelect(project)}
                  >
                    <div
                      className={`resource-project-cover layout-${project.layout} tone-${project.badgeTone}`}
                    >
                      <span className={`resource-project-badge tone-${project.badgeTone}`}>{project.badge}</span>
                      <button
                        type="button"
                        className="resource-project-more"
                        aria-label="更多操作"
                        onClick={(e) => {
                          e.stopPropagation()
                          confirmDeleteProject(project.id)
                        }}
                      >
                        <span></span>
                        <span></span>
                        <span></span>
                      </button>

                      {project.layout === 'folder' ? (
                        <div className="resource-folder-illustration">
                          <div className="resource-folder-tab"></div>
                          <div className="resource-folder-body"></div>
                        </div>
                      ) : project.layout === 'wide' ? (
                        project.cover ? (
                          <img src={project.cover.image} alt={project.cover.title} />
                        ) : null
                      ) : project.layout === 'single' ? (
                        <>
                          {project.cover ? <img src={project.cover.image} alt={project.cover.title} /> : null}
                          <button type="button" className="resource-project-star" aria-label="收藏项目">
                            ★
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="resource-project-mosaic">
                            {project.coverSet
                              .slice(
                                0,
                                project.layout === 'double' ? 2 : project.layout === 'triple' ? 3 : 4,
                              )
                              .map((cover: any, coverIndex: number) => (
                                <div
                                  key={`${project.id}-${cover.id}-${coverIndex}`}
                                  className="resource-project-mosaic-item"
                                >
                                  <img src={cover.image} alt={cover.title} />
                                </div>
                              ))}
                          </div>
                          {project.layout === 'mosaic' && (
                            <div className="resource-project-progress">72%</div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="resource-project-body">
                      <h4>{project.title}</h4>
                      <p>
                        {project.date}&nbsp;&nbsp;{project.time}
                      </p>

                      <div className="resource-project-meta">
                        {project.metrics.map((metric: string) => (
                          <span key={metric}>{metric}</span>
                        ))}
                        <div className="resource-project-avatars">
                          {project.avatars.map((avatar: any, avatarIndex: number) => (
                            <span
                              key={`${project.id}-avatar-${avatarIndex}`}
                              style={{ backgroundImage: `url(${avatar.image})` }}
                            ></span>
                          ))}
                          <b>+{project.collaborators}</b>
                        </div>
                      </div>

                      <div className="resource-project-tags">
                        <span>{project.size}</span>
                        <span>{project.channel}</span>
                        <span className="is-highlight">{project.score}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <footer className="resource-add-pagination">
              <button
                type="button"
                className="is-arrow"
                aria-label="上一页"
                disabled={currentPage === 1}
                onClick={goToPrevPage}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="m7.5 2.5-3 3.5 3 3.5" />
                </svg>
              </button>
              {paginationTokens.map((token, index) =>
                token === 'ellipsis' ? (
                  <span key={`page-ellipsis-${index}`} className="is-ellipsis">
                    ...
                  </span>
                ) : (
                  <button
                    key={`page-${token}`}
                    type="button"
                    className={token === currentPage ? 'active' : undefined}
                    onClick={() => goToPage(token)}
                  >
                    {token}
                  </button>
                ),
              )}
              <button
                type="button"
                className="is-arrow"
                aria-label="下一页"
                disabled={currentPage === totalPages}
                onClick={goToNextPage}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="m4.5 2.5 3 3.5-3 3.5" />
                </svg>
              </button>
            </footer>
          </section>

          <aside className="resource-add-market-panel">
            <div className="resource-add-market-illustration">
              <div className="resource-add-market-folder"></div>
              <div className="resource-add-market-icon is-image"></div>
              <div className="resource-add-market-icon is-video"></div>
              <div className="resource-add-market-icon is-audio"></div>
              <div className="resource-add-market-planet"></div>
              <span className="sparkle is-one"></span>
              <span className="sparkle is-two"></span>
              <span className="sparkle is-three"></span>
            </div>

            <div className="resource-add-market-copy">
              <h3>素材市场</h3>
              <p>海量优质素材，激发创意灵感</p>
            </div>

            <ul className="resource-add-market-list">
              <li>
                <i></i>
                <div>
                  <b>海量优质素材</b>
                  <span>10W+ 图片、视频、音频资源</span>
                </div>
              </li>
              <li>
                <i></i>
                <div>
                  <b>AI 智能推荐</b>
                  <span>基于投放数据，推荐高转化素材</span>
                </div>
              </li>
              <li>
                <i></i>
                <div>
                  <b>一键应用</b>
                  <span>预览效果，快速应用到项目</span>
                </div>
              </li>
            </ul>

            <button type="button" className="resource-add-market-button" onClick={closeModal}>
              前往素材市场
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.5 8h9M9 3.5 13.5 8 9 12.5" />
              </svg>
            </button>
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  )
}
