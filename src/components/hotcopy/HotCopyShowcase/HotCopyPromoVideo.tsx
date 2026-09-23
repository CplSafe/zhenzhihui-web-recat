/**
 * 爆款复刻入口页顶部的宣传视频位。
 * HOTCOPY_PROMO_VIDEO_URL 为空时只渲染同尺寸占位，布局不变。
 */
import './HotCopyShowcase.css'

/**
 * 宣传视频地址。与操作手册教程视频（public/tutorials/）同一放法：随前端静态资源发布，
 * 上 CDN 时只改这一处。换视频时直接替换 public/promo/ 下的文件即可。
 */
const HOTCOPY_PROMO_VIDEO_URL = '/promo/hot-copy-promo.mp4'

export default function HotCopyPromoVideo() {
  return (
    <section className="hotcopy-promo" aria-label="爆款复刻宣传视频">
      {HOTCOPY_PROMO_VIDEO_URL ? (
        <video
          className="hotcopy-promo__video"
          src={HOTCOPY_PROMO_VIDEO_URL}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          controlsList="nodownload noremoteplayback"
        />
      ) : (
        <div className="hotcopy-promo__placeholder">视频</div>
      )}
    </section>
  )
}
