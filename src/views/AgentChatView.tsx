/**
 * AgentChatView —— 智能体对话独立页。
 *
 * AgentChatPanel 本身不绑定任何页面,这里只负责从会话取 workspaceId 与昵称,
 * 把组件铺满可用高度。画布等宿主可以用同样的方式挂载它。
 */
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import AgentChatPanel from '@/components/agent/AgentChatPanel'

export default function AgentChatView() {
  const workspaceId = useWorkspaceId()
  const user = useCurrentUser()

  if (!workspaceId) {
    return (
      <div
        style={{
          display: 'grid',
          placeItems: 'center',
          height: '100%',
          color: 'var(--color-text-tertiary)',
          fontSize: 14,
        }}
      >
        正在载入工作空间…
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        maxWidth: 860,
        margin: '0 auto',
        // 独立页时给组件一个卡片边界,嵌在侧栏里则由宿主容器决定。
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-workbench-card)',
      }}
    >
      <AgentChatPanel workspaceId={workspaceId} userName={(user as { nickname?: string } | null)?.nickname} />
    </div>
  )
}
