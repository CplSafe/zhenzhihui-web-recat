import { requestBusinessJson } from './business'

export const imageCategories = [
  { value: 'person', label: '人物' },
  { value: 'prop', label: '道具' },
  { value: 'scene', label: '场景' },
] as const

export type LibraryType = 'image' | 'audio'
export type LibraryCategory = '' | (typeof imageCategories)[number]['value']

export interface LibraryEntry {
  id: number
  asset_id: number
  type: LibraryType
  name: string
  category?: LibraryCategory
}

interface LibraryPage {
  items: LibraryEntry[]
  next_cursor?: number
}

export interface LibraryMetadata {
  name: string
  category: LibraryCategory
}

const libraryPath = '/api/v1/asset-library'

export function listAssetLibrary(
  workspaceId: number,
  type: LibraryType,
  category: LibraryCategory,
  cursor: number,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ workspace_id: String(workspaceId), type })
  if (category) query.set('category', category)
  if (cursor) query.set('cursor', String(cursor))
  return requestBusinessJson<LibraryPage>(`${libraryPath}?${query}`, { signal })
}

export function saveAssetLibraryEntry(
  workspaceId: number,
  metadata: LibraryMetadata,
  target: { entryId: number } | { assetId: number },
) {
  const query = new URLSearchParams({ workspace_id: String(workspaceId) })
  const editing = 'entryId' in target
  const path = editing ? `${libraryPath}/${target.entryId}` : libraryPath
  const body = editing ? metadata : { ...metadata, asset_id: target.assetId }
  return requestBusinessJson<LibraryEntry>(`${path}?${query}`, {
    method: editing ? 'PUT' : 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

export function removeAssetLibraryEntry(workspaceId: number, id: number) {
  return requestBusinessJson(`${libraryPath}/${id}?workspace_id=${workspaceId}`, { method: 'DELETE' })
}
