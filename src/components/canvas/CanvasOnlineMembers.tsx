import { useState } from 'react'
import { Avatar, Popover } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import type { CanvasOnlineMember } from '@/composables/useCanvasNodeLocks'

interface Props {
  userId: number
  members?: CanvasOnlineMember[]
}

export default function CanvasOnlineMembers({ userId, members }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div
      data-canvas-readonly-control
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape') return
        event.stopPropagation()
        setOpen(false)
      }}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="bottomRight"
        trigger="click"
        arrow={false}
        zIndex={1410}
        rootClassName="canvas-online-popover"
        content={
          <section aria-label="当前在线" className="canvas-online-roster">
            <h2>当前在线</h2>
            {members?.length ? (
              <ul>
                {members.map((member) => (
                  <li key={member.user_id}>
                    <Avatar size={28} src={member.avatar_url} icon={<UserOutlined />} />
                    <span>{member.name || `成员 ${member.user_id}`}</span>
                    {member.user_id === userId && <small>我</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{members ? '暂无在线成员' : '正在等待在线状态'}</p>
            )}
          </section>
        }
      >
        <button type="button" className="canvas-share-btn canvas-online-trigger" aria-expanded={open}>
          <span className="canvas-online-dot" aria-hidden="true" data-live={!!members?.length} />
          {members ? `${members.length} 人在线` : '在线成员'}
        </button>
      </Popover>
    </div>
  )
}
