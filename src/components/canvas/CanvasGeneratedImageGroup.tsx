import CanvasImageResults from './CanvasImageResults'
import { assetStreamUrl } from '@/utils/assetUrl'

interface Props {
  assetIds: number[]
  primaryAssetId: number
  expanded: boolean
  workspaceId: number
  disabled?: boolean
  onToggle: () => void
  onSelectPrimary: (assetId: number) => void
  onSplit: () => void
  onDownload: (assetId: number) => void
  onPreview: (assetId: number) => void
  onPrimaryLoad: (width: number, height: number) => void
}

/** 图片结果组的画布适配层：只处理素材地址与节点动作，展示由 CanvasImageResults 负责。 */
export default function CanvasGeneratedImageGroup({
  assetIds,
  primaryAssetId,
  expanded,
  workspaceId,
  disabled,
  onToggle,
  onSelectPrimary,
  onSplit,
  onDownload,
  onPreview,
  onPrimaryLoad,
}: Props) {
  return (
    <CanvasImageResults
      assetIds={assetIds}
      primaryAssetId={primaryAssetId}
      expanded={expanded}
      resolveUrl={(assetId) => assetStreamUrl(assetId, workspaceId)}
      disabled={disabled}
      onToggle={onToggle}
      onSelectPrimary={onSelectPrimary}
      onSplit={onSplit}
      onDownload={onDownload}
      onPreview={onPreview}
      onPrimaryLoad={onPrimaryLoad}
    />
  )
}
