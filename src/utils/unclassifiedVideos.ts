/**
 * 「待归类」视频的归类判定 —— 全部从云端项目草稿派生,不再用 localStorage。
 * 一条来源视频被拖入某项目后,会写进该项目草稿的视频清单(见 projectVideos.addClassifiedVideo),
 * 并带上它的来源 key(videoKeyOf)。这里汇总各项目草稿里的来源 key,据此把已归类视频从「待分类」隐藏。
 */
import { readProjectVideoStore } from '@/api/projectVideos'

/** 视频的稳定标识:来源项目 id + 草稿里的视频 URL(签名会变,但草稿存的原始 URL 稳定) */
export function videoKeyOf(projectId: number, videoUrl: string): string {
  return `${projectId}::${String(videoUrl || '').trim()}`
}

/** 资产维度的稳定 key:assetId 永不变化,比 URL key 更可靠(历史上草稿存过签名 URL,URL key 会漂移)。 */
export function videoAssetKeyOf(assetId: number): string {
  return `asset::${Math.floor(Number(assetId) || 0)}`
}

/**
 * 一条待分类视频的全部候选 key。
 *
 * primary 是新写入归类记录时使用的 key(能解析出 assetId 就用资产 key);
 * candidates 供隐藏判定使用——必须同时包含旧格式 key,否则改用新 key 后,
 * 之前按旧格式写进各项目草稿的归类记录会失配,已归类的视频全部重新冒出来。
 */
export function videoSourceKeyCandidates({
  projectId,
  assetId,
  videoUrl,
}: {
  projectId: number
  assetId: number
  videoUrl: string
}): { primary: string; candidates: string[] } {
  const aid = Math.floor(Number(assetId) || 0)
  const legacy = videoKeyOf(projectId, videoUrl)
  if (aid > 0) {
    const primary = videoAssetKeyOf(aid)
    return { primary, candidates: [primary, legacy] }
  }
  return { primary: legacy, candidates: [legacy] }
}

/** 已归类(写入某项目视频清单)的来源视频 key 集合 —— 扫描已加载的项目列表草稿,云端口径,无 localStorage。 */
export function collectClassifiedKeys(projectItems: any[]): Set<string> {
  const set = new Set<string>()
  for (const project of Array.isArray(projectItems) ? projectItems : []) {
    const store = readProjectVideoStore(project)
    for (const record of store.records) {
      const key = String(record?.sourceKey || '').trim()
      if (key) set.add(key)
    }
  }
  return set
}
