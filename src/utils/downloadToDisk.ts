/**
 * 下载文件到本地,并尽量让用户自选保存位置。全站唯一下载入口
 * (项目管理 / 智能成片 / 爆款复制 / 历史项目 / 模板库 都走这里,取代此前 4 套各异实现)。
 *
 * 四步:
 *  ① 先在用户手势内弹 showSaveFilePicker「另存为」拿文件句柄(必须在任何耗时 await 之前调用,
 *     以保留瞬时激活;用户取消则直接结束)。浏览器不支持(非 Chromium / 非安全上下文)则无句柄。
 *  ② resolveUrl()(可在此刷新签名 URL)。
 *  ③ 尝试 fetch 成 blob 并校验内容(任何源都试:同源 /download 必成,跨域资源域名若放行 CORS 也成):
 *     - 有文件句柄 → 写入句柄;
 *     - 无句柄 → a[download] 触发下载(blob 同源,download 必生效,文件名可控)。
 *  ④ fetch 失败(跨域未放行 CORS / 网络)→ 隐藏 iframe 触发浏览器下载(靠 Content-Disposition,不跳转页面)。
 */
type DownloadResult = 'done' | 'cancelled'

export async function downloadToDisk(opts: {
  /** 建议文件名(含扩展名,如 我的视频_20260624.mp4) */
  fileName: string
  /** 解析最终可下载 URL(可在此刷新签名 URL);在选好保存位置后才调用 */
  resolveUrl: () => Promise<string> | string
  /** MIME(写入文件句柄时用,默认 video/mp4) */
  mimeType?: string
}): Promise<DownloadResult> {
  const mime = opts.mimeType || 'video/mp4'
  const ext = (opts.fileName.split('.').pop() || '').toLowerCase()

  // ① 先弹「另存为」(用户手势内)
  const picker = (window as { showSaveFilePicker?: any }).showSaveFilePicker
  let fileHandle: any = null
  if (typeof picker === 'function') {
    try {
      fileHandle = await picker({
        suggestedName: opts.fileName,
        ...(ext ? { types: [{ description: '文件', accept: { [mime]: [`.${ext}`] } }] } : {}),
      })
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled' // 用户取消
      fileHandle = null // 不支持/权限失败 → 后续仍可 a[download] / iframe
    }
  }

  // ② 解析视频数据 URL
  const url = await opts.resolveUrl()

  // ③ 尝试 fetch + 内容校验(任何源都试一次)
  try {
    // 内容校验:视频流不应是 0 字节(资源尚未写完),也不应是 JSON/HTML/纯文本(被包成 200 的错误体)。
    // 「刚生成还没落库」是时序竞态 → 命中空内容时自动等待重试几次,多数能自愈,避免存出空 mp4。
    let blob: Blob | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ct = res.headers.get('content-type') || ''
      const raw = await res.blob()
      if (raw.size > 0 && !/application\/json|text\/html|text\/plain/i.test(ct)) {
        blob = new Blob([raw], { type: mime })
        break
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500)) // 等待后端写完再重试
    }
    if (!blob) {
      const empty = new Error('视频内容为空或尚未就绪,请稍后重试')
      empty.name = 'EmptyContentError'
      throw empty
    }
    // 写入:优先文件句柄(另存为对话框),否则 a[download](blob 同源,download 必生效)
    if (fileHandle) {
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'done'
    }
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = opts.fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(objUrl), 4000)
    return 'done'
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'cancelled'
    if (err?.name === 'EmptyContentError') throw err // 空内容:别静默回退到 iframe(同样是空),交给调用方提示
    // 其它(跨域 CORS / 网络)失败 → 落到路径④(iframe 下载)
  }

  // ④ 隐藏 iframe 触发下载(跨域未放行 CORS 的 CDN 走这条路,不跳转页面)
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = url
  document.body.appendChild(iframe)
  setTimeout(() => {
    try {
      document.body.removeChild(iframe)
    } catch {
      /* 已移除 */
    }
  }, 3000)
  return 'done'
}

/** 生成「安全文件名_YYYYMMDD.ext」。title 去掉非法字符;date 由调用方传入(模块内不可用 Date.now)。 */
export function buildDownloadName(title: string, date: Date, ext = 'mp4'): string {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const safe = String(title || '视频').replace(/[\\/:*?"<>|]/g, '').trim() || '视频'
  return `${safe}_${dateStr}.${ext}`
}
