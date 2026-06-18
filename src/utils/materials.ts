// Pure helpers for selected / library material objects.

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
