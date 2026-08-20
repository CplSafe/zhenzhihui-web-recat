/**
 * 创作台参考图的共享数据结构与本地选图逻辑。
 *
 * 通用参考图网格（StudioRefImages）与首尾帧槽位（StudioFrameSlots）共用这一份，
 * 避免两处各自维护一套 objectURL 创建 / 回收规则而出现内存泄漏口径不一致。
 * 纯逻辑：不发请求、不读全局状态。
 */

/** 一张待用参考图：本地预览 URL + 是否需要回收。 */
export interface StudioRefImage {
  id: string
  url: string
  /** 由本地 File 生成的 objectURL 需要在移除时回收。 */
  isObjectUrl?: boolean
}

let refImageSequence = 0

/** 生成浏览器实例内唯一的参考图 ID。 */
export function createRefImageId(): string {
  refImageSequence += 1
  return `ref-${Date.now().toString(36)}-${refImageSequence.toString(36)}`
}

/** 把本地 File 包装成带预览地址的参考图。 */
export function toRefImage(file: File): StudioRefImage {
  return { id: createRefImageId(), url: URL.createObjectURL(file), isObjectUrl: true }
}

/** 回收该参考图占用的 objectURL；不是本地图时什么都不做。 */
export function releaseRefImage(image: StudioRefImage | null | undefined): void {
  if (image?.isObjectUrl) URL.revokeObjectURL(image.url)
}

/** 批量回收（组件卸载、整体清空时用）。 */
export function releaseRefImages(images: readonly StudioRefImage[] | null | undefined): void {
  images?.forEach(releaseRefImage)
}

/** 从一次选择中取出图片文件并包装；limit 为本次最多接受的张数。 */
export function pickRefImages(files: FileList | File[] | null, limit: number): StudioRefImage[] {
  if (!files || limit <= 0) return []
  return Array.from(files)
    .filter((file) => file.type.startsWith('image/'))
    .slice(0, limit)
    .map(toRefImage)
}

/** 文件选择框统一接受的图片类型。 */
export const REF_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'
