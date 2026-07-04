/**
 * 下载文件到本地,并尽量让用户自选保存位置(对齐 Vue ProjectManagementView.downloadSavedVideo)。
 *
 * 三步:
 *  ① 先在用户手势内弹 showSaveFilePicker「另存为」拿文件句柄(必须在任何耗时 await 之前调用,
 *     以保留瞬时激活;用户取消则直接结束)。浏览器不支持(非 Chromium / 非安全上下文)则无句柄。
 *  ② 再 resolveUrl()(可在此刷新签名 URL)。
 *  ③ 分两条路下载:
 *     - 路径1:同源 + 已选文件夹 → fetch 成 blob,写入文件句柄;
 *     - 路径2(回退):隐藏 iframe 触发浏览器下载(跨域 CDN 走这条,靠 Content-Disposition,不跳转页面)。
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
      fileHandle = null // 不支持/权限失败 → 走路径2
    }
  }

  // ② 解析视频数据 URL
  const url = await opts.resolveUrl()

  const isSameOrigin = (() => {
    try {
      return new URL(url, window.location.href).origin === window.location.origin
    } catch {
      return false
    }
  })()

  // ③ 路径1:同源 + 已选文件夹 → fetch + 校验内容 + 直接写入
  if (fileHandle && isSameOrigin) {
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
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'done'
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled'
      if (err?.name === 'EmptyContentError') throw err // 空内容:别静默回退到 iframe(同样是空),交给调用方提示
      // 其它(网络等)失败 → 落到路径2(iframe 下载)
    }
  }

  // ③ 路径2:隐藏 iframe 触发下载(跨域 CDN 走这条路,不跳转页面)
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
