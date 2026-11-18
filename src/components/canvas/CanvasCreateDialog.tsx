import { Segmented } from 'antd'
import CanvasModelFields from './CanvasModelFields'
import { useState } from 'react'
import type { CanvasCreateOptions } from '@/api/canvasApi'
import { useCurrentWorkspace } from '@/stores/workspaceSession'
import { isTeamWorkspace } from '@/utils/memberOwnerFilter'
import { CreateMemberPicker } from './CanvasMembers'

export default function CanvasCreateDialog({
  workspaceId,
  currentUserId,
  creating,
  onCreate,
  onClose,
}: {
  workspaceId: number
  currentUserId: number
  creating: boolean
  onCreate: (title: string, options: CanvasCreateOptions) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [imageModelVersionIds, setImage] = useState<number[]>([])
  const [videoModelVersionIds, setVideo] = useState<number[]>([])
  const [scope, setScope] = useState<'all' | 'selected'>('selected')
  const [members, setMembers] = useState<number[]>([])
  const team = isTeamWorkspace(useCurrentWorkspace())
  return (
    <div className="cl-brief-mask" onClick={() => !creating && onClose()}>
      <form
        className="cl-brief-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-brief-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim() && !creating)
            onCreate(title.trim(), {
              imageModelVersionIds,
              videoModelVersionIds,
              memberUserIds: team && scope === 'selected' ? members : undefined,
            })
        }}
      >
        <header className="cl-brief-head">
          <h2 id="canvas-brief-title">创建新画布</h2>
          <button type="button" className="cl-brief-close" aria-label="关闭" disabled={creating} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="cl-brief-content cl-setup-fields">
          <label className="cl-brief-name">
            <span>画布名称</span>
            <input
              value={title}
              autoFocus
              maxLength={60}
              placeholder="请输入画布名称"
              onChange={(e) => setTitle(e.target.value)}
            />
            <small>{title.length}/60</small>
          </label>
          <CanvasModelFields
            workspaceId={workspaceId}
            disabled={creating}
            imageModelVersionIds={imageModelVersionIds}
            videoModelVersionIds={videoModelVersionIds}
            setImage={setImage}
            setVideo={setVideo}
          />
          {team && (
            <>
              <div className="cl-brief-name">
                <span id="canvas-member-scope">可创作成员</span>
                <Segmented<'all' | 'selected'>
                  aria-labelledby="canvas-member-scope"
                  block
                  size="large"
                  disabled={creating}
                  value={scope}
                  onChange={setScope}
                  options={[
                    { label: '指定成员', value: 'selected' },
                    { label: '团队全体成员', value: 'all' },
                  ]}
                />
              </div>
              <div hidden={scope !== 'selected'}>
                <div className="cl-member-field">
                  <CreateMemberPicker
                    workspaceId={workspaceId}
                    disabled={creating || scope !== 'selected'}
                    currentUserId={currentUserId}
                    value={members}
                    onChange={setMembers}
                  />
                  <small>
                    {members.length
                      ? `你和所选的 ${members.length} 位成员可打开并创作。`
                      : '未选择成员时，仅你可打开并创作。'}
                  </small>
                </div>
              </div>
            </>
          )}
        </div>
        <footer className="cl-brief-foot">
          <button type="button" className="cl-brief-cancel" disabled={creating} onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={creating || !title.trim()}>
            {creating ? '正在创建…' : '创建画布'}
          </button>
        </footer>
      </form>
    </div>
  )
}
