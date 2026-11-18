import { useState } from 'react'
import type { CanvasCreateOptions } from '@/api/canvasApi'
import { useGenerationModelCatalog } from '@/composables/useGenerationModelCatalog'
import { useCurrentWorkspace } from '@/stores/workspaceSession'
import { isCanvasToolOnlyImageModel } from '@/utils/canvasImageModelVisibility'
import { buildCanvasModelBuckets } from '@/utils/canvasModelBuckets'
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
  const [imageModelVersionId, setImage] = useState<number>()
  const [videoModelVersionId, setVideo] = useState<number>()
  const [scope, setScope] = useState<'all' | 'selected'>('selected')
  const [members, setMembers] = useState<number[]>([])
  const team = isTeamWorkspace(useCurrentWorkspace())
  const { groups, loading, operationStates, reload } = useGenerationModelCatalog(workspaceId)
  const catalog = buildCanvasModelBuckets(groups)
  const selectors = [
    {
      label: '生图模型',
      operation: 'image.text_to_image' as const,
      models: catalog.image.filter((model) => !isCanvasToolOnlyImageModel(model)),
      value: imageModelVersionId,
      change: setImage,
    },
    {
      label: '生视频模型',
      operation: 'video.generate' as const,
      models: catalog.video,
      value: videoModelVersionId,
      change: setVideo,
    },
  ]
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
              imageModelVersionId,
              videoModelVersionId,
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
          {selectors.map(({ label, operation, models, value, change }) => {
            const state = operationStates[operation]
            return (
              <div key={operation}>
                <label className="cl-brief-name">
                  {label}
                  <select value={value || ''} onChange={(e) => change(Number(e.target.value) || undefined)}>
                    <option value="">创作时选择</option>
                    {models
                      .filter((model) => model.operationCodes.includes(operation))
                      .map((model) => (
                        <option
                          key={model.modelVersionId}
                          value={model.modelVersionId}
                          disabled={Boolean(model.unavailableReason)}
                        >
                          {model.displayName}
                          {model.unavailableReason ? '（暂不可用）' : ''}
                        </option>
                      ))}
                  </select>
                </label>
                {loading && <small>正在加载模型…</small>}
                {!loading && state?.status === 'error' && (
                  <small role="alert">
                    {state.message}{' '}
                    <button type="button" onClick={reload}>
                      重试
                    </button>
                  </small>
                )}
              </div>
            )
          })}
          {team && (
            <>
              <label className="cl-brief-name">
                谁可以打开并创作
                <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                  <option value="selected">我和指定成员</option>
                  <option value="all">团队全体成员</option>
                </select>
              </label>
              {scope === 'selected' && (
                <div className="cl-member-field">
                  <CreateMemberPicker
                    workspaceId={workspaceId}
                    currentUserId={currentUserId}
                    value={members}
                    onChange={setMembers}
                  />
                  <small>留空时仅你可创作。创建后可继续添加成员。</small>
                </div>
              )}
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
