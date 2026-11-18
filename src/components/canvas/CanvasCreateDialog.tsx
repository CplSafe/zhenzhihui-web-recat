import { Segmented } from 'antd'
import { CanvasMultiSelect } from './CanvasMultiSelect'
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
  const [imageModelVersionIds, setImage] = useState<number[]>([])
  const [videoModelVersionIds, setVideo] = useState<number[]>([])
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
      value: imageModelVersionIds,
      change: setImage,
    },
    {
      label: '生视频模型',
      operation: 'video.generate' as const,
      models: catalog.video,
      value: videoModelVersionIds,
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
          {selectors.map(({ label, operation, models, value, change }) => {
            const state = operationStates[operation]
            return (
              <div key={operation}>
                <div className="cl-brief-name">
                  <span>{label}</span>
                  <CanvasMultiSelect
                    aria-label={label}
                    placeholder="不限模型"
                    value={value}
                    onChange={change}
                    loading={loading}
                    disabled={creating}
                    size="large"
                    options={models
                      .filter((model) => model.operationCodes.includes(operation))
                      .map((model) => ({
                        value: model.modelVersionId,
                        label: model.displayName + (model.unavailableReason ? '（暂不可用）' : ''),
                        disabled: !!model.unavailableReason,
                      }))}
                  />
                </div>
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
