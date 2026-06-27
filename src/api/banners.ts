/**
 * 轮播图 API — GET /api/v1/banners(公开,无需鉴权)。
 * 返回标准业务信封 { code, message, data: Banner[] }。media_type 区分图片 / 视频。
 * slug 区分使用位置:首页传 'home',登录页传 'login'。
 */
import { isSafeMediaUrl } from '@/utils/urlSafety'

export interface Banner {
  id: number
  title: string
  description: string
  /** 媒体地址(图片或视频,按 mediaType 区分) */
  mediaUrl: string
  mediaType: 'image' | 'video'
  /** 点击跳转的外链(可空) */
  linkUrl: string
  position: number
}

export async function listBanners(slug?: string): Promise<Banner[]> {
  // slug 指定使用位置(home / login),后端按位置返回对应轮播数据。
  const query = slug ? `?slug=${encodeURIComponent(slug)}` : ''
  let res: Response
  try {
    res = await fetch(`/api/v1/banners${query}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    return []
  }
  if (!res.ok) return []

  let payload: any
  try {
    payload = await res.json()
  } catch {
    return []
  }

  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
  return list
    .filter((b: any) => b && b.enabled !== false)
    .map(
      (b: any): Banner => ({
        id: Number(b?.id || 0),
        title: String(b?.title || '').trim(),
        description: String(b?.description || '').trim(),
        mediaUrl: String(b?.image_url || b?.imageUrl || b?.media_url || b?.url || '').trim(),
        mediaType: String(b?.media_type || b?.mediaType || '').toLowerCase() === 'video' ? 'video' : 'image',
        linkUrl: String(b?.link_url || b?.linkUrl || '').trim(),
        position: Number(b?.position || 0),
      }),
    )
    .filter((b: Banner) => b.mediaUrl && isSafeMediaUrl(b.mediaUrl))
  // 按接口返回的原始顺序展示(轮播顺序、标题顺序均以后端为准),不再按 position 重排。
}
