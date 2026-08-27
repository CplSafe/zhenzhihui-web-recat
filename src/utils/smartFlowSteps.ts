/**
 * 智能成片的流程步骤定义。
 *
 * 单独成模块，是为了让回归测试能导入**真实值**而不是抄一份副本——
 * 副本只能证明它自己自洽，步骤数变化时（比如这次从 4 步缩到 2 步）
 * 那种测试照样全绿，而线上进度条已经在读越界索引并白屏。
 *
 * 流程只有两步：分镜脚本 → 生成视频。
 * 「准备素材」和「镜头编排」已移除：这两步会先用 AI 重画一遍用户上传的素材
 * （主体素材图 → 分镜图），再拿重画后的结果去出片，用户的产品因此在成片里走样。
 * 现在用户上传的素材直接作为参考图提交给视频模型，中间没有任何重画环节。
 */
import type { StepItem } from '@/components/smart/StepProgress'

export const STEP_SCRIPT = 0
export const STEP_VIDEO = 1

export const STEPS: StepItem[] = [
  { key: 'script', label: '分镜脚本' },
  { key: 'video', label: '生成视频' },
]

export const REAL_PERSON_STEPS: StepItem[] = [
  { key: 'script', label: '真人策划' },
  { key: 'video', label: '真人成片' },
]

/** 进度条实际渲染的步骤索引。两条流程共用同一套下标。 */
export const VISIBLE_STEP_INDICES = [STEP_SCRIPT, STEP_VIDEO] as const

/**
 * 把任意步骤号夹到合法区间。
 *
 * 旧草稿存过 step 2 / 3（当时确实有那两步），不夹住会让进度条按不存在的索引取值。
 * 所有写入 step 的路径都应经过这里，而不是各自再写一遍 Math.min/max。
 */
export function clampStep(value: unknown): number {
  const step = Math.floor(Number(value) || 0)
  return Math.min(STEPS.length - 1, Math.max(0, step))
}
