/**
 * Composable: 创意项目「版本历史」功能簇。
 * 从 CreativeScriptView 原样抽出，行为保持完全一致（并发 token 守卫、错误 toast、
 * 确认弹窗、恢复版本后 applyWorkflowSnapshot 的调用时机均不变）。
 *
 * 沿用项目的 deps 注入模式（同 useScriptPrompts / useStoryboardGeneration）：
 * hook 接收一个 deps 对象，内部持有自己的 state，return state+handlers 供组件与
 * <CreativeVersionHistoryDrawer/> 使用。
 *
 * 交叉依赖（与生成主管道 / 草稿历史共用的函数）一律由组件实现并通过 deps 传入，
 * hook 内不重复实现：resolveProjectWorkspaceId / resolveWorkspaceIdForProject /
 * applyWorkflowSnapshot / loadProjectDraftMeta / persistWorkflowSnapshot /
 * buildDraftSnapshot / putDraftSnapshot / isDraftSnapshotEmpty /
 * normalizeCreativeProjectDraft / normalizeCreativeProjectDraftRevision /
 * closeDraftHistory（关闭草稿历史抽屉）等。
 */
import { useRef, useState } from 'react'
import { useStateRef } from '@/composables/useStateRef'
import {
  getCreativeProjectVersion,
  listCreativeProjectVersions,
  createCreativeProjectVersion,
  deleteCreativeProjectVersion,
  restoreCreativeProjectVersion,
  getBusinessErrorMessage,
} from '@/api/business'

interface CreativeVersionsDeps {
  getProjectId: () => number
  getWorkspaceId: () => number
  draftRevisionRef: { current: number }
  resolveProjectWorkspaceId: (opts?: { silent?: boolean }) => Promise<number>
  resolveWorkspaceIdForProject: (
    targetProjectId: any,
    opts?: { silent?: boolean; preferredWorkspaceId?: number },
  ) => Promise<number>
  applyWorkflowSnapshot: (snapshot: any) => void
  loadProjectDraftMeta: (opts?: { silent?: boolean; apply?: boolean }) => Promise<any>
  persistWorkflowSnapshot: () => void
  buildDraftSnapshot: () => any
  putDraftSnapshot: (snapshot: any, opts?: { silent?: boolean; confirmOnConflict?: boolean }) => Promise<boolean>
  isDraftSnapshotEmpty: (snapshot: any) => boolean
  normalizeCreativeProjectDraft: (payload: any) => any
  normalizeCreativeProjectDraftRevision: (payload: any) => number
  isBlankMode: () => boolean
  switchWorkspace: (id: number) => void
  navigate: (to: string) => void
  closeDraftHistory: () => void
  showToast: (...args: any[]) => any
  requestConfirm: (...args: any[]) => any
}

export function useCreativeVersions(deps: CreativeVersionsDeps) {
  const {
    getProjectId,
    getWorkspaceId,
    draftRevisionRef,
    resolveProjectWorkspaceId,
    resolveWorkspaceIdForProject,
    applyWorkflowSnapshot,
    loadProjectDraftMeta,
    persistWorkflowSnapshot,
    buildDraftSnapshot,
    putDraftSnapshot,
    isDraftSnapshotEmpty,
    normalizeCreativeProjectDraft,
    normalizeCreativeProjectDraftRevision,
    isBlankMode,
    switchWorkspace,
    navigate,
    closeDraftHistory,
    showToast,
    requestConfirm,
  } = deps

  // showToast 引用恒定，存入 ref 供回调使用
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast

  // ── 版本历史 state ──
  const [versionDrawerOpen, setVersionDrawerOpen, versionDrawerOpenRef] = useStateRef(false)
  const [isLoadingVersions, setIsLoadingVersions, isLoadingVersionsRef] = useStateRef(false)
  const [isSavingVersion, setIsSavingVersion, isSavingVersionRef] = useStateRef(false)
  const [isDeletingVersion, setIsDeletingVersion, isDeletingVersionRef] = useStateRef(false)
  const [isRestoringVersion, setIsRestoringVersion, isRestoringVersionRef] = useStateRef(false)
  const [isLoadingVersionDetail, setIsLoadingVersionDetail] = useState(false)
  const [versionHistoryList, setVersionHistoryList] = useState<any[]>([])
  const [selectedVersionId, setSelectedVersionId, selectedVersionIdRef] = useStateRef(0)
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<any>(null)
  const versionTargetProjectIdRef = useRef(0)
  const [versionTargetProjectId, setVersionTargetProjectIdState] = useState(0)
  const setVersionTargetProjectId = (v: number) => {
    versionTargetProjectIdRef.current = v
    setVersionTargetProjectIdState(v)
  }
  const versionTargetWorkspaceIdRef = useRef(0)
  const setVersionTargetWorkspaceId = (v: number) => {
    versionTargetWorkspaceIdRef.current = v
  }
  const versionDetailRequestTokenRef = useRef(0)

  // ── 版本专用小 helper ──
  function normalizeJsonPayload(value: any): any {
    if (!value) return null
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    }
    if (typeof value === 'object') return value
    return null
  }

  function normalizeCreativeProjectVersions(payload: any): any[] {
    const raw = normalizeJsonPayload(payload) ?? payload
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(raw?.list)
          ? raw.list
          : Array.isArray(raw?.versions)
            ? raw.versions
            : []
    return list.filter((item: any) => item && typeof item === 'object')
  }

  function normalizeCreativeProjectVersionDetail(payload: any, fallback: any = null) {
    const raw = normalizeJsonPayload(payload) ?? payload
    const version =
      (raw?.version && typeof raw.version === 'object'
        ? raw.version
        : raw?.data?.version && typeof raw.data.version === 'object'
          ? raw.data.version
          : raw?.data && typeof raw.data === 'object'
            ? raw.data
            : raw && typeof raw === 'object'
              ? raw
              : {}) || {}

    const draft =
      normalizeCreativeProjectDraft(version) ||
      normalizeCreativeProjectDraft(raw) ||
      normalizeJsonPayload(version?.snapshot_json) ||
      normalizeJsonPayload(version?.snapshotJson) ||
      normalizeJsonPayload(version?.snapshot) ||
      null

    return {
      version: {
        ...(fallback && typeof fallback === 'object' ? fallback : {}),
        ...version,
      },
      draft: draft && typeof draft === 'object' ? draft : null,
      raw,
    }
  }

  function resolveVersionId(item: any): number {
    return Number(item?.vid || item?.version_id || item?.versionId || item?.id || item?.version_no || 0)
  }

  function resolveVersionLabel(item: any): string {
    return String(item?.label || item?.name || item?.title || '').trim()
  }

  async function loadCreativeProjectVersions({ silent = false }: { silent?: boolean } = {}) {
    const pid = Number(versionTargetProjectIdRef.current || getProjectId() || 0)
    if (!pid) {
      if (!silent) showToastRef.current('缺少项目 ID，无法加载历史记录', 'error')
      return
    }
    if (isLoadingVersionsRef.current) return
    setIsLoadingVersions(true)
    try {
      const wsId = await resolveWorkspaceIdForProject(pid, {
        silent: true,
        preferredWorkspaceId: versionTargetWorkspaceIdRef.current,
      })
      if (!wsId) {
        if (!silent) showToastRef.current('workspace_id 缺失，无法加载历史记录', 'error')
        return
      }
      const payload = await listCreativeProjectVersions({
        projectId: pid,
        workspaceId: wsId,
      })
      const list = normalizeCreativeProjectVersions(payload)
      const sorted = list.slice().sort((a: any, b: any) => {
        const ano = Number(a?.version_no || a?.versionNo || 0)
        const bno = Number(b?.version_no || b?.versionNo || 0)
        if (Number.isFinite(ano) && Number.isFinite(bno) && (ano || bno)) {
          return bno - ano
        }
        const at = new Date(a?.created_at || a?.createdAt || 0).getTime()
        const bt = new Date(b?.created_at || b?.createdAt || 0).getTime()
        if (Number.isFinite(at) && Number.isFinite(bt) && (at || bt)) return bt - at
        return resolveVersionId(b) - resolveVersionId(a)
      })
      setVersionHistoryList(sorted)
      const currentSelected = Number(selectedVersionIdRef.current || 0)
      const nextSelected = sorted.find((item: any) => resolveVersionId(item) === currentSelected) || sorted[0] || null
      if (nextSelected) {
        await loadCreativeProjectVersionDetail(nextSelected, { silent: true })
      } else {
        setSelectedVersionId(0)
        setSelectedVersionDetail(null)
        setIsLoadingVersionDetail(false)
      }
    } catch (error) {
      if (!silent) showToastRef.current(getBusinessErrorMessage(error, '历史记录加载失败，请稍后重试'), 'error')
    } finally {
      setIsLoadingVersions(false)
    }
  }

  async function loadCreativeProjectVersionDetail(item: any, { silent = false }: { silent?: boolean } = {}) {
    const pid = Number(versionTargetProjectIdRef.current || getProjectId() || 0)
    const vid = resolveVersionId(item)
    if (!pid || !vid) {
      if (!silent) showToastRef.current('版本 ID 无效，无法加载版本详情', 'error')
      return
    }

    const wsId = await resolveWorkspaceIdForProject(pid, {
      silent: true,
      preferredWorkspaceId: versionTargetWorkspaceIdRef.current,
    })
    if (!wsId) {
      if (!silent) showToastRef.current('workspace_id 缺失，无法加载版本详情', 'error')
      return
    }

    const requestToken = ++versionDetailRequestTokenRef.current
    setSelectedVersionId(vid)
    setIsLoadingVersionDetail(true)

    try {
      const payload = await getCreativeProjectVersion({
        projectId: pid,
        workspaceId: wsId,
        vid,
      })
      if (requestToken !== versionDetailRequestTokenRef.current) return
      setSelectedVersionDetail(normalizeCreativeProjectVersionDetail(payload, item))
    } catch (error) {
      if (requestToken !== versionDetailRequestTokenRef.current) return
      setSelectedVersionDetail(normalizeCreativeProjectVersionDetail(item, item))
      if (!silent) showToastRef.current(getBusinessErrorMessage(error, '版本详情加载失败，请稍后重试'), 'error')
    } finally {
      if (requestToken === versionDetailRequestTokenRef.current) {
        setIsLoadingVersionDetail(false)
      }
    }
  }

  function openVersionHistoryForDraft(item: any) {
    const pid = Number(item?.id || 0)
    const wsId = Number(item?.workspaceId || 0)
    if (!pid) return
    closeDraftHistory()
    setVersionTargetProjectId(pid)
    setVersionTargetWorkspaceId(wsId)
    setVersionDrawerOpen(true)
    setSelectedVersionId(0)
    setSelectedVersionDetail(null)
    loadCreativeProjectVersions()
  }

  function closeVersionHistoryDrawer() {
    setVersionDrawerOpen(false)
    versionDetailRequestTokenRef.current += 1
    setSelectedVersionId(0)
    setSelectedVersionDetail(null)
    setIsLoadingVersionDetail(false)
    setVersionTargetProjectId(0)
    setVersionTargetWorkspaceId(0)
  }

  async function saveCreativeProjectVersion({ label, silent = false }: any = {}): Promise<boolean> {
    if (isSavingVersionRef.current) return false
    if (!getProjectId()) {
      if (!silent) showToastRef.current('缺少项目 ID，无法保存版本', 'error')
      return false
    }
    const wsId = await resolveProjectWorkspaceId({ silent: true })
    if (!wsId) {
      if (!silent) showToastRef.current('workspace_id 缺失，无法保存版本', 'error')
      return false
    }
    const note = String(label || '').trim()
    if (!note) {
      if (!silent) showToastRef.current('请输入版本备注', 'error')
      return false
    }
    const snapshot = buildDraftSnapshot()
    if (isDraftSnapshotEmpty(snapshot)) {
      if (!silent) showToastRef.current('版本内容为空，无法保存', 'error')
      return false
    }

    setIsSavingVersion(true)
    try {
      const ok = await putDraftSnapshot(snapshot, { silent })
      if (!ok) return false
      await createCreativeProjectVersion({
        projectId: getProjectId(),
        workspaceId: wsId,
        label: note,
      })
      await loadCreativeProjectVersions({ silent: true })
      if (!silent) showToastRef.current('版本已保存', 'success')
      return true
    } catch (error) {
      if (!silent) showToastRef.current(getBusinessErrorMessage(error, '版本保存失败，请稍后重试'), 'error')
      return false
    } finally {
      setIsSavingVersion(false)
    }
  }

  async function deleteCreativeProjectVersionByItem(item: any) {
    if (isDeletingVersionRef.current) return
    const pid = Number(versionTargetProjectIdRef.current || getProjectId() || 0)
    if (!pid) {
      showToastRef.current('缺少项目 ID，无法删除历史记录', 'error')
      return
    }
    const wsId = await resolveWorkspaceIdForProject(pid, {
      silent: true,
      preferredWorkspaceId: versionTargetWorkspaceIdRef.current,
    })
    if (!wsId) {
      showToastRef.current('workspace_id 缺失，无法删除历史记录', 'error')
      return
    }
    const vid = resolveVersionId(item)
    if (!vid) {
      showToastRef.current('版本 ID 无效，无法删除', 'error')
      return
    }
    const label = resolveVersionLabel(item) || `版本 ${vid}`
    const confirmed = await requestConfirm(`确定删除「${label}」吗？删除后不可恢复。`, { danger: true })
    if (!confirmed) return
    setIsDeletingVersion(true)
    try {
      await deleteCreativeProjectVersion({
        projectId: pid,
        workspaceId: wsId,
        vid,
      })
      await loadCreativeProjectVersions({ silent: true })
      showToastRef.current('历史记录已删除', 'success')
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '历史记录删除失败，请稍后重试'), 'error')
    } finally {
      setIsDeletingVersion(false)
    }
  }

  async function restoreCreativeProjectVersionByItem(item: any) {
    if (isRestoringVersionRef.current) return
    const pid = Number(versionTargetProjectIdRef.current || getProjectId() || 0)
    const restoringFromDraft = Boolean(versionTargetProjectIdRef.current && pid !== getProjectId())
    if (!pid) {
      showToastRef.current('缺少项目 ID，无法恢复版本', 'error')
      return
    }
    const wsId = await resolveWorkspaceIdForProject(pid, {
      silent: true,
      preferredWorkspaceId: versionTargetWorkspaceIdRef.current,
    })
    if (!wsId) {
      showToastRef.current('workspace_id 缺失，无法恢复版本', 'error')
      return
    }
    const vid = resolveVersionId(item)
    if (!vid) {
      showToastRef.current('版本 ID 无效，无法恢复', 'error')
      return
    }

    const label = resolveVersionLabel(item) || `版本 ${vid}`
    const confirmed = await requestConfirm(`确定恢复到「${label}」吗？当前未保存的内容将丢失。`)
    if (!confirmed) return

    setIsRestoringVersion(true)
    try {
      await restoreCreativeProjectVersion({
        projectId: pid,
        workspaceId: wsId,
        vid,
      })
      setVersionDrawerOpen(false)
      if (restoringFromDraft || isBlankMode()) {
        if (wsId && wsId !== getWorkspaceId()) {
          switchWorkspace(wsId)
        }
        navigate(`/creative/${pid}`)
        showToastRef.current(`已恢复到「${label}」`, 'success')
        return
      }

      const meta = await loadProjectDraftMeta({ silent: true, apply: false })
      const restored = normalizeCreativeProjectDraft(meta?.project)
      if (!restored || !meta?.project) {
        throw new Error('未获取到草稿内容')
      }
      applyWorkflowSnapshot(restored)
      draftRevisionRef.current = normalizeCreativeProjectDraftRevision(meta.project)
      persistWorkflowSnapshot()
      showToastRef.current(`已恢复到「${label}」`, 'success')
    } catch (error) {
      showToastRef.current(getBusinessErrorMessage(error, '版本恢复失败，请稍后重试'), 'error')
    } finally {
      setIsRestoringVersion(false)
    }
  }

  return {
    // state
    versionDrawerOpen,
    versionDrawerOpenRef,
    isLoadingVersions,
    isSavingVersion,
    isDeletingVersion,
    isRestoringVersion,
    isLoadingVersionDetail,
    versionHistoryList,
    selectedVersionId,
    selectedVersionDetail,
    versionTargetProjectId,
    // handlers
    openVersionHistoryForDraft,
    closeVersionHistoryDrawer,
    loadCreativeProjectVersions,
    loadCreativeProjectVersionDetail,
    saveCreativeProjectVersion,
    restoreCreativeProjectVersionByItem,
    deleteCreativeProjectVersionByItem,
  }
}
