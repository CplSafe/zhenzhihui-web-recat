/**
 * 整片视频生成「全局在途登记表」—— 让生成真正脱离组件,切到别的页面也继续。
 *
 * 背景:整片生成是 server 端任务,前端 await 轮询。这个 await 链卸载后并不会停(JS promise 不随组件卸载中断),
 * 但「这次生成的结果 promise」原本只被那个组件局部持有 —— 组件卸载后没人持有它,
 * 重新进来的新组件不知道「同项目已有一次生成在跑」,于是:
 *   ① 自动生成 effect 误判「没视频」→ 再发起一次(重复出片、重复计费);
 *   ② UI 也接不上正在跑的那次。
 *
 * 把这个结果 promise 按 projectId 存到模块级登记表(活在组件之外),就能:
 *   - 重新进来先查「该项目是否已在生成」→ 是则【订阅同一个 promise】拿结果,不重启;
 *   - 真正实现「切走 / 在别的页面也继续加载」。
 */
export type VideoGenResult = { url: string; assetId: number }

const running = new Map<number, Promise<VideoGenResult>>()

/** 该项目当前是否有在途整片生成 */
export function isVideoGenRunning(projectId: number): boolean {
  return Number(projectId) > 0 && running.has(Number(projectId))
}

/** 取该项目在途生成的结果 promise(无则 null);可 await 拿 { url, assetId } */
export function getRunningVideoGen(projectId: number): Promise<VideoGenResult> | null {
  return running.get(Number(projectId)) || null
}

/**
 * 登记一次在途生成:把结果 promise 按 projectId 存下,完成/失败后自动摘除。
 * projectId 无效(0)时不登记,直接返回原 promise(退化为旧行为,不影响功能)。
 */
export function trackVideoGen(projectId: number, p: Promise<VideoGenResult>): Promise<VideoGenResult> {
  const pid = Number(projectId)
  if (!(pid > 0)) return p
  running.set(pid, p)
  void p
    .catch(() => {
      /* 失败也要摘除,避免卡住后续重试 */
    })
    .finally(() => {
      if (running.get(pid) === p) running.delete(pid)
    })
  return p
}
