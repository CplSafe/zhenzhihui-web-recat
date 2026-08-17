/**
 * 可任意跳转的媒体源：把整片抓到本地，改用 object URL 播放。
 *
 * 素材的 /download 地址不支持 Range 分段请求，直接当 <video src> 用时浏览器停不住 currentTime——
 * 设完就被抹回 0，表现为「拖到 15 秒仍从头播」，严重时干脆报 SRC_NOT_SUPPORTED，
 * 或者连 duration 都读不出来（进度条上一片空白，看不到总时长）。
 * 本地 blob 的跳转完全在内存里完成，不依赖服务端。
 *
 * 这是全站唯一的一份实现：画布节点、时间线预览、各处预览弹窗都从这里取，
 * 同一条素材因此只下载一次。以前每处各写一份，同一个几十 MB 的文件会被重复下载好几遍。
 *
 * 抓取按地址引用计数共享，但释放认的是 acquire 返回的句柄而不是地址——
 * 「关掉弹窗又立刻重新打开」会在同一个地址上先后存在两个 entry，
 * 按地址释放会让先来的那个把后来者的引用计数减掉，后者随即被回收，正在播的视频当场断掉。
 */

/** 下载进度。服务端没给 Content-Length 时 totalBytes 为 0，表示进度未知。 */
export interface SeekableSourceProgress {
  loadedBytes: number
  totalBytes: number
}

type ProgressListener = (progress: SeekableSourceProgress) => void

/** 一次取用的结果。 */
export interface SeekableSourceResult {
  /** 实际可用的播放地址：本地副本，或抓取失败时的原始地址。 */
  url: string
  /** 是否真的换成了本地可跳转副本；false 表示跳转能力仍取决于服务端。 */
  local: boolean
}

/**
 * 一次取用。用完必须 release()，重复调用无副作用。
 *
 * 句柄是同步拿到的，ready 才是异步的——反过来（等下载完才给句柄）的话，
 * 下载途中卸载的组件手上什么都没有，那次几十 MB 的传输就只能一直跑到底。
 */
export interface SeekableSourceHandle {
  ready: Promise<SeekableSourceResult>
  release: () => void
}

interface CacheEntry {
  /** 抓取中的 promise；完成后仍保留，供后续 acquire 直接复用。 */
  promise: Promise<string>
  /** 已完成的 object URL；未完成或失败时为空。 */
  objectUrl: string
  refs: number
  controller: AbortController
  listeners: Set<ProgressListener>
  loadedBytes: number
  totalBytes: number
  settled: boolean
}

const cache = new Map<string, CacheEntry>()

/** 已经是本地地址的不需要再抓一遍。 */
function isLocalSource(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:')
}

const noopHandle = (url: string): SeekableSourceHandle => ({
  ready: Promise.resolve({ url, local: false }),
  release: () => {},
})

function emitProgress(entry: CacheEntry): void {
  const snapshot: SeekableSourceProgress = { loadedBytes: entry.loadedBytes, totalBytes: entry.totalBytes }
  for (const listener of entry.listeners) {
    try {
      listener(snapshot)
    } catch {
      /* 订阅者自己的异常不该打断下载 */
    }
  }
}

/** 释放一个 entry 的一次引用；最后一个使用者退出时回收 blob，没下载完就直接中止。 */
function releaseEntry(source: string, entry: CacheEntry): void {
  entry.refs -= 1
  if (entry.refs > 0) return
  // 只在这个 entry 仍是该地址的当前持有者时才摘除，避免误删后来新建的那个
  if (cache.get(source) === entry) cache.delete(source)
  entry.listeners.clear()
  if (!entry.settled) entry.controller.abort()
  if (entry.objectUrl) {
    URL.revokeObjectURL(entry.objectUrl)
    entry.objectUrl = ''
  }
}

/**
 * 边下边报进度。
 *
 * 能拿到 response.body 就流式读，读不到（老浏览器、测试环境的 fetch 垫片）退回一次性 blob()——
 * 那种情况只是没有中间进度，结果一样。
 */
async function downloadBlob(source: string, entry: CacheEntry): Promise<Blob> {
  const response = await fetch(source, { credentials: 'include', signal: entry.controller.signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  entry.totalBytes = Number(response.headers.get('content-length')) || 0
  const contentType = response.headers.get('content-type') || ''

  /*
   * 200 不等于拿到了视频。
   *
   * 会话过期、网关拦截、路由回落到 SPA 首页，这些情况后端都可能回一个 200 的 HTML；
   * 把那份 HTML 当视频塞进 <video>，本来还能正常播的源会当场变成解码失败——
   * 修跳转反而把播放弄坏了。宁可判失败回落到原地址。
   */
  if (/^(text\/|application\/(json|xml|xhtml))/i.test(contentType)) {
    throw new Error(`unexpected content-type: ${contentType}`)
  }

  // 后端把视频按 application/octet-stream 返回是常事，照抄到 blob 上浏览器就不认了。
  // 只在类型确实不是 video/* 时兜底成 mp4，不覆盖服务端给出的正确类型。
  const fallbackType = contentType.startsWith('video/') ? contentType : 'video/mp4'

  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    const blob = await response.blob()
    entry.loadedBytes = blob.size
    entry.totalBytes = entry.totalBytes || blob.size
    emitProgress(entry)
    return blob.type.startsWith('video/') ? blob : blob.slice(0, blob.size, fallbackType)
  }

  const reader = body.getReader()
  const chunks: BlobPart[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value as unknown as BlobPart)
    entry.loadedBytes += value.byteLength
    emitProgress(entry)
  }
  return new Blob(chunks, { type: fallbackType })
}

/**
 * 取得该地址的可跳转本地副本。
 *
 * 抓取失败时返回原地址而不是抛错：拿不到本地副本只是「跳转可能不准」，
 * 不该让整个预览直接不可用；此时句柄的 local 为 false，调用方可据此决定要不要提示。
 */
export function acquireSeekableSource(
  url: string,
  options: { onProgress?: ProgressListener } = {},
): SeekableSourceHandle {
  const source = String(url || '').trim()
  if (!source || isLocalSource(source)) return noopHandle(source)

  let entry = cache.get(source)
  if (entry) {
    entry.refs += 1
    if (options.onProgress) {
      // 先补一次当前进度：中途加入的订阅者不该停在 0，那会显得下载卡住了
      options.onProgress({ loadedBytes: entry.loadedBytes, totalBytes: entry.totalBytes })
      if (!entry.settled) entry.listeners.add(options.onProgress)
    }
  } else {
    const created: CacheEntry = {
      promise: Promise.resolve(source),
      objectUrl: '',
      refs: 1,
      controller: new AbortController(),
      listeners: new Set(options.onProgress ? [options.onProgress] : []),
      loadedBytes: 0,
      totalBytes: 0,
      settled: false,
    }
    created.promise = (async () => {
      try {
        const blob = await downloadBlob(source, created)
        if (!blob.size) throw new Error('empty media')
        // 抓取期间最后一个使用者已经退出：这份数据没人要了，不要再建 object URL
        if (cache.get(source) !== created) throw new Error('released')
        created.objectUrl = URL.createObjectURL(blob)
        return created.objectUrl
      } catch {
        // 鉴权/网络/跨域失败，或中途被释放：回落到原地址，跳转能力取决于源是否支持分段请求
        if (cache.get(source) === created) cache.delete(source)
        return source
      } finally {
        created.settled = true
        created.listeners.clear()
      }
    })()
    cache.set(source, created)
    entry = created
  }

  const held = entry
  let released = false
  return {
    ready: held.promise.then((resolved) => ({ url: resolved, local: resolved !== source })),
    release: () => {
      if (released) return
      released = true
      releaseEntry(source, held)
    },
  }
}

/** 已经就绪的本地地址；没有则返回空串。用于避免重复触发抓取。 */
export function getSeekableSource(url: string): string {
  return cache.get(String(url || '').trim())?.objectUrl || ''
}

/** 仅供测试重置模块级缓存。 */
export function clearSeekableSourceCache(): void {
  for (const entry of cache.values()) {
    if (!entry.settled) entry.controller.abort()
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl)
  }
  cache.clear()
}
