/**
 * 创意项目初始化工具：创建项目后写入最小可用草稿，并处理版本冲突与失败回滚。
 * 初始化失败会尽力删除半成品项目，避免项目管理中留下不可用空目录。
 */
import {
  createCreativeProject,
  deleteCreativeProject,
  getCreativeProject,
  updateCreativeProjectDraft,
} from '@/api/business'
import {
  isDraftConflictError,
  isRetryableDraftSaveError,
  waitForDraftSaveRetry,
} from '@/utils/creativeDraftPersistence'
import { resolveCreativeProjectId } from '@/utils/projectAssetAccess'

/** 创建并初始化空项目文件夹所需参数。 */
interface CreateInitializedProjectFolderOptions {
  workspaceId: number
  title: string
}

/** 兼容不同项目接口字段的通用记录。 */
type ProjectRecord = Record<string, any>

/** 将未知响应收敛为普通项目记录。 */
const asRecord = (value: unknown): ProjectRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as ProjectRecord) : {}

/** 从项目响应的兼容字段中读取草稿修订号。 */
const resolveDraftRevision = (value: unknown): number => {
  const project = asRecord(value)
  const data = asRecord(project.data)
  const revision = Number(project.draft_revision ?? project.draftRevision ?? data.draft_revision ?? data.draftRevision)
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0
}

/**
 * 项目列表会隐藏修订号为 0 的记录，因此新目录需先写一次中性空草稿才能跨刷新保留。
 * 空草稿不设置 flow，使首次创作仍可选择智能成片或爆款复制。
 */
export const createEmptyProjectFolderDraft = () => ({
  projectVideoStore: {
    records: [],
    overrides: {},
  },
})

/** 项目目录初始化失败时携带已创建项目 ID 的错误。 */
export class CreativeProjectInitializationError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super('项目初始化失败，请重试')
    this.name = 'CreativeProjectInitializationError'
    this.cause = cause
  }
}

/** 创建项目并写入空草稿，确保返回的目录可立即进入后续流程。 */
export async function createInitializedProjectFolder({
  workspaceId,
  title,
}: CreateInitializedProjectFolderOptions): Promise<ProjectRecord> {
  const wsId = Math.floor(Number(workspaceId) || 0)
  const projectTitle = String(title || '').trim()
  const created = asRecord(await createCreativeProject({ workspace_id: wsId, title: projectTitle }))
  const projectId = resolveCreativeProjectId(created)
  if (!projectId) throw new CreativeProjectInitializationError(new Error('服务端未返回有效项目 ID'))

  let latest: ProjectRecord = created
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const initialized = asRecord(
        await updateCreativeProjectDraft({
          projectId,
          workspaceId: wsId,
          draft: createEmptyProjectFolderDraft(),
          draftRevision: resolveDraftRevision(latest),
        }),
      )
      return { ...created, ...initialized, id: projectId, title: initialized.title || created.title || projectTitle }
    } catch (error) {
      lastError = error
      const conflict = isDraftConflictError(error)
      const retryable = isRetryableDraftSaveError(error)
      if ((!conflict && !retryable) || attempt >= 2) break
      if (retryable && !conflict) await waitForDraftSaveRetry(attempt)
      try {
        latest = asRecord(await getCreativeProject({ projectId, workspaceId: wsId }))
      } catch (refreshError) {
        lastError = refreshError
        break
      }
    }
  }

  // Treat POST + initial draft PUT as one user operation. Best-effort rollback
  // prevents an invisible revision-0 row from accumulating after a failed init.
  await deleteCreativeProject({ projectId, workspaceId: wsId }).catch(() => undefined)
  throw new CreativeProjectInitializationError(lastError)
}
