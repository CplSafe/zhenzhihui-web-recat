/**
 * Composable: 创意项目「标题同步」功能簇。
 * 从 CreativeScriptView 原样抽出，行为保持完全一致（防抖定时器、首次填充判定、
 * 「未命名」标题判定、serverProjectTitle 与 projectTitleSynced 守卫均不变）。
 *
 * 沿用项目的 deps 注入模式（同 useCreativeVersions）：hook 接收一个 deps 对象，
 * 内部持有自己的 state（serverProjectTitle / projectTitleSyncedRef /
 * projectTitleSyncTimerRef），return state+refs+handlers 供组件与
 * <CreativeTopbar/> / <CreativeHeroTitle/> 等使用。
 *
 * 交叉依赖（与持久化/草稿加载共用的函数）由组件实现并通过 deps 传入：
 * resolveProjectWorkspaceId。serverProjectTitle / projectTitleSynced /
 * projectTitleSyncTimer 会被留在组件的持久化代码（handleSaveDraft /
 * loadProjectDraftMeta / watch(projectId) / 卸载清理）读写，因此对应 setter/ref
 * 一并 return，保证留在组件的代码照常工作。
 *
 * 注意：项目封面草稿同步（resolveStoryboardCoverState / scheduleProjectCoverDraftSync /
 * syncProjectCoverDraftSilently 等）与生成结果（首帧/分镜图）及 buildDraftSnapshot /
 * putDraftSnapshot 持久化管道耦合较深，保守保留在组件，未抽入本 hook。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { patchCreativeProject } from '@/api/business'

interface CreativeProjectTitleDeps {
  getProjectId: () => number
  /** 当前描述文本（用于 projectTitle 派生 + watch(description) 触发） */
  description: string
  isBlankModeRef: { current: boolean }
  restoringWorkflowFromStorageRef: { current: boolean }
  resolveProjectWorkspaceId: (opts?: { silent?: boolean }) => Promise<number>
  showToast: (...args: any[]) => any
}

export function useCreativeProjectTitle(deps: CreativeProjectTitleDeps) {
  const {
    getProjectId,
    description,
    isBlankModeRef,
    restoringWorkflowFromStorageRef,
    resolveProjectWorkspaceId,
    showToast,
  } = deps

  // showToast 引用恒定，存入 ref 供回调使用
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast

  // ── 标题同步 state / ref / timer ──
  const serverProjectTitleRef = useRef('')
  const [serverProjectTitle, setServerProjectTitleState] = useState('')
  const setServerProjectTitle = (v: string) => {
    serverProjectTitleRef.current = v
    setServerProjectTitleState(v)
  }
  const projectTitleSyncedRef = useRef(false)
  const projectTitleSyncTimerRef = useRef<ReturnType<typeof setTimeout> | 0>(0)

  // ── 标题派生 ──
  const projectTitle = useMemo(() => {
    const desc = (description || '').trim()
    if (!desc) return '当前创意项目'
    return desc.length > 24 ? desc.slice(0, 24) + '…' : desc
  }, [description])

  const displayProjectName = useMemo(() => {
    const serverTitle = String(serverProjectTitle || '').trim()
    if (serverTitle) return serverTitle
    const draftTitle = String(projectTitle || '').trim()
    if (draftTitle) return draftTitle
    return '未命名项目'
  }, [serverProjectTitle, projectTitle])

  // ── 标题专用 helper ──
  function normalizeProjectTitle(payload: any): string {
    const candidates = [payload?.title, payload?.name, payload?.project_name, payload?.projectName]
    const picked = candidates.find((value) => typeof value === 'string' && value.trim())
    return String(picked || '').trim()
  }

  function isUnnamedProjectTitle(title: any): boolean {
    const t = String(title || '').trim()
    if (!t) return true
    return t.includes('未命名')
  }

  function deriveProjectTitleFromDescription(text: any): string {
    const raw = String(text || '').trim()
    if (!raw) return ''
    const firstLine =
      raw
        .split('\n')
        .map((s) => s.trim())
        .find(Boolean) || ''
    if (!firstLine) return ''
    return firstLine.length > 32 ? firstLine.slice(0, 32) : firstLine
  }

  async function syncProjectTitleByDescription(text: any) {
    if (projectTitleSyncedRef.current) return
    if (isBlankModeRef.current) return
    if (!getProjectId()) return

    const title = deriveProjectTitleFromDescription(text)
    if (!title) return
    if (!isUnnamedProjectTitle(serverProjectTitleRef.current)) {
      projectTitleSyncedRef.current = true
      return
    }

    const wsId = await resolveProjectWorkspaceId({ silent: true })
    if (!wsId) return

    try {
      const payload = await patchCreativeProject({ projectId: getProjectId(), workspaceId: wsId, title })
      setServerProjectTitle(normalizeProjectTitle(payload) || title)
      projectTitleSyncedRef.current = true
    } catch {
      projectTitleSyncedRef.current = true
    }
  }

  // ── 手动重命名（顶部项目名编辑按钮）──
  async function renameProject(rawName: string): Promise<boolean> {
    const name = String(rawName || '').trim()
    if (!name) {
      showToastRef.current('项目名称不能为空', 'error')
      return false
    }
    if (name === String(serverProjectTitleRef.current || '').trim()) return true // 未改动
    if (!getProjectId()) {
      showToastRef.current('缺少项目 ID，无法重命名', 'error')
      return false
    }
    const wsId = await resolveProjectWorkspaceId({ silent: true })
    if (!wsId) {
      showToastRef.current('workspace_id 缺失，无法重命名', 'error')
      return false
    }
    try {
      const payload = await patchCreativeProject({ projectId: getProjectId(), workspaceId: wsId, title: name })
      setServerProjectTitle(normalizeProjectTitle(payload) || name)
      // 手动命名后置位，避免随后被「按描述自动同步」覆盖。
      projectTitleSyncedRef.current = true
      showToastRef.current('项目已重命名', 'success')
      return true
    } catch {
      showToastRef.current('重命名失败，请稍后重试', 'error')
      return false
    }
  }

  // ── watch(description) → 自动同步项目标题 ──
  const prevDescriptionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const next = description
    const prev = prevDescriptionRef.current
    prevDescriptionRef.current = next
    if (prev === undefined) return // 跳过初始挂载
    if (isBlankModeRef.current) return
    if (!getProjectId()) return
    if (restoringWorkflowFromStorageRef.current) return
    if (projectTitleSyncedRef.current) return
    if (!isUnnamedProjectTitle(serverProjectTitleRef.current)) {
      projectTitleSyncedRef.current = true
      return
    }

    const nextText = String(next || '').trim()
    if (!nextText) return

    if (projectTitleSyncTimerRef.current) clearTimeout(projectTitleSyncTimerRef.current)
    const shouldTreatAsFirstFill = !String(prev || '').trim()
    if (!shouldTreatAsFirstFill && serverProjectTitleRef.current) return
    projectTitleSyncTimerRef.current = setTimeout(() => {
      syncProjectTitleByDescription(nextText)
    }, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description])

  // ── 卸载时清理标题同步定时器 ──
  useEffect(() => {
    return () => {
      if (projectTitleSyncTimerRef.current) {
        clearTimeout(projectTitleSyncTimerRef.current)
        projectTitleSyncTimerRef.current = 0
      }
    }
  }, [])

  return {
    // state
    serverProjectTitle,
    projectTitle,
    displayProjectName,
    // refs / setter（供留在组件的持久化代码读写）
    serverProjectTitleRef,
    setServerProjectTitle,
    projectTitleSyncedRef,
    projectTitleSyncTimerRef,
    // handlers
    normalizeProjectTitle,
    isUnnamedProjectTitle,
    deriveProjectTitleFromDescription,
    syncProjectTitleByDescription,
    renameProject,
  }
}
