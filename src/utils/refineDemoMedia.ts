import { assetStreamUrl } from '@/utils/assetUrl'

/** 图片素材只保存本地数据或稳定资产 ID，不持久化临时签名地址。 */
export type RefineDemoMedia = { kind: 'asset'; assetId: number } | { kind: 'local'; key: string } | { kind: 'missing' }

const DB_NAME = 'zzh_refine_demo_media'
const STORE = 'images'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开素材存储'))
    request.onblocked = () => reject(new Error('素材存储暂时不可用'))
  })
}

export async function saveRefineDemoMedia(
  taskId: string,
  ownerId: number,
  workspaceId: number,
  images: string[],
  assetIds: number[],
): Promise<RefineDemoMedia[]> {
  const media: RefineDemoMedia[] = images.map((image, index) => {
    const assetId = Number(assetIds[index] || 0)
    if (Number.isSafeInteger(assetId) && assetId > 0) return { kind: 'asset', assetId }
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(image))
      return { kind: 'local', key: `${ownerId}:${workspaceId}:${taskId}:${index}` }
    return { kind: 'missing' }
  })
  if (!media.some((item) => item.kind === 'local')) return media
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      media.forEach((item, index) => {
        if (item.kind === 'local') transaction.objectStore(STORE).put(images[index], item.key)
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('保存素材失败'))
      transaction.onabort = () => reject(transaction.error || new Error('保存素材失败'))
    })
    return media
  } finally {
    db.close()
  }
}

export async function loadRefineDemoMedia(
  media: RefineDemoMedia[],
  ownerId: number,
  workspaceId: number,
): Promise<string[]> {
  let db: IDBDatabase | undefined
  try {
    if (media.some((item) => item.kind === 'local' && item.key.startsWith(`${ownerId}:${workspaceId}:`)))
      db = await openDb()
    return await Promise.all(
      media.map((item) => {
        if (item.kind === 'asset') return assetStreamUrl(item.assetId, workspaceId)
        if (item.kind !== 'local' || !db || !item.key.startsWith(`${ownerId}:${workspaceId}:`)) return ''
        return new Promise<string>((resolve) => {
          const request = db!.transaction(STORE, 'readonly').objectStore(STORE).get(item.key)
          request.onsuccess = () =>
            resolve(typeof request.result === 'string' && /^data:image\//i.test(request.result) ? request.result : '')
          request.onerror = () => resolve('')
        })
      }),
    )
  } finally {
    db?.close()
  }
}
