import type { SmartDraft } from './smartDraft'

type ImageMessage = {
  id?: string
  role?: string
  status?: string
  taskId?: number
  batchId?: string
  idempotencyKey?: string
  request?: unknown
  terminalFailure?: boolean
  images?: Array<{ url?: string; assetId?: number }>
  [key: string]: unknown
}

/** 已完成且带可恢复结果的图片消息，是两端合并时最高优先级的终态。 */
function hasImageResult(message: ImageMessage | undefined): boolean {
  return (
    message?.status === 'done' &&
    Array.isArray(message.images) &&
    message.images.some((image) => String(image?.url || '').trim() || Number(image?.assetId || 0) > 0)
  )
}

/** error 只有在后端明确确认任务终止时才是终态；连接中断仍应继续恢复原 taskId。 */
function isTerminalImageMessage(message: ImageMessage | undefined): boolean {
  if (!message) return false
  if (message.status === 'done') return true
  if (message.status !== 'error') return false
  return Number(message.taskId || 0) <= 0 || message.terminalFailure === true
}

/**
 * 合并同一图片对话在云端与本地的任务状态。
 * 成功结果优先于失败/进行中；同 taskId 的其余冲突以后端为准，避免旧本地错误遮住云端成功。
 */
export function mergeImageMessagesForRecovery(backend: unknown, local: unknown): ImageMessage[] {
  const backendMessages = Array.isArray(backend) ? (backend as ImageMessage[]) : []
  const localMessages = Array.isArray(local) ? (local as ImageMessage[]) : []
  if (!localMessages.length) return backendMessages

  const backendById = new Map(backendMessages.map((message) => [String(message?.id || ''), message]))
  const localById = new Map(localMessages.map((message) => [String(message?.id || ''), message]))
  const order = [
    ...backendMessages.map((message) => String(message?.id || '')),
    ...localMessages.map((message) => String(message?.id || '')),
  ].filter(Boolean)
  const seen = new Set<string>()

  return order.flatMap((id) => {
    if (seen.has(id)) return []
    seen.add(id)
    const backendMessage = backendById.get(id)
    const localMessage = localById.get(id)
    if (!backendMessage) return localMessage ? [localMessage] : []
    if (!localMessage) return [backendMessage]

    const backendHasResult = hasImageResult(backendMessage)
    const localHasResult = hasImageResult(localMessage)
    if (backendHasResult !== localHasResult) return [backendHasResult ? backendMessage : localMessage]

    const backendTerminal = isTerminalImageMessage(backendMessage)
    const localTerminal = isTerminalImageMessage(localMessage)
    if (backendTerminal !== localTerminal) return [backendTerminal ? backendMessage : localMessage]

    const backendTaskId = Number(backendMessage.taskId || 0) || 0
    const localTaskId = Number(localMessage.taskId || 0) || 0
    if (backendTaskId !== localTaskId) return [backendTaskId > localTaskId ? backendMessage : localMessage]
    return [backendMessage]
  })
}

/** 判断本地图片任务是否比云端更新，或仍持有云端尚未写入的可恢复任务凭证。 */
export function shouldMergeLocalImageRecovery(
  backendDraft: SmartDraft | null,
  localDraft: SmartDraft | null,
  projectId: number,
): boolean {
  if (!localDraft?.started || Number(localDraft.projectId || 0) !== Number(projectId || 0)) return false
  const messages = Array.isArray(localDraft.imageMessages) ? (localDraft.imageMessages as ImageMessage[]) : []
  const hasRecoverablePending = messages.some(
    (message) =>
      message?.role === 'assistant' &&
      (message?.status === 'pending' || (message?.status === 'error' && Number(message?.taskId || 0) > 0)) &&
      (Number(message?.taskId || 0) > 0 ||
        (String(message?.batchId || '').trim() && String(message?.idempotencyKey || '').trim() && message?.request)),
  )
  if (hasRecoverablePending) return true

  const backendSavedAt = Number(backendDraft?.savedAt || 0) || 0
  const localSavedAt = Number(localDraft.savedAt || 0) || 0
  if (!backendSavedAt || localSavedAt <= backendSavedAt) return false

  return messages.some(
    (message) =>
      message?.role === 'assistant' &&
      (hasImageResult(message) ||
        (message?.status === 'error' &&
          (Number(message?.taskId || 0) > 0 || String(message?.idempotencyKey || '').trim()))),
  )
}
