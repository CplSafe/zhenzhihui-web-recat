import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, LayoutGrid, RotateCw } from 'lucide-react'
import { fetchCanvasElements } from '@/api/canvasApi'
import {
  useCurrentUser,
  useWorkspaceId,
  useWorkspaceSessionStore,
  deriveAllWorkspaces,
  deriveWorkspaceId,
} from '@/stores/workspaceSession'
import { useUiStore } from '@/stores/ui'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { routeImporters } from './routePrefetch'
import styles from './CanvasAccessRoute.module.css'

const CanvasView = lazy(routeImporters.canvas)

function CanvasAccessNotice({
  message,
  description,
  onRetry,
}: {
  message: string
  description: string
  onRetry?: () => void
}) {
  const navigate = useNavigate()
  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <span className={styles.brand}>
          <LayoutGrid size={17} aria-hidden="true" />
          无限画布
        </span>
        <span className={styles.topbarLabel}>画布访问</span>
      </div>
      <section className={styles.content} role="alert">
        <div className={styles.canvasMark} aria-hidden="true">
          <span className={styles.canvasMarkLine} />
          <LayoutGrid size={30} strokeWidth={1.4} />
        </div>
        <h1 className={styles.title}>{message}</h1>
        <p className={styles.description}>{description}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => navigate('/canvas')}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回画布列表
          </button>
          {onRetry && (
            <button type="button" className={styles.secondary} onClick={onRetry}>
              <RotateCw size={15} aria-hidden="true" />
              重试
            </button>
          )}
        </div>
      </section>
    </main>
  )
}

function CanvasAccess({ canvasId, workspaceId, userId }: { canvasId: number; workspaceId: number; userId: number }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error' | 'ambiguous'>('loading')
  useEffect(() => {
    let cancelled = false
    const isCurrent = () =>
      !cancelled &&
      deriveWorkspaceId(useWorkspaceSessionStore.getState()) === workspaceId &&
      resolveUserId(useWorkspaceSessionStore.getState().authSession?.user) === userId
    const probe = (id: number) => fetchCanvasElements({ workspaceId: id, canvasId, limit: 1 })
    const isMissing = (error: any) => [403, 404].includes(Number(error?.status))
    setState('loading')
    void (async () => {
      try {
        await probe(workspaceId)
        if (isCurrent()) setState('ready')
        return
      } catch (error) {
        if (!isCurrent()) return
        if (!isMissing(error)) {
          setState('error')
          return
        }
      }
      const loaded = await useWorkspaceSessionStore.getState().loadWorkspaces()
      if (!isCurrent()) return
      if (!loaded) {
        setState('error')
        return
      }
      const candidates = [
        ...new Set(
          deriveAllWorkspaces(useWorkspaceSessionStore.getState())
            .map((workspace) => Number(workspace?.id || 0))
            .filter((id) => Number.isSafeInteger(id) && id > 0 && id !== workspaceId),
        ),
      ]
      let incomplete = false
      const matches: number[] = []
      for (const candidate of candidates) {
        try {
          await probe(candidate)
          if (!isCurrent()) return
          matches.push(candidate)
        } catch (error) {
          if (!isCurrent()) return
          if (!isMissing(error)) incomplete = true
        }
      }
      if (!isCurrent()) return
      if (incomplete) {
        setState('error')
        return
      }
      if (matches.length > 1) {
        setState('ambiguous')
        return
      }
      if (!matches.length) {
        setState('missing')
        return
      }
      if (useUiStore.getState().workspaceSwitchLocked) {
        setState('error')
        return
      }
      // 此路由在校验期间不挂载画布；旧画布已卸载，切换后按新空间重新校验。
      useWorkspaceSessionStore.getState().switchWorkspace(matches[0], { forceMemberReload: true })
    })()
    return () => {
      cancelled = true
    }
  }, [attempt, canvasId, userId, workspaceId])

  if (state === 'ready')
    return (
      <Suspense fallback={<div className="route-loading" aria-label="正在加载画布" />}>
        <CanvasView />
      </Suspense>
    )
  if (state === 'loading')
    return (
      <div className="route-loading" role="status">
        正在查找画布所属空间…
      </div>
    )
  const message =
    state === 'missing'
      ? '画布不存在或当前账号无权访问'
      : state === 'ambiguous'
        ? '多个空间中存在相同编号的画布，请切换到对应空间后重试'
        : '暂时无法确认画布，请检查网络后重试'
  const description =
    state === 'missing'
      ? '请检查链接是否正确，或联系画布所属团队确认访问权限。'
      : state === 'ambiguous'
        ? '请先切换到目标画布所在的团队空间，再重新打开。'
        : '画布信息暂时无法读取，请稍后重试或返回画布列表。'
  return (
    <CanvasAccessNotice message={message} description={description} onRetry={() => setAttempt((value) => value + 1)} />
  )
}

export default function CanvasAccessRoute() {
  const { id } = useParams()
  const canvasId = Number(id)
  const workspaceId = useWorkspaceId()
  const userId = resolveUserId(useCurrentUser())
  if (!Number.isSafeInteger(canvasId) || canvasId <= 0)
    return <CanvasAccessNotice message="画布编号无效" description="请检查链接是否完整，或返回画布列表重新打开。" />
  if (!workspaceId || !userId)
    return (
      <div className="route-loading" role="status">
        正在加载工作空间…
      </div>
    )
  return (
    <CanvasAccess
      key={`${userId}:${workspaceId}:${canvasId}`}
      canvasId={canvasId}
      workspaceId={workspaceId}
      userId={userId}
    />
  )
}
