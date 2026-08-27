/**
 * 读取后端 /ai/models 暴露的 input_constraints（见后端 ai.InputConstraintsFor）。
 *
 * 各视频模型能接收的参考图数量差别很大（Seedance 2.5 是 30 张、2.0 是 9 张、
 * 万相 reference_image 是 10 张、HappyHorse i2v 只收 1 张），且这套规则是后端提交时
 * 强制执行的。前端自己维护一张表必然与后端走样，所以一律以该字段为准。
 */

/** 上传控件关心的参考图 role：不同 provider 叫法不同，但语义都是「参考这张图生成」。 */
const REFERENCE_IMAGE_ROLES = ['image', 'reference_image'] as const

/**
 * 后端未返回 input_constraints 时的保守回退。
 *
 * 取 1 而不是 9：老后端的真实上限未知，放行 9 张可能让用户传满后在提交时被拒；
 * 放行 1 张最多是少传，用户还能换模型。宁可保守也不要制造「白传」。
 */
export const DEFAULT_REFERENCE_IMAGE_LIMIT = 1

export interface ModelInputRoleConstraint {
  role: string
  minCount: number
  maxCount: number
  mimeTypes: string[]
  maxSizeBytes: number
}

export interface ModelInputConstraints {
  roles: ModelInputRoleConstraint[]
  /** 组间互斥：任一组有素材时其它组必须为空（万相的首尾帧 vs 参考素材）。 */
  mutuallyExclusiveRoleGroups: string[][]
}

const EMPTY_CONSTRAINTS: ModelInputConstraints = { roles: [], mutuallyExclusiveRoleGroups: [] }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function positiveInt(value: unknown): number {
  const n = Math.floor(Number(value) || 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

/** 解析某个 operation 下的素材约束；字段缺失或结构损坏时返回空约束而非抛错。 */
export function getModelInputConstraints(model: unknown, operationCode: string): ModelInputConstraints {
  const source = asRecord(model)
  if (!source) return EMPTY_CONSTRAINTS
  const all = asRecord(source.input_constraints ?? source.inputConstraints)
  if (!all) return EMPTY_CONSTRAINTS
  const forOperation = asRecord(all[operationCode])
  if (!forOperation) return EMPTY_CONSTRAINTS

  const rawRoles = Array.isArray(forOperation.roles) ? forOperation.roles : []
  const roles = rawRoles
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      role: String(entry.role ?? '').trim(),
      minCount: Math.max(0, Math.floor(Number(entry.min_count ?? entry.minCount) || 0)),
      maxCount: positiveInt(entry.max_count ?? entry.maxCount),
      mimeTypes: toStringArray(entry.mime_types ?? entry.mimeTypes),
      maxSizeBytes: positiveInt(entry.max_size_bytes ?? entry.maxSizeBytes),
    }))
    .filter((entry) => entry.role !== '')

  const rawGroups = forOperation.mutually_exclusive_role_groups ?? forOperation.mutuallyExclusiveRoleGroups
  const mutuallyExclusiveRoleGroups = (Array.isArray(rawGroups) ? rawGroups : [])
    .map((group) => toStringArray(group))
    .filter((group) => group.length > 0)

  return { roles, mutuallyExclusiveRoleGroups }
}

/**
 * 该模型在指定 operation 下允许的参考图张数。
 * 后端没给约束、或给了非正数时回退到 DEFAULT_REFERENCE_IMAGE_LIMIT。
 */
export function getModelReferenceImageLimit(model: unknown, operationCode: string): number {
  const { roles } = getModelInputConstraints(model, operationCode)
  for (const role of REFERENCE_IMAGE_ROLES) {
    const match = roles.find((entry) => entry.role === role)
    if (match && match.maxCount > 0) return match.maxCount
  }
  return DEFAULT_REFERENCE_IMAGE_LIMIT
}
