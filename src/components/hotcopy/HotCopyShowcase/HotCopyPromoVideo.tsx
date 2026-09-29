/**
 * 爆款复刻入口页顶部的宣传视频位。
 * HOTCOPY_PROMO_VIDEO_URL 为空时只渲染同尺寸占位，布局不变。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import VideoPreviewModal from '@/components/common/VideoPreviewModal'
import './HotCopyShowcase.css'

/**
 * 宣传视频地址。与操作手册教程视频（public/tutorials/）同一放法：随前端静态资源发布，
 * 上 CDN 时只改这一处。换视频时直接替换 public/promo/ 下的文件即可。
 */
const HOTCOPY_PROMO_VIDEO_URL = '/promo/hot-copy-promo.mp4'

export default function HotCopyPromoVideo() {
  const [previewOpen, setPreviewOpen] = useState(false)
  const bannerVideoRef = useRef<HTMLVideoElement>(null)

  const openPreview = () => setPreviewOpen(true)

  /**
   * muted autoplay 在部分 Chromium 环境里仍可能因为资源刚替换、页面从后台恢复等原因没有启动。
   * 属性声明之外再主动调用 play，并在标签页重新可见时恢复，确保 Banner 始终是动态预览。
   */
  const ensureBannerPlaying = useCallback(() => {
    const video = bannerVideoRef.current
    if (!video) return
    video.muted = true
    video.defaultMuted = true
    const playResult = video.play()
    if (playResult) {
      void playResult.catch(() => {
        // 浏览器若暂时尚未允许播放，canplay/loadeddata 会再次触发；无需向用户报错。
      })
    }
  }, [])

  useEffect(() => {
    ensureBannerPlaying()
    const resumeWhenVisible = () => {
      if (document.visibilityState === 'visible') ensureBannerPlaying()
    }
    document.addEventListener('visibilitychange', resumeWhenVisible)
    return () => document.removeEventListener('visibilitychange', resumeWhenVisible)
  }, [ensureBannerPlaying])

  return (
    <>
      <section
        className="hotcopy-promo"
        aria-label="放大播放爆款复刻介绍视频"
        role="button"
        tabIndex={0}
        onClick={openPreview}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          openPreview()
        }}
      >
        {HOTCOPY_PROMO_VIDEO_URL ? (
          <>
            <video
              ref={bannerVideoRef}
              className="hotcopy-promo__video"
              src={HOTCOPY_PROMO_VIDEO_URL}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              disablePictureInPicture
              controlsList="nodownload noremoteplayback"
              aria-hidden="true"
              tabIndex={-1}
              onCanPlay={ensureBannerPlaying}
              onLoadedData={ensureBannerPlaying}
            />
            <span className="hotcopy-promo__openHint" aria-hidden="true">
              <span className="hotcopy-promo__playIcon">▶</span>
              点击放大播放
            </span>
          </>
        ) : (
          <div className="hotcopy-promo__placeholder">视频</div>
        )}
      </section>

      {previewOpen && <VideoPreviewModal src={HOTCOPY_PROMO_VIDEO_URL} onClose={() => setPreviewOpen(false)} />}
    </>
  )
}
