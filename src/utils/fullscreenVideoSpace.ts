/**
 * 全屏看视频时，空格只做「播放 / 暂停」。
 *
 * 不全屏时空格本来就好用：焦点在 <video> 上，浏览器原生切换播放。全屏后焦点往往留在别处——
 * 停在弹窗的「关闭」按钮上时，空格等于点了关闭，视频直接被关掉；焦点在 body 上时空格没有任何反应。
 * 这里只在「有视频处于全屏」时接管空格（捕获阶段，抢在按钮、页面快捷键之前），其余时候完全不碰。
 */

function fullscreenVideo(): HTMLVideoElement | null {
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  const element = doc.fullscreenElement || doc.webkitFullscreenElement || null
  if (!element) return null
  if (element instanceof HTMLVideoElement) return element
  // 自定义播放器把外层容器设为全屏时，取里面的视频
  return element.querySelector('video')
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}

/** 安装全局监听，返回卸载函数 */
export function installFullscreenVideoSpaceToggle(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== ' ' && event.code !== 'Space') return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const video = fullscreenVideo()
    if (!video || isTypingTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    // 按住不放时的自动重复不再反复切换
    if (event.repeat) return
    if (video.paused || video.ended) void video.play().catch(() => undefined)
    else video.pause()
  }
  // keyup 也要拦：部分浏览器在按钮上是 keyup 才触发 click
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== ' ' && event.code !== 'Space') return
    if (!fullscreenVideo() || isTypingTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onKeyUp, true)
  }
}
