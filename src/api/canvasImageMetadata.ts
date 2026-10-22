import {
  unwrapGenerationModelCatalogResponse,
  getBackendGenerationModelVersionId,
} from '@/utils/generationModelCatalog'
import { extractAssetPage, getAiTask, listAiModels, listAssets } from './business'
import { imageGenerationInfo, type CanvasImageInfo } from '@/utils/canvasImageInfo'

/** One read-only resolver per open gallery; caches never cross workspace/account sessions. */
export function createCanvasImageMetadataResolver() {
  const assets = new Map<number, Promise<Map<number, any>>>()
  const tasks = new Map<string, Promise<CanvasImageInfo | undefined>>()
  const catalogs = new Map<string, Promise<any[]>>()
  async function assetIndex(workspaceId: number) {
    if (!assets.has(workspaceId)) {
      const pending = (async () => {
        const index = new Map<number, any>()
        const seen = new Set<string>()
        let offset = 0
        for (let page = 0; page < 20; page += 1) {
          const result = extractAssetPage(await listAssets({ workspaceId, type: 'image', limit: 100, offset }))
          const items = result.items || []
          const signature = items.map((item: any) => item.id).join(',')
          if (!items.length || seen.has(signature)) break
          seen.add(signature)
          items.forEach((item: any) => index.set(Number(item.id), item))
          offset += items.length
          if (offset >= result.total) break
        }
        return index
      })()
      assets.set(workspaceId, pending)
      pending.catch(() => assets.delete(workspaceId))
    }
    return assets.get(workspaceId)!
  }
  return async ({
    assetId,
    workspaceId,
  }: {
    assetId?: number
    workspaceId?: number
  }): Promise<CanvasImageInfo | undefined> => {
    if (!Number.isSafeInteger(assetId) || !Number.isSafeInteger(workspaceId) || assetId <= 0 || workspaceId <= 0) return
    const asset = (await assetIndex(workspaceId)).get(assetId)
    const taskId = Number(
      asset?.task_id ??
        asset?.taskId ??
        asset?.ai_task_id ??
        asset?.aiTaskId ??
        asset?.source_task_id ??
        asset?.sourceTaskId,
    )
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return
    const key = `${workspaceId}:${taskId}`
    if (!tasks.has(key)) {
      const pending = (async () => {
        const task = await getAiTask({ workspaceId, taskId })
        if (Number(task?.id || task?.task_id) !== taskId) return
        const operationCode = String(task.operation_code || '')
        if (!operationCode.startsWith('image.')) return
        const modelVersionId = Number(task.model_version_id || 0)
        let modelName = typeof task.model_name === 'string' ? task.model_name : ''
        if (!modelName && modelVersionId > 0) {
          const catalogKey = `${workspaceId}:${operationCode}`
          if (!catalogs.has(catalogKey))
            catalogs.set(
              catalogKey,
              listAiModels({ workspaceId, operationCode, plan: '' }).then(unwrapGenerationModelCatalogResponse),
            )
          try {
            const models = await catalogs.get(catalogKey)
            const model = models.find(
              (item: any) => Number(getBackendGenerationModelVersionId(item)) === modelVersionId,
            )
            modelName = model?.display_name || model?.displayName || model?.name || ''
          } catch {
            catalogs.delete(catalogKey)
          }
        }
        let params = task.params ?? task.params_json ?? {}
        if (typeof params === 'string') {
          try {
            params = JSON.parse(params)
          } catch {
            params = {}
          }
        }
        return imageGenerationInfo(
          {
            operationCode,
            modelVersionId,
            prompt: typeof task.prompt === 'string' ? task.prompt : '',
            params: params && typeof params === 'object' ? params : {},
          },
          modelName,
          String(task.completed_at || task.created_at || ''),
        )
      })()
      tasks.set(key, pending)
      pending.catch(() => tasks.delete(key))
    }
    return tasks.get(key)
  }
}
