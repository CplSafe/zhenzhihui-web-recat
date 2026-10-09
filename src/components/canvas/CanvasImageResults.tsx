import type { CSSProperties } from 'react'
import styles from './CanvasImageResults.module.css'

interface Props {
  assetIds: number[]
  primaryAssetId: number
  expanded: boolean
  resolveUrl: (assetId: number) => string
  disabled?: boolean
  onToggle: () => void
  onSelectPrimary?: (assetId: number) => void
  onSplit?: () => void
  onDownload?: (assetId: number) => void
  onPreview?: (assetId: number) => void
  onPrimaryLoad?: (width: number, height: number) => void
}

/** 同一个节点的同批结果：折叠是主图叠放，展开是可比较的两列图片。 */
export default function CanvasImageResults({
  assetIds,
  primaryAssetId,
  expanded,
  resolveUrl,
  disabled,
  onToggle,
  onSelectPrimary,
  onSplit,
  onDownload,
  onPreview,
  onPrimaryLoad,
}: Props) {
  const shown = expanded ? assetIds : [primaryAssetId]
  return (
    <div
      className={`${styles.results} ${expanded ? styles.expanded : styles.collapsed}`}
      aria-label={`${assetIds.length} 张生成结果`}
    >
      {!expanded &&
        assetIds
          .filter((id) => id !== primaryAssetId)
          .slice(0, 2)
          .reverse()
          .map((assetId, index) => (
            <img
              key={assetId}
              className={styles.stack}
              src={resolveUrl(assetId)}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={{ '--layer': 2 - index } as CSSProperties}
            />
          ))}
      {shown.map((assetId, index) => {
        const primary = assetId === primaryAssetId
        return (
          <div key={assetId} className={styles.item}>
            <img
              className={styles.image}
              src={resolveUrl(assetId)}
              alt={`生成图片 ${assetIds.indexOf(assetId) + 1}${primary ? '（主图）' : ''}`}
              draggable={false}
              onDoubleClick={(event) => {
                event.stopPropagation()
                onPreview?.(assetId)
              }}
              onLoad={(event) => {
                if (primary) onPrimaryLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
              }}
            />
            {expanded && <span className={styles.badge}>{primary ? '主图' : `第 ${index + 1} 张`}</span>}
            <div
              className={`${styles.actions} nodrag nopan`}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {expanded && onDownload && (
                <button type="button" onClick={() => onDownload(assetId)} aria-label={`下载第 ${index + 1} 张`}>
                  下载
                </button>
              )}
              {expanded && !primary && onSelectPrimary && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectPrimary(assetId)}
                  aria-label={`将第 ${index + 1} 张设为主图`}
                >
                  设为主图
                </button>
              )}
              {primary && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onToggle}
                  aria-expanded={expanded}
                  aria-label={expanded ? '收起组图' : `展开 ${assetIds.length} 张图片`}
                >
                  {expanded ? '收起' : `展开 ${assetIds.length} 张`}
                </button>
              )}
            </div>
            {expanded && primary && onSplit && (
              <button
                type="button"
                className={`${styles.split} nodrag nopan`}
                disabled={disabled}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={onSplit}
              >
                拆为独立节点
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
