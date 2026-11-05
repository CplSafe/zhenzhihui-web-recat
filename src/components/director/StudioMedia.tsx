import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { mediaSources, mediaURLs } from './studio'
import type { Data } from './studio'
import styles from './DeepAgentStudio.module.css'

export const StudioMediaContext = createContext<{ refresh: (assetId: number) => Promise<Data> } | null>(null)
/** Expiring signed URLs are refreshed by run-bound asset ID, never by a model-supplied URL. */
export function Media({ data, canvas }: { data: unknown; canvas?: Data | null }) {
  const service = useContext(StudioMediaContext),
    sources = mediaSources(data, canvas)
  const [fresh, setFresh] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<Record<number, boolean>>({})
  const attempted = useRef(new Set<number>()),
    inflight = useRef(new Set<number>()),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function refresh(id: number, automatic = false) {
    if (!service || inflight.current.has(id) || (automatic && attempted.current.has(id))) return
    attempted.current.add(id)
    inflight.current.add(id)
    setBusy((old) => ({ ...old, [id]: true }))
    try {
      const asset = await service.refresh(id),
        url = mediaURLs(asset)[0]
      if (Number(asset.id) !== id || !url) throw new Error('素材暂不可用或无权访问。')
      if (mounted.current) {
        setFresh((old) => ({ ...old, [id]: url }))
        setErrors((old) => ({ ...old, [id]: '' }))
      }
    } catch (e) {
      if (mounted.current)
        setErrors((old) => ({ ...old, [id]: e instanceof Error ? e.message : '素材链接暂不可用，请刷新。' }))
    } finally {
      inflight.current.delete(id)
      if (mounted.current) setBusy((old) => ({ ...old, [id]: false }))
    }
  }
  return (
    <div className={styles.mediaGrid}>
      {sources.map((source) => {
        const id = source.assetId,
          url = (id && fresh[id]) || source.url
        const failed = () => {
          if (id) {
            setErrors((old) => ({ ...old, [id]: '素材链接暂不可用，请刷新。' }))
            void refresh(id, true)
          }
        }
        return (
          <div key={id || source.url}>
            {/\.(mp4|webm|mov)(?:$|\?)/i.test(url) ? (
              <video src={url} controls preload="metadata" onError={failed} />
            ) : /\.(png|jpe?g|webp)(?:$|\?)/i.test(url) ? (
              <img src={url} alt="生成素材" loading="lazy" onError={failed} />
            ) : null}
            <a href={url} target="_blank" rel="noopener noreferrer">
              打开素材 ↗
            </a>
            {id && service && (
              <button type="button" disabled={busy[id]} onClick={() => void refresh(id)}>
                {busy[id] ? '刷新中…' : '刷新素材链接'}
              </button>
            )}
            {id && errors[id] && (
              <p role="status" className={styles.muted}>
                {errors[id]}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
