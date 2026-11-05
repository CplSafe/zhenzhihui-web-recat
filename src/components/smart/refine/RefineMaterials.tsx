import { useEffect, useState } from 'react'
import { loadRefineDemoMedia, type RefineDemoMedia } from '@/utils/refineDemoMedia'
import styles from './RefineMaterials.module.less'

interface Props {
  media?: RefineDemoMedia[]
  ownerId: number
  workspaceId: number
  count: number
}

export default function RefineMaterials({ media, ownerId, workspaceId, count }: Props) {
  const [sources, setSources] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setSources([])
    setFailed(false)
    if (media?.length)
      void loadRefineDemoMedia(media, ownerId, workspaceId)
        .then((result) => {
          if (alive) setSources(result)
        })
        .catch(() => {
          if (alive) setFailed(true)
        })
    return () => {
      alive = false
    }
  }, [media, ownerId, workspaceId])
  if (!count) return <span>未上传素材</span>
  if (!media?.length || failed) return <span>{count} 个素材（预览不可用）</span>
  return (
    <div className={styles.list}>
      {media.map((item, index) =>
        sources[index] ? (
          <img
            key={item.kind === 'local' ? item.key : index}
            src={sources[index]}
            alt={`素材 ${index + 1}`}
            onError={() =>
              setSources((current) => current.map((source, itemIndex) => (itemIndex === index ? '' : source)))
            }
          />
        ) : (
          <span key={index} className={styles.missing}>
            素材 {index + 1} 暂不可预览
          </span>
        ),
      )}
    </div>
  )
}
