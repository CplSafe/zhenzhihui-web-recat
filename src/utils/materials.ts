// Pure helpers for selected / library material objects.

// 视频素材预览时优先用服务端封面图。
export function getMaterialPoster(material) {
  const asset = material?.serverAsset
  return asset?.thumbnail_url || asset?.cover_url || ''
}

// 判断素材是否为视频（决定 video / img 渲染）。
export function isVideoMaterial(material) {
  const mimeType = String(material?.mimeType || material?.serverAsset?.mime_type || '')
  return material?.type === 'video' || mimeType.startsWith('video/')
}


export function createMaterialFromAsset(asset, src = '') {
  return {
    id: `asset-${asset.id}`,
    assetId: asset.id,
    src,
    name: asset.name || `素材 ${asset.id}`,
    type: asset.type,
    mimeType: asset.mime_type,
    source: asset.source,
    serverAsset: asset,
  }
}
