import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { showToast } from '@/stores/ui'
import type { CanvasShortcutBindings } from '@/utils/canvasKeyboard'

interface KeyboardLock {
  lock: (codes: string[]) => Promise<void>
  unlock: () => void
}

function keyboardLock(): KeyboardLock | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
}

/** 仅锁定画布命令涉及的键，Esc、Tab 和其它浏览器导航键继续由浏览器管理。 */
export function canvasKeyboardLockCodes(bindings: CanvasShortcutBindings): string[] {
  const codes = new Set<string>()
  for (const binding of [
    ...Object.values(bindings),
    'Mod+F',
    'Mod+G',
    'Mod+A',
    'Mod+C',
    'Mod+V',
    'Mod+Z',
    'Mod+Y',
    'Mod+Enter',
  ]) {
    const key = binding.split('+').pop() || ''
    if (/^[A-Z]$/.test(key)) codes.add(`Key${key}`)
    else if (/^\d$/.test(key)) codes.add(`Digit${key}`)
    else if (key === '=') {
      codes.add('Equal')
      codes.add('NumpadAdd')
    } else if (key === '-') {
      codes.add('Minus')
      codes.add('NumpadSubtract')
    } else if (
      /^F([1-9]|1\d|2[0-4])$/.test(key) ||
      ['Space', 'Enter', 'Delete', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)
    )
      codes.add(key)
  }
  return [...codes].sort()
}

/** 浏览器保留键只在主动全屏 + Keyboard Lock 授权成功后才能优先交给画布。 */
export function useCanvasKeyboardPriority(root: RefObject<HTMLElement>, bindings: CanvasShortcutBindings) {
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState(false)
  const owned = useRef(false)
  const mounted = useRef(false)
  const attempt = useRef(0)
  const busy = useRef(false)
  const lockedCodes = useRef('')
  const codes = useMemo(() => canvasKeyboardLockCodes(bindings), [bindings])
  const signature = codes.join(',')

  useEffect(() => {
    mounted.current = true
    const onFullscreenChange = () => {
      if (!owned.current || document.fullscreenElement === document.documentElement) return
      attempt.current++
      owned.current = false
      keyboardLock()?.unlock()
      setEnabled(false)
      if (!busy.current) setPending(false)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      mounted.current = false
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      if (!owned.current) return
      owned.current = false
      keyboardLock()?.unlock()
      if (document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [])

  // 自定义绑定改变时更新捕获范围；仅在已有锁定授权的全屏会话中执行。
  useEffect(() => {
    if (!enabled || lockedCodes.current === signature) return
    let disposed = false
    void keyboardLock()
      ?.lock(codes)
      .then(() => {
        if (!disposed) lockedCodes.current = signature
      })
      .catch(() => {
        if (disposed) return
        keyboardLock()?.unlock()
        setEnabled(false)
        showToast('快捷键接管已失效，请退出全屏后重新开启', 'error')
      })
    return () => {
      disposed = true
    }
  }, [codes, signature, enabled])

  const toggle = async () => {
    if (busy.current) return
    if (owned.current) {
      keyboardLock()?.unlock()
      setEnabled(false)
      try {
        await document.exitFullscreen()
      } catch {
        showToast('退出全屏失败，请按 Esc 退出', 'error')
      }
      return
    }
    const keyboard = keyboardLock()
    if (!keyboard?.lock || !keyboard.unlock || !document.documentElement.requestFullscreen) {
      showToast('当前浏览器不支持全屏快捷键接管，请使用支持 Keyboard Lock 的桌面浏览器', 'info')
      return
    }
    if (document.fullscreenElement) {
      showToast('请先退出当前全屏，再开启全屏快捷键模式', 'info')
      return
    }
    const current = ++attempt.current
    busy.current = true
    setPending(true)
    owned.current = true
    try {
      await document.documentElement.requestFullscreen()
      if (!mounted.current || current !== attempt.current) {
        if (!mounted.current && document.fullscreenElement === document.documentElement)
          await document.exitFullscreen().catch(() => undefined)
        return
      }
      // 有显式拒绝权限时直接回退；旧浏览器不认识该权限名则交给 lock() 自身判断。
      const permission = await navigator.permissions
        ?.query({ name: 'keyboard-lock' as PermissionName })
        .catch(() => null)
      if (permission?.state === 'denied') throw new DOMException('Keyboard lock denied', 'NotAllowedError')
      await keyboard.lock(codes)
      if (!mounted.current || current !== attempt.current || document.fullscreenElement !== document.documentElement) {
        if (!owned.current) keyboard.unlock()
        return
      }
      lockedCodes.current = signature
      setEnabled(true)
      root.current?.focus({ preventScroll: true })
      showToast('已开启全屏快捷键模式，按 Esc 退出', 'success')
    } catch {
      if (!mounted.current || current !== attempt.current) return
      keyboard.unlock()
      setEnabled(false)
      showToast('未能接管快捷键，请允许浏览器的键盘锁定权限后重试', 'error')
      if (document.fullscreenElement === document.documentElement)
        await document.exitFullscreen().catch(() => undefined)
      owned.current = false
    } finally {
      if (mounted.current) {
        busy.current = false
        setPending(false)
      }
    }
  }

  return { enabled, pending, toggle }
}
