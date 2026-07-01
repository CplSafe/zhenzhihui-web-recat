/**
 * mediaPreload — 通用图片 / 视频预加载工具(让轮播、相册、列表切换不再「现加载现等」)。
 *
 * 解决什么问题:
 *   切到下一张图/视频时才开始下载,用户会看到空白/卡顿。提前把「即将出现」的资源
 *   预取到浏览器缓存,真正切换时直接命中,丝滑。
 *
 * 三个能力:
 *   - preloadImage(url)            预取单张图片(Image() + decode)
 *   - preloadVideo(url)            预热单个视频的元数据 / 首帧(preload=metadata)
 *   - preloadMedia(items, opts)    批量预取,带并发上限,自动识别图/视频
 *
 * 特性:
 *   - 幂等:同一 url 不会重复下载(内部去重,已完成的直接复用)。
 *   - 不阻塞:返回 Promise 但失败只会 resolve(不抛错,预加载失败不该影响主流程)。
 *   - 并发可控:批量预取默认最多同时 3 个,避免一口气拉爆带宽(与首页视频限流思路一致)。
 *
 * ────────────────────────────────────────────────────────────────
 * 用法:
 *
 *   import { preloadMedia } from '@/utils/mediaPreload'
 *
 *   // 轮播里:把「下一张」「上一张」提前预取
 *   preloadMedia([
 *     { url: nextSlide.url, type: 'image' },
 *     { url: prevSlide.url, type: 'video' },
 *   ])
 *
 *   // 只预取图片也行:
 *   import { preloadImage } from '@/utils/mediaPreload'
 *   await preloadImage(coverUrl)
 *
 * 注意:
 *   - 视频「预热首帧」依赖浏览器对 preload=metadata 的支持;部分移动端浏览器会忽略,
 *     此时退化为仅建立连接/不报错,真正播放时仍按需加载(无副作用)。
 */

export type MediaType = 'image' | 'video'

export interface MediaItem {
  url: string
  type: MediaType
}

/** 已发起 / 已完成的 url → Promise,保证幂等(同 url 复用同一个加载) */
const cache = new Map<string, Promise<void>>()

/** 预取单张图片:解码完成后视为就绪(decode 失败则退化为 onload)。 */
export function preloadImage(url: string): Promise<void> {
  if (!url) return Promise.resolve()
  const hit = cache.get(url)
  if (hit) return hit

  const p = new Promise<void>((resolve) => {
    const img = new Image()
    // 跨域图也尽量进缓存;匿名不带凭证,避免污染
    img.decoding = 'async'
    img.onload = () => {
      // decode() 能确保解码完成(避免首次绘制时再卡一下),不支持就直接完成
      if (typeof img.decode === 'function') {
        img
          .decode()
          .then(() => resolve())
          .catch(() => resolve())
      } else {
        resolve()
      }
    }
    img.onerror = () => resolve() // 预加载失败不抛错,主流程继续按需加载
    img.src = url
  })

  cache.set(url, p)
  return p
}

/**
 * 预加载单个视频「到可播放」(preload=auto + 等 canplay)。
 * 与只取首帧不同:这里会缓冲到浏览器认为可流畅播放(canplay),
 * 这样真正展示该视频时直接能播、不再转圈。字节进入浏览器 HTTP 缓存供后续复用。
 */
function preloadVideo(url: string): Promise<void> {
  if (!url) return Promise.resolve()
  const hit = cache.get(url)
  if (hit) return hit

  const p = new Promise<void>((resolve) => {
    const v = document.createElement('video')
    v.preload = 'auto'
    v.muted = true
    // 不挂到 DOM 上,纯粹触发浏览器缓冲到可播
    let done = false
    const finish = () => {
      if (done) return
      done = true
      // 解除引用,便于 GC;已缓冲字节仍在浏览器 HTTP 缓存里
      v.removeAttribute('src')
      v.load()
      resolve()
    }
    v.oncanplaythrough = finish // 可流畅播放到底(最佳)
    v.oncanplay = finish // 可开始播放(足够展示)
    v.onerror = finish // 失败不抛错
    // 安全兜底:某些浏览器不触发事件时 12s 后放行,避免 Promise 永挂
    setTimeout(finish, 12000)
    v.src = url
  })

  cache.set(url, p)
  return p
}

/** 按类型预取单个媒体。 */
function preloadOne(item: MediaItem): Promise<void> {
  return item.type === 'video' ? preloadVideo(item.url) : preloadImage(item.url)
}

export interface PreloadOptions {
  /** 同时进行的最大预取数,默认 3(避免一次性拉爆带宽)。 */
  concurrency?: number
}

/**
 * 批量预取,带并发上限。已缓存的会被跳过(幂等)。
 * 返回的 Promise 在全部尝试完成后 resolve(失败项也算完成,不抛错)。
 */
export function preloadMedia(items: MediaItem[], options: PreloadOptions = {}): Promise<void> {
  const { concurrency = 3 } = options
  const queue = items.filter((it) => it && it.url)
  if (queue.length === 0) return Promise.resolve()

  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const item = queue[cursor++]
      await preloadOne(item)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
  return Promise.all(workers).then(() => undefined)
}

/** 某 url 是否已预取(已发起即视为命中)。 */
export function isPreloaded(url: string): boolean {
  return cache.has(url)
}
