/**
 * 画布「上次使用的模型」（localStorage，本机习惯，不进云端）。
 *
 * 每次某类节点成功提交生成后记下所用模型；之后新建同类节点、还没手动选过模型时，
 * 面板默认选中它，而不是模型目录里的第一个（飞书需求：记录当前节点使用的模型，下次同类型内容自动默认选中）。
 *
 * 同一类节点在不同 operation 下可用模型不同（如文生图 / 图生图），所以按「类型 + operation」记，
 * 同时按类型再记一份兜底：换了 operation 但上次那个模型也支持时，仍能沿用。
 * 读出的 id 只是偏好，调用方必须确认它在当前可用列表里才采用（模型目录按工作空间下发，可能已下线）。
 */

const STORAGE_KEY = 'zzh_canvas_last_models'

type LastModelMap = Record<string, number>

function read(): LastModelMap {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return raw && typeof raw === 'object' ? (raw as LastModelMap) : {}
  } catch {
    return {}
  }
}

const opKey = (kind: string, operationCode: string) => `${kind}:${operationCode}`

/** 记录某类节点最近一次成功提交所用的模型。 */
export function rememberCanvasModel(kind: string, operationCode: string, modelVersionId: number): void {
  const id = Number(modelVersionId) || 0
  if (!kind || id <= 0) return
  try {
    const map = read()
    map[kind] = id
    if (operationCode) map[opKey(kind, operationCode)] = id
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // 隐私模式 / 存储写满：记不住只是少一个便利，不影响生成
  }
}

/**
 * 取上次用过、且当前仍可用的模型 id；没有则返回 0。
 * 先按「类型 + operation」精确匹配，再按类型兜底。
 */
export function pickRememberedCanvasModel(
  kind: string,
  operationCode: string,
  availableModelIds: readonly number[],
): number {
  if (!kind || !availableModelIds.length) return 0
  const map = read()
  for (const candidate of [operationCode ? map[opKey(kind, operationCode)] : 0, map[kind]]) {
    const id = Number(candidate) || 0
    if (id > 0 && availableModelIds.includes(id)) return id
  }
  return 0
}
