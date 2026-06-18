/*
  CreativeEntryView — 创意工作流入口页
  负责创建新项目或选择已有项目，然后跳转到 CreativeScriptView 进入编辑流程。
  也会承接首页"开始创作"按钮的路由跳转。
*/
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import '@/styles/creative.css'
import AppToast from '@/components/AppToast'
import { createCreativeProject, getBusinessErrorMessage } from '@/api/business'
import { useToast } from '@/composables/useToast'
import { useWorkspaceId } from '@/stores/workspaceSession'
import { clearCreativeWorkflowState } from '@/utils/creativeStorage'

function resolveProjectId(payload: any): number {
  const candidates = [payload?.id, payload?.project?.id, payload?.data?.id]
  const id = Number(candidates.find((value) => Number(value) > 0) || 0)
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
}

export default function CreativeEntryView() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const workspaceId = useWorkspaceId()
  // createCreativeProject 是非幂等 POST：用 ref 守卫，避免 StrictMode 开发态双调用
  // （或任何 remount）创建出多余的孤儿项目。
  const didCreateRef = useRef(false)

  useEffect(() => {
    if (didCreateRef.current) return
    didCreateRef.current = true

    let cancelled = false
    async function createAndEnter() {
      if (!workspaceId) {
        showToast('workspace_id 缺失，请重新登录或切换工作空间', 'error')
        return
      }
      clearCreativeWorkflowState()
      try {
        const payload = await createCreativeProject({ workspace_id: workspaceId })
        const id = resolveProjectId(payload)
        if (!id) {
          throw new Error('创建项目失败：缺少项目 ID')
        }
        if (!cancelled) navigate(`/creative/${id}`, { replace: true })
      } catch (error: any) {
        if (!cancelled) showToast(getBusinessErrorMessage(error, error?.message || '创建项目失败，请稍后重试'), 'error')
      }
    }
    createAndEnter()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="creative-shell">
      <AppToast />
      <section className="creative-stage" aria-label="窗口式创作">
        <div className="creative-frame">
          <div className="main-canvas"></div>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#666666',
            }}
          >
            正在创建创意项目…
          </div>
        </div>
      </section>
    </main>
  )
}
