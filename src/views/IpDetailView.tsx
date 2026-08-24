/**
 * IP 详情页（/ip/:userId，设计稿「IP详情」）。
 *
 * 页面职责：展示创作者公开主页（头像、领域标签、简介、平台粉丝）、参考报价卡与作品展示，
 * 「发起合作」打开发布需求抽屉（带目标创作者）。游客可浏览，发起合作需登录。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import DemandFormModal from '@/components/market/DemandFormModal'
import VideoPreviewModal from '@/components/common/VideoPreviewModal'
import { getCommunityIp, listCommunityWorks, type CommunityIpProfile, type CommunityWorkItem } from '@/api/communityIp'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import './IpDetailView.css'

function formatFollowers(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(value % 10000 ? 1 : 0)}W`
  return String(value)
}

/** 已知平台的品牌底色；未知平台用中性色。 */
const PLATFORM_COLORS: Readonly<Record<string, string>> = Object.freeze({
  小红书: '#ff2442',
  抖音: '#161823',
  快手: '#ff7f00',
  B站: '#fb7299',
  哔哩哔哩: '#fb7299',
  视频号: '#07c160',
  微博: '#e6162d',
})

export default function IpDetailView() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const requireAuth = useRequireAuth()
  const handleNavigate = useSidebarNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState<CommunityIpProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [works, setWorks] = useState<CommunityWorkItem[]>([])
  const [worksLoading, setWorksLoading] = useState(false)
  const [demandFormOpen, setDemandFormOpen] = useState(false)
  const [watchingUrl, setWatchingUrl] = useState('')

  const numericUserId = useMemo(() => Math.floor(Number(userId) || 0), [userId])

  useEffect(() => {
    if (!numericUserId) {
      setProfileError('创作者不存在')
      return
    }
    const controller = new AbortController()
    setProfile(null)
    setProfileError('')
    getCommunityIp(numericUserId, controller.signal)
      .then((detail) => setProfile(detail))
      .catch((error: any) => {
        if (error?.name !== 'AbortError') setProfileError(error?.message || '创作者主页加载失败')
      })
    setWorksLoading(true)
    listCommunityWorks({ userId: numericUserId, signal: controller.signal })
      .then(({ items }) => setWorks(items))
      .catch(() => setWorks([]))
      .finally(() => {
        if (!controller.signal.aborted) setWorksLoading(false)
      })
    return () => controller.abort()
  }, [numericUserId])

  const openCooperate = useCallback(() => {
    if (!profile) return
    requireAuth(() => setDemandFormOpen(true))
  }, [profile, requireAuth])

  return (
    <div className="ipd">
      <AppSidebar
        activeKey="home"
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="ipd__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <div className="ipd__content">
          {profileError ? (
            <div className="ipd__placeholder">
              {profileError}
              <button type="button" className="ipd__back-btn" onClick={() => navigate('/home')}>
                返回首页
              </button>
            </div>
          ) : !profile ? (
            <div className="ipd__placeholder">正在加载创作者主页...</div>
          ) : (
            <>
              <section className="ipd__hero">
                <div className="ipd__photo">
                  {profile.avatar ? (
                    <img src={profile.avatar} alt={`${profile.name}的头像`} />
                  ) : (
                    <span className="ipd__photo-fallback" aria-hidden="true">
                      {profile.name.slice(0, 1)}
                    </span>
                  )}
                </div>
                <div className="ipd__profile">
                  <h1 className="ipd__name">{profile.name}</h1>
                  <div className="ipd__tags">
                    {[profile.category, profile.contentType]
                      .filter((tag) => tag && tag !== '暂未设置')
                      .map((tag) => (
                        <span className="ipd__tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                  </div>
                  <p className="ipd__bio">{profile.bio || '这位创作者还没有填写简介。'}</p>
                  <div className="ipd__platforms">
                    {profile.platforms.length ? (
                      profile.platforms.map((platform) => (
                        <span className="ipd__platform" key={platform.name}>
                          <i
                            className="ipd__platform-icon"
                            style={{ background: PLATFORM_COLORS[platform.name] || '#8993a3' }}
                            aria-hidden="true"
                          >
                            {platform.name.slice(0, 1)}
                          </i>
                          <span className="ipd__platform-text">
                            <strong>{platform.name}</strong>
                            <em>{platform.followers ? formatFollowers(platform.followers) : '—'}</em>
                          </span>
                        </span>
                      ))
                    ) : (
                      <span className="ipd__platform ipd__platform--stats">
                        粉丝 {formatFollowers(profile.followers)} · 作品 {profile.publishedWorkCount}
                      </span>
                    )}
                  </div>
                </div>
                <aside className="ipd__quote-card">
                  <div className="ipd__quote">
                    参考报价
                    {profile.averageOrderValue > 0 ? (
                      <span className="ipd__quote-price">
                        ¥ {profile.averageOrderValue}
                        <em>/起</em>
                      </span>
                    ) : (
                      <span className="ipd__quote-price">面议</span>
                    )}
                  </div>
                  <button type="button" className="ipd__cooperate-btn" onClick={openCooperate}>
                    发起合作
                  </button>
                </aside>
              </section>

              <section className="ipd__works">
                <h2 className="ipd__works-title">作品展示</h2>
                {worksLoading ? (
                  <div className="ipd__placeholder">正在加载作品...</div>
                ) : works.length ? (
                  <div className="ipd__works-grid">
                    {works.map((work) => {
                      const cover = work.coverUrl || (work.mediaType === 'image' ? work.mediaUrl : '')
                      const playable = work.mediaType === 'video' && work.mediaUrl
                      return (
                        <button
                          type="button"
                          className="ipd__work"
                          key={work.id}
                          title={work.title}
                          onClick={() => {
                            if (playable) setWatchingUrl(work.mediaUrl)
                          }}
                          style={{ cursor: playable ? 'pointer' : 'default' }}
                        >
                          {cover ? (
                            <img
                              src={cover}
                              alt={work.title}
                              loading="lazy"
                              onError={(event) => {
                                event.currentTarget.style.display = 'none'
                              }}
                            />
                          ) : playable ? (
                            <video src={work.mediaUrl} preload="metadata" muted playsInline />
                          ) : (
                            <span className="ipd__work-ph" aria-hidden="true">
                              🎬
                            </span>
                          )}
                          {playable && (
                            <span className="ipd__work-play" aria-hidden="true">
                              ▶
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="ipd__placeholder">这位创作者还没有公开作品</div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {profile && (
        <DemandFormModal
          open={demandFormOpen}
          targetIp={{ id: profile.id, name: profile.name }}
          onClose={() => setDemandFormOpen(false)}
        />
      )}
      {/* 作品为外链/签名地址，弹窗不带 crossOrigin（与首页案例预览一致） */}
      <VideoPreviewModal src={watchingUrl} onClose={() => setWatchingUrl('')} />
    </div>
  )
}
