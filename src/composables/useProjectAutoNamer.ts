/**
 * useProjectAutoNamer — AI 自动给项目命名(智能成片 / 爆款复制共用)。
 * 抽自两视图各自一份的 autoNameProject + naming/nameAbortRef 状态(逻辑重复、行为略有漂移)。
 *
 * 行为契约(对齐原智能成片实现,为两端的并集):
 *  - 用户已手动改过名(nameTouched)或正在命名(naming)→ 跳过(防并发覆盖);
 *  - 有文本 req → generateProjectName;否则有图 → generateProjectNameFromImages;两者皆空 → 跳过;
 *  - 每次重新发起前 abort 上一个在途请求;命名失败(含 AbortError)静默保留原名;
 *  - 仅在仍未被手动改名时回填(再次判 nameTouched,避免 await 期间用户改了名被覆盖)。
 *
 * 注:nameTouched / setProjectName 仍是视图状态(别处也在用),按渲染传入;autoName 每次渲染重建,
 *     闭包捕获当次的 nameTouched —— 与原视图内实现一致。
 */
import { useRef, useState } from 'react'
import { generateProjectName, generateProjectNameFromImages } from '@/api/aiPolish'

export function useProjectAutoNamer(nameTouched: boolean, setProjectName: (name: string) => void) {
  const [naming, setNaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const autoName = async (req: string, images?: string[]) => {
    const r = (req || '').trim()
    const imgs = (images || []).filter(Boolean)
    if (nameTouched || naming) return
    if (!r && !imgs.length) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setNaming(true)
    try {
      const nm = r
        ? await generateProjectName(r, ctrl.signal)
        : await generateProjectNameFromImages(imgs, '', ctrl.signal)
      if (nm && !nameTouched) setProjectName(nm)
    } catch {
      /* 命名失败(含 AbortError)保留原名 */
    } finally {
      setNaming(false)
    }
  }

  return { naming, autoName }
}
