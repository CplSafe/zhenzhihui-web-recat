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

// 判断素材是否为图片（脚本/分镜参考图筛选用）。
export function isImageMaterial(material) {
  const type = String(material?.type || '')
  const mimeType = String(material?.mimeType || material?.serverAsset?.mime_type || '')
  return type === 'image' || mimeType.startsWith('image/')
}

export function isSupportedMaterialFile(file) {
  const type = file?.type
  if (typeof type !== 'string') return false
  return type.startsWith('image/') || type.startsWith('video/')
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

// De-duplicate by id; primary entries win when conflicts arise.
export function mergeMaterials(primaryMaterials, secondaryMaterials) {
  const byId = new Map()
  for (const material of primaryMaterials) byId.set(material.id, material)
  for (const material of secondaryMaterials) {
    if (!byId.has(material.id)) byId.set(material.id, material)
  }
  return [...byId.values()]
}
