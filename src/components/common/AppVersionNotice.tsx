import { useEffect, useState } from 'react'
import styles from './AppVersionNotice.module.css'
import { saveDraftsBeforeUpdate } from '@/utils/updateDraftRegistry'

const CHECK_INTERVAL_MS = 5 * 60 * 1000

/** 提示用户自行更新，保留浏览器现有的未保存内容保护。 */
export default function AppVersionNotice({
  enabled = import.meta.env.PROD,
  currentVersion = typeof __APP_BUILD_VERSION__ === 'string' ? __APP_BUILD_VERSION__ : '',
}: {
  enabled?: boolean
  currentVersion?: string
}) {
  const [availableVersion, setAvailableVersion] = useState('')
  const [dismissedVersion, setDismissedVersion] = useState('')
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    if (!enabled || !currentVersion) return
    let active = true
    let pending = false
    const controller = new AbortController()
    const checkVersion = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const url = new URL(`${import.meta.env.BASE_URL}app-version.json`, window.location.origin)
        url.searchParams.set('check', String(Date.now()))
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) return
        const data: unknown = await response.json()
        const version = data && typeof data === 'object' && 'version' in data ? data.version : null
        if (active && typeof version === 'string' && version.trim()) {
          setAvailableVersion(version === currentVersion ? '' : version)
        }
      } catch {
        // 离线、部署未完成或版本文件不可用时保留当前页面，不干扰用户。
      } finally {
        pending = false
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkVersion()
    }
    void checkVersion()
    const timer = window.setInterval(checkVersion, CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, currentVersion])

  if (!availableVersion || availableVersion === dismissedVersion) return null
  return (
    <section className={styles.notice} role="status" aria-label="系统更新提示">
      <div className={styles.content}>
        <strong>系统已更新</strong>
        <p>刷新页面以使用最新版本，请先确认其他未保存内容。</p>
        {saveError && <p role="alert">草稿保存失败，请保留当前页面并检查浏览器存储后重试。</p>}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.later} onClick={() => setDismissedVersion(availableVersion)}>
          稍后再说
        </button>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => {
            if (!saveDraftsBeforeUpdate()) {
              setSaveError(true)
              return
            }
            window.location.reload()
          }}
        >
          立即刷新
        </button>
      </div>
    </section>
  )
}
