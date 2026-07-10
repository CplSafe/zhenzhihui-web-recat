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

/**
 * 等待同一项目当前已经排队的草稿写入完成。
 *
 * 路由切换时，旧页面会在卸载阶段把最后一份状态加入保存队列；新页面读取项目之前先等待
 * 这条队列，可以避免“旧页面正在 PUT，新页面先 GET 到旧草稿”的读写竞态。
 */
export async function waitForCreativeProjectDraftSaves(args: {
  projectId: number
  workspaceId: number
}): Promise<void> {
  const projectId = Math.floor(Number(args.projectId) || 0)
  const workspaceId = Math.floor(Number(args.workspaceId) || 0)
  if (!projectId || !workspaceId) return

  const key = queueKeyOf(projectId, workspaceId)
  while (true) {
    const pending = draftSaveQueues.get(key)
    if (!pending) return
    await pending.catch(() => undefined)
  }
}
