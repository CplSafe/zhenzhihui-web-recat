import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Alert, ConfigProvider, Input, Modal, Segmented } from 'antd'
import {
  changeCanvasMembers,
  getCanvas,
  getCanvasMembers,
  patchCanvas,
  type CanvasModelSelection,
  type CanvasSummary,
} from '@/api/canvasApi'
import { getBusinessErrorMessage } from '@/api/business'
import { deriveWorkspaceId, useCurrentWorkspace, useWorkspaceSessionStore } from '@/stores/workspaceSession'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { isTeamWorkspace } from '@/utils/memberOwnerFilter'
import CanvasModelFields from './CanvasModelFields'
import { CreateMemberPicker } from './CanvasMembers'

type MemberScope = 'all' | 'selected'

type Settings = {
  title: string
  models: CanvasModelSelection
  memberIds: number[]
  scope: MemberScope
}

function sameIds(a: number[], b: number[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export default function CanvasSettingsDialog({
  workspaceId,
  canvasId,
  currentUserId,
  onClose,
  onSaved,
}: {
  workspaceId: number
  canvasId: number
  currentUserId: number
  onClose: () => void
  onSaved: (changes: Partial<CanvasSummary>) => void
}) {
  const team = isTeamWorkspace(useCurrentWorkspace())
  const [initial, setInitial] = useState<Settings>()
  const [draft, setDraft] = useState<Settings>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const active = useRef(false)
  const savingRef = useRef(false)
  const titleId = useId()
  const scopeId = useId()
  const scopeHintId = useId()
  const isCurrentSession = useCallback(() => {
    const session = useWorkspaceSessionStore.getState()
    return deriveWorkspaceId(session) === workspaceId && resolveUserId(session.authSession?.user) === currentUserId
  }, [workspaceId, currentUserId])

  useEffect(() => {
    let cancelled = false
    active.current = true
    Promise.all([getCanvas({ workspaceId, canvasId }), getCanvasMembers(workspaceId, canvasId)])
      .then(([canvas, access]) => {
        if (cancelled || !isCurrentSession()) return
        if (!canvas) {
          setError('画布不存在')
          return
        }
        const creatorId = Number(access?.creator_id ?? canvas.userId)
        if (
          !currentUserId ||
          creatorId !== currentUserId ||
          (canvas.userId && canvas.userId !== currentUserId) ||
          access?.can_manage !== true
        ) {
          setError('仅画布创建者可修改画布设置')
          return
        }
        if (canvas.status === 'archived') {
          setError('画布已归档，无法修改设置')
          return
        }
        const settings: Settings = {
          title: canvas.title || '',
          models: {
            image_model_version_ids:
              canvas.imageModelVersionIds ?? (canvas.imageModelVersionId ? [canvas.imageModelVersionId] : []),
            video_model_version_ids:
              canvas.videoModelVersionIds ?? (canvas.videoModelVersionId ? [canvas.videoModelVersionId] : []),
          },
          memberIds: (access.member_user_ids || []).filter((id) => id !== creatorId),
          scope: access.members_restricted ? 'selected' : 'all',
        }
        setInitial(settings)
        setDraft(settings)
      })
      .catch((reason) => {
        if (!cancelled && isCurrentSession()) setError(getBusinessErrorMessage(reason, '无法加载画布设置'))
      })
    return () => {
      active.current = false
      cancelled = true
    }
  }, [attempt, canvasId, currentUserId, workspaceId, isCurrentSession])

  const title = draft?.title.trim() || ''
  const titleChanged = !!initial && initial.title !== title
  const modelsChanged =
    !!initial &&
    !!draft &&
    (!sameIds(initial.models.image_model_version_ids, draft.models.image_model_version_ids) ||
      !sameIds(initial.models.video_model_version_ids, draft.models.video_model_version_ids))
  const editingMembers = team && draft?.scope === 'selected'
  const noMembersToRemove = initial?.scope === 'all' && initial.memberIds.length === 0
  const added = editingMembers && initial ? draft.memberIds.filter((id) => !initial.memberIds.includes(id)) : []
  const removed = editingMembers && initial ? initial.memberIds.filter((id) => !draft.memberIds.includes(id)) : []
  // 现有成员接口通过移除成员把全员开放的画布切换为指定成员。
  const narrowingScope = editingMembers && initial?.scope === 'all'
  const membersChanged = added.length > 0 || removed.length > 0
  const canSave =
    !!initial &&
    !!draft &&
    (!titleChanged || !!title) &&
    (!narrowingScope || removed.length > 0) &&
    (titleChanged || modelsChanged || membersChanged)

  async function save() {
    if (!initial || !draft || !canSave || savingRef.current || !active.current || !isCurrentSession()) return
    savingRef.current = true
    setSaving(true)
    setError('')
    let metadataSaved = false
    try {
      if (titleChanged || modelsChanged) {
        const saved = await patchCanvas({
          workspaceId,
          canvasId,
          title: titleChanged ? title : undefined,
          models: modelsChanged ? draft.models : undefined,
          expectedModels: modelsChanged ? initial.models : undefined,
        })
        if (!active.current || !isCurrentSession()) return
        if (!saved) throw new Error('未获取到画布信息保存结果')
        metadataSaved = true
        setInitial({ ...initial, title, models: draft.models })
        onSaved({
          ...(titleChanged ? { title } : {}),
          ...(saved.updated_at ? { updated_at: saved.updated_at } : {}),
          ...(modelsChanged
            ? {
                imageModelVersionIds: draft.models.image_model_version_ids,
                videoModelVersionIds: draft.models.video_model_version_ids,
              }
            : {}),
        })
      }
      if (membersChanged) {
        const access = await changeCanvasMembers(workspaceId, canvasId, added, removed)
        if (!active.current || !isCurrentSession()) return
        if (!access) throw new Error('未获取到创作成员保存结果')
        if (!access.members_restricted) throw new Error('画布仍向团队全体成员开放，请重新打开设置后重试')
        onSaved({ membersRestricted: access.members_restricted })
      }
      onClose()
    } catch (reason) {
      if (!active.current || !isCurrentSession()) return
      const message = getBusinessErrorMessage(reason, '保存画布设置失败，请重试')
      setError(metadataSaved ? `画布信息已保存。创作成员尚未保存。${message}` : message)
    } finally {
      savingRef.current = false
      if (active.current && isCurrentSession()) setSaving(false)
    }
  }

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <Modal
        open
        centered
        width={480}
        zIndex={1400}
        title="设置画布"
        onCancel={saving ? undefined : onClose}
        maskClosable={!saving}
        closable={!saving}
        keyboard={!saving}
        cancelText="取消"
        cancelButtonProps={{ disabled: saving }}
        okText="保存"
        okButtonProps={{ disabled: !canSave }}
        confirmLoading={saving}
        onOk={save}
      >
        {error && (
          <Alert
            type="error"
            message={error}
            action={
              !draft && (
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setAttempt((value) => value + 1)
                  }}
                >
                  重试
                </button>
              )
            }
          />
        )}
        {draft && initial ? (
          <div className="cl-settings-fields">
            <div className="cl-settings-title">
              <label htmlFor={titleId}>画布名称</label>
              <Input
                id={titleId}
                size="large"
                value={draft.title}
                maxLength={60}
                showCount
                placeholder="请输入画布名称"
                disabled={saving}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>
            <CanvasModelFields
              workspaceId={workspaceId}
              disabled={saving}
              imageModelVersionIds={draft.models.image_model_version_ids}
              videoModelVersionIds={draft.models.video_model_version_ids}
              setImage={(ids) => setDraft({ ...draft, models: { ...draft.models, image_model_version_ids: ids } })}
              setVideo={(ids) => setDraft({ ...draft, models: { ...draft.models, video_model_version_ids: ids } })}
            />
            {team && (
              <div className="cl-settings-title">
                <span id={scopeId}>可创作成员</span>
                <Segmented<MemberScope>
                  aria-labelledby={scopeId}
                  aria-describedby={scopeHintId}
                  block
                  size="large"
                  disabled={saving}
                  value={draft.scope}
                  onChange={(scope) => setDraft({ ...draft, scope, memberIds: initial.memberIds })}
                  options={[
                    { label: '指定成员', value: 'selected', disabled: noMembersToRemove },
                    { label: '团队全体成员', value: 'all', disabled: initial.scope === 'selected' },
                  ]}
                />
                {editingMembers && (
                  <CreateMemberPicker
                    workspaceId={workspaceId}
                    currentUserId={currentUserId}
                    value={draft.memberIds}
                    onChange={(memberIds) => setDraft({ ...draft, memberIds })}
                    disabled={saving}
                  />
                )}
                <div id={scopeHintId} className="cl-settings-hints">
                  {editingMembers ? (
                    <small>
                      {draft.memberIds.length
                        ? `你和所选的 ${draft.memberIds.length} 位成员可打开并创作。`
                        : '未选择成员时，仅你可打开并创作。'}
                    </small>
                  ) : (
                    <small>团队全体成员均可打开并创作。</small>
                  )}
                  {narrowingScope && removed.length === 0 && <small>取消选择至少一位现有成员后即可保存。</small>}
                  {noMembersToRemove && <small>当前没有可移除的成员，暂不能切换为指定成员。</small>}
                  {initial.scope === 'selected' && <small>已设为指定成员的画布暂不能重新开放给团队全体成员。</small>}
                </div>
              </div>
            )}
          </div>
        ) : (
          !error && <p role="status">正在加载画布设置…</p>
        )}
      </Modal>
    </ConfigProvider>
  )
}
