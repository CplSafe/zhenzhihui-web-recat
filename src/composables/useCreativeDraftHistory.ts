/**
 * Composable: 创意项目「草稿历史」功能簇。
 * 从 CreativeScriptView 原样抽出，行为保持完全一致（并发守卫、错误 toast、
 * 确认弹窗、删除当前项目后跳转 /creative/blank 等均不变）。
 *
 * 沿用项目的 deps 注入模式（同 useScriptPrompts / useStoryboardGeneration）：
 * hook 接收一个 deps 对象，内部持有自己的 state，return state+handlers 供组件与
 * <CreativeDraftHistoryDrawer/> 使用。
 *
 * 交叉依赖一律由组件实现并通过 deps 传入：getWorkspaceId / getProjectId / navigate /
 * allWorkspacesRef / loadWorkspaces / switchWorkspace / showToast / requestConfirm。
 */
import { useRef, useState } from 'react'
import { useStateRef } from '@/composables/useStateRef'
import {
  listCreativeProjects,
  deleteCreativeProject,
  getBusinessErrorMessage,
} from '@/api/business'

interface CreativeDraftHistoryDeps {
  getWorkspaceId: () => number
  getProjectId: () => number
  allWorkspacesRef: { current: any[] }
  loadWorkspaces: () => Promise<any> | any
  switchWorkspace: (id: number) => void
  navigate: (to: string, options?: any) => void
  showToast: (...args: any[]) => any
  requestConfirm: (...args: any[]) => any
}

export function useCreativeDraftHistory(deps: CreativeDraftHistoryDeps) {
  const {
    getWorkspaceId,
    getProjectId,
    allWorkspacesRef,
    loadWorkspaces,
    switchWorkspace,
    navigate,
    showToast,
    requestConfirm,
  } = deps

  // showToast 引用恒定，存入 ref 供回调使用
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast

  // ── 草稿历史 state ──
  const [draftHistoryOpen, setDraftHistoryOpen] = useState(false)
  const [draftHistoryLoading, setDraftHistoryLoading, draftHistoryLoadingRef] = useStateRef(false)
  const [draftHistoryProjects, setDraftHistoryProjects] = useState<any[]>([])
  const [isDeletingDraftProject, setIsDeletingDraftProject, isDeletingDraftProjectRef] = useStateRef(false)

  async function loadDraftHistoryProjects({ silent = false }: { silent?: boolean } = {}) {
    if (draftHistoryLoadingRef.current) return
    let workspaceList = Array.isArray(allWorkspacesRef.current) ? allWorkspacesRef.current : []
    let ids = workspaceList.length ? workspaceList.map((w: any) => Number(w?.id || 0)).filter((id: number) => id > 0) : []
    let uniqueIds = [...new Set(ids)]

    if (!uniqueIds.length && typeof loadWorkspaces === 'function') {
      await loadWorkspaces()
      workspaceList = Array.isArray(allWorkspacesRef.current) ? allWorkspacesRef.current : []
      ids = workspaceList.length ? workspaceList.map((w: any) => Number(w?.id || 0)).filter((id: number) => id > 0) : []
      uniqueIds = [...new Set(ids)]
    }

    if (!uniqueIds.length && !getWorkspaceId()) {
      if (!silent) showToastRef.current('workspace_id 缺失，无法加载历史草稿', 'error')
      return
    }

    setDraftHistoryLoading(true)
    try {
      const tasks = (uniqueIds.length ? uniqueIds : [getWorkspaceId()]).map((id: number) =>
        listCreativeProjects({ workspaceId: id, limit: 50 }).then((items: any) => ({ id, items })),
      )
      const settled = await Promise.allSettled(tasks)
      const merged: any[] = []
      settled.forEach((res: any) => {
        if (res.status !== 'fulfilled') return
        const wsId = Number(res.value?.id || 0)
        const items = Array.isArray(res.value?.items) ? res.value.items : []
        const ws = workspaceList.find((w: any) => Number(w?.id || 0) === wsId)
        items.forEach((item: any) => {
          if (!item || typeof item !== 'object') return
          merged.push({
            ...item,
            workspaceId: wsId,
            workspaceName: ws?.name || '',
          })
        })
      })
      merged.sort((a: any, b: any) => {
        const at = new Date(a?.updated_at || a?.updatedAt || a?.created_at || a?.createdAt || 0).getTime()
        const bt = new Date(b?.updated_at || b?.updatedAt || b?.created_at || b?.createdAt || 0).getTime()
        if (Number.isFinite(at) && Number.isFinite(bt) && (at || bt)) return bt - at
        return Number(b?.id || 0) - Number(a?.id || 0)
      })
      setDraftHistoryProjects(merged)
    } catch (error) {
      if (!silent) showToastRef.current(getBusinessErrorMessage(error, '历史草稿加载失败，请稍后重试'), 'error')
    } finally {
      setDraftHistoryLoading(false)
    }
  }

  function openDraftHistory() {
    setDraftHistoryOpen(true)
    loadDraftHistoryProjects({ silent: false })
  }

  function continueFromDraftProject(item: any) {
    const id = Number(item?.id || 0)
    const wsId = Number(item?.workspaceId || 0)
    if (!id) return
    setDraftHistoryOpen(false)
    if (wsId && wsId !== getWorkspaceId()) {
      switchWorkspace(wsId)
    }
    navigate(`/creative/${id}`)
  }

  async function deleteDraftProject(item: any) {
    if (isDeletingDraftProjectRef.current) return
    const id = Number(item?.id || 0)
    const wsId = Number(item?.workspaceId || 0)
    if (!id) return
    if (!wsId) {
      showToastRef.current('workspace_id 缺失，无法删除草稿', 'error')
      return
    }
    const title = String(item?.name || item?.title || `项目 #${id}`).trim()
    const confirmed = await requestConfirm(`确定删除「${title}」吗？删除后不可恢复。`, { danger: true })
    if (!confirmed) return
    setIsDeletingDraftProject(true)
    try {
      await deleteCreativeProject({ projectId: id, workspaceId: wsId })
      if (getProjectId() && id === getProjectId()) {
        navigate('/creative/blank', { replace: true })
      }
      await loadDraftHistoryProjects({ silent: true })
      showToastRef.current('历史草稿已删除', 'success')
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '历史草稿删除失败，请稍后重试'), 'error')
    } finally {
      setIsDeletingDraftProject(false)
    }
  }

  async function deleteDraftProjects(items: any) {
    if (isDeletingDraftProjectRef.current) return
    const list = Array.isArray(items) ? items : []
    const normalized = list
      .map((item: any) => ({
        projectId: Number(item?.id || 0),
        workspaceId: Number(item?.workspaceId || 0),
        title: String(item?.name || item?.title || '').trim(),
      }))
      .filter((row: any) => row.projectId > 0 && row.workspaceId > 0)
    if (!normalized.length) return

    const confirmed = await requestConfirm(`确定批量删除 ${normalized.length} 个草稿吗？删除后不可恢复。`, {
      danger: true,
    })
    if (!confirmed) return

    setIsDeletingDraftProject(true)
    try {
      const tasks = normalized.map((row: any) =>
        deleteCreativeProject({ projectId: row.projectId, workspaceId: row.workspaceId }).then(
          () => ({ ok: true, row }),
          (error: any) => ({ ok: false, row, error }),
        ),
      )
      const settled = await Promise.all(tasks)
      const okCount = settled.filter((res: any) => res.ok).length
      const failCount = settled.length - okCount

      if (getProjectId() && normalized.some((row: any) => row.projectId === getProjectId())) {
        navigate('/creative/blank', { replace: true })
      }

      await loadDraftHistoryProjects({ silent: true })

      if (!failCount) {
        showToastRef.current(`已删除 ${okCount} 个草稿`, 'success')
      } else {
        showToastRef.current(`已删除 ${okCount} 个，失败 ${failCount} 个`, 'error')
      }
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '批量删除失败，请稍后重试'), 'error')
    } finally {
      setIsDeletingDraftProject(false)
    }
  }

  return {
    // state
    draftHistoryOpen,
    setDraftHistoryOpen,
    draftHistoryLoading,
    draftHistoryProjects,
    isDeletingDraftProject,
    // handlers
    openDraftHistory,
    continueFromDraftProject,
    deleteDraftProject,
    deleteDraftProjects,
  }
}
