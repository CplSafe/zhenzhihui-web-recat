/** Coalesce remote-change notifications without cancelling or overlapping an in-flight read. */
export function createCanvasPullLoop(pull: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let running = false
  let wakePending = false
  const schedule = (delay: number) => {
    clearTimeout(timer)
    if (disposed) return
    timer = setTimeout(async () => {
      if (disposed) return
      if (running) { wakePending = true; return }
      running = true
      try { await pull() } finally {
        running = false
        if (wakePending && !disposed) { wakePending = false; schedule(0) }
      }
    }, delay)
  }
  return {
    schedule,
    wake() {
      if (disposed) return
      if (running) wakePending = true
      else schedule(0)
    },
    dispose() { disposed = true; clearTimeout(timer) },
  }
}
