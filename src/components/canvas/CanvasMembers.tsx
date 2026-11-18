import { useEffect, useState } from 'react'
import { Modal, Select } from 'antd'
import { listWorkspaceMembers } from '@/api/auth'
import { addCanvasMembers, getCanvasMembers, type CanvasMembers } from '@/api/canvasApi'
import { getBusinessErrorMessage } from '@/api/business'
import { resolveUserId } from '@/utils/creativeDraftMetadata'
import { memberDisplayName } from '@/utils/memberOwnerFilter'

function useMemberOptions(workspaceId: number) {
  const [options, setOptions] = useState<{ value: number; label: string }[]>([])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    listWorkspaceMembers(workspaceId)
      .then((members) => {
        if (!active) return
        setOptions(
          members
            .filter((member) => member.status === 'enabled' && resolveUserId(member) > 0)
            .map((member) => ({ value: resolveUserId(member), label: memberDisplayName(member) })),
        )
      })
      .catch((err) => {
        if (active) setError(getBusinessErrorMessage(err, '团队成员加载失败'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [workspaceId, attempt])
  return { options, error, loading, retry: () => setAttempt((v) => v + 1) }
}

function MemberPicker({
  directory,
  excluded,
  value,
  onChange,
  disabled,
}: {
  directory: ReturnType<typeof useMemberOptions>
  excluded: number[]
  value: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
}) {
  const options = directory.options.filter((option) => !excluded.includes(option.value))
  return (
    <>
      <Select
        mode="multiple"
        aria-label="选择创作成员"
        placeholder="按姓名选择团队成员"
        styles={{ popup: { root: { zIndex: 1500 } } }}
        style={{ width: '100%' }}
        value={value}
        onChange={onChange}
        disabled={disabled}
        loading={directory.loading}
        options={options}
        optionFilterProp="label"
        notFoundContent={directory.loading ? '正在加载…' : '没有可添加的成员'}
      />
      {directory.error && (
        <div role="alert">
          {directory.error}{' '}
          <button type="button" onClick={directory.retry}>
            重试
          </button>
        </div>
      )}
    </>
  )
}

export function CreateMemberPicker({
  workspaceId,
  currentUserId,
  value,
  onChange,
}: {
  workspaceId: number
  currentUserId: number
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const directory = useMemberOptions(workspaceId)
  return <MemberPicker directory={directory} excluded={[currentUserId]} value={value} onChange={onChange} />
}

export function CanvasMembersDialog({
  workspaceId,
  canvasId,
  onClose,
}: {
  workspaceId: number
  canvasId: number
  onClose: () => void
}) {
  const directory = useMemberOptions(workspaceId)
  const [access, setAccess] = useState<CanvasMembers | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    getCanvasMembers(workspaceId, canvasId)
      .then((result) => {
        if (active) setAccess(result)
      })
      .catch((err) => {
        if (active) setError(getBusinessErrorMessage(err, '画布成员加载失败'))
      })
    return () => {
      active = false
    }
  }, [workspaceId, canvasId, attempt])

  async function add() {
    if (!selected.length || saving || !access?.can_manage) return
    setSaving(true)
    setError('')
    try {
      setAccess(await addCanvasMembers(workspaceId, canvasId, selected))
      setSelected([])
    } catch (err) {
      setError(getBusinessErrorMessage(err, '添加成员失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const canAdd = access?.members_restricted && access.can_manage
  return (
    <Modal
      open
      zIndex={1400}
      title="创作成员"
      onCancel={saving ? undefined : onClose}
      closable={!saving}
      cancelText="关闭"
      okText="添加成员"
      onOk={add}
      okButtonProps={{ disabled: !selected.length, style: canAdd ? undefined : { display: 'none' } }}
      cancelButtonProps={{ disabled: saving }}
      confirmLoading={saving}
    >
      {error && (
        <p role="alert">
          {error}{' '}
          {!access && (
            <button type="button" onClick={() => setAttempt((v) => v + 1)}>
              重试
            </button>
          )}
        </p>
      )}
      {!access && !error && <p role="status">正在加载画布成员…</p>}
      {access && (
        <>
          <p>{access.members_restricted ? '可打开并编辑此画布的成员' : '当前团队全体成员均可打开并编辑此画布'}</p>
          <ul style={{ maxHeight: '30vh', overflow: 'auto' }}>
            {access.member_user_ids.map((id) => (
              <li key={id}>{directory.options.find((o) => o.value === id)?.label || `成员 ${id}`}</li>
            ))}
          </ul>
          {canAdd && (
            <MemberPicker
              directory={directory}
              excluded={access.member_user_ids}
              value={selected}
              onChange={setSelected}
              disabled={saving}
            />
          )}
        </>
      )}
    </Modal>
  )
}
