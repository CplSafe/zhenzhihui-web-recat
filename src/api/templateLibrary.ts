import { requestBusinessJson } from '@/api/business'
import { isSafeMediaUrl } from '@/utils/urlSafety'

export interface LibraryCategory {
  id: number
  name: string
  position: number
}
export interface LibraryTemplate {
  id: number
  categoryId: number
  title: string
  description: string
  mediaType: string
  coverUrl: string
  mediaUrl: string
}
export interface LibraryPage {
  items: LibraryTemplate[]
  nextCursor: string
  hasMore: boolean
}

function normalizeTemplate(value: any): LibraryTemplate {
  const cover = String(value?.cover_url || '').trim()
  const media = String(value?.media_url || '').trim()
  return {
    id: Number(value?.id || 0),
    categoryId: Number(value?.category_id || 0),
    title: String(value?.title || '').trim() || '未命名模板',
    description: String(value?.description || '').trim(),
    mediaType: String(value?.media_type || '')
      .trim()
      .toLowerCase(),
    coverUrl: isSafeMediaUrl(cover) ? cover : '',
    mediaUrl: isSafeMediaUrl(media) ? media : '',
  }
}

export async function listLibraryCategories(signal?: AbortSignal): Promise<LibraryCategory[]> {
  const data = await requestBusinessJson<unknown>('/api/v1/template-categories', { signal })
  if (!Array.isArray(data)) throw new Error('分类数据格式错误')
  return data
    .map((v: any) => ({ id: Number(v.id), name: String(v.name || ''), position: Number(v.position || 0) }))
    .filter((v) => v.id > 0 && v.name)
}

export async function listLibraryTemplates(
  categoryId: number,
  cursor = '',
  signal?: AbortSignal,
): Promise<LibraryPage> {
  const params = new URLSearchParams({ limit: '20' })
  if (categoryId) params.set('category_id', String(categoryId))
  if (cursor) params.set('cursor', cursor)
  const data = await requestBusinessJson<any>(`/api/v1/templates?${params}`, { signal })
  if (!data || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor))
    throw new Error('模板列表数据格式错误')
  return {
    items: data.items.map(normalizeTemplate).filter((item: LibraryTemplate) => item.id > 0),
    nextCursor: String(data.next_cursor || ''),
    hasMore: data.has_more,
  }
}

export async function getLibraryTemplate(id: number, signal?: AbortSignal): Promise<LibraryTemplate> {
  const data = await requestBusinessJson<any>(`/api/v1/templates/${id}`, { signal })
  if (!data || Number(data.id) !== id) throw new Error('模板详情数据格式错误')
  return normalizeTemplate(data)
}
