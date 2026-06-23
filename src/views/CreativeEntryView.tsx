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
    // didCreateRef 守卫已能防止 StrictMode 双调用 / remount 重复创建孤儿项目；
    // 不再用 cleanup 里的 cancelled 标志，否则 StrictMode 的瞬时卸载会把唯一一次创建的跳转也取消掉，
    // 导致卡在「正在创建创意项目…」永不跳转。
    if (didCreateRef.current) return
    // 首渲染时会话可能尚未水合出 workspaceId(=0)：先等待，待其就绪后本 effect 会因依赖变化重跑，
    // 避免误报"workspace_id 缺失"并永久卡住。
    if (!workspaceId) return
    didCreateRef.current = true

    async function createAndEnter() {
      clearCreativeWorkflowState()
      try {
        const payload = await createCreativeProject({ workspace_id: workspaceId })
        const id = resolveProjectId(payload)
        if (!id) {
          throw new Error('创建项目失败：缺少项目 ID')
        }
        navigate(`/creative/${id}`, { replace: true })
      } catch (error: any) {
        showToast(getBusinessErrorMessage(error, error?.message || '创建项目失败，请稍后重试'), 'error')
      }
    }
    createAndEnter()
    // 依赖 workspaceId：会话水合后其由 0 变为真实值时重跑本 effect 完成创建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

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
