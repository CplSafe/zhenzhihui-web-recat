const draftSaveQueues = new Map<string, Promise<unknown>>()

const queueKeyOf = (projectId: number, workspaceId: number) =>
  `${Math.floor(Number(workspaceId) || 0)}:${Math.floor(Number(projectId) || 0)}`

/**
 * 同一工作空间下的同一项目草稿保存必须串行执行。
 * 否则多个独立保存链路(自动保存 / 生成完成落库 / 卸载 flush)会拿同一个 draft_revision 并发 PUT,
 * 导致后端返回 409 DRAFT_CONFLICT。
 */
export function enqueueCreativeProjectDraftSave<T>(args: {
  projectId: number
  workspaceId: number
  task: () => Promise<T>
}): Promise<T> {
  const projectId = Math.floor(Number(args.projectId) || 0)
  const workspaceId = Math.floor(Number(args.workspaceId) || 0)
  if (!projectId || !workspaceId) return args.task()

  const key = queueKeyOf(projectId, workspaceId)
  const previous = draftSaveQueues.get(key) || Promise.resolve()
  const run = previous.catch(() => undefined).then(args.task)
  const tracked = run.finally(() => {
    if (draftSaveQueues.get(key) === tracked) draftSaveQueues.delete(key)
  })
  draftSaveQueues.set(key, tracked)
  return run
}
