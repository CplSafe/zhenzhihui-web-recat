import { useEffect, useState } from 'react'
import { Avatar, Button, ConfigProvider, Modal, Select, theme } from 'antd'
import { listWorkspaceMembers } from '@/api/auth'
import styles from './CanvasMembers.module.css'
import { changeCanvasMembers, getCanvasMembers, type CanvasMembers } from '@/api/canvasApi'
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
  const [removed, setRemoved] = useState<number[]>([])
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

  async function save() {
    if ((!selected.length && !removed.length) || saving || !access?.can_manage) return
    setSaving(true)
    setError('')
    try {
      setAccess(await changeCanvasMembers(workspaceId, canvasId, selected, removed))
      setSelected([])
      setRemoved([])
    } catch (err) {
      setError(getBusinessErrorMessage(err, '保存成员变更失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const canManage = access?.can_manage
  const ids = access?.member_user_ids || []
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: { colorPrimary: '#4fd5b7', colorBgContainer: '#292c30', colorBgElevated: '#222427', borderRadius: 9 },
      }}
      button={{ autoInsertSpace: false }}
    >
      <Modal
        open
        centered
        width={452}
        zIndex={1400}
        title="创作成员"
        onCancel={saving ? undefined : onClose}
        closable={!saving}
        cancelText={canManage ? '取消' : '关闭'}
        okText="保存更改"
        onOk={save}
        confirmLoading={saving}
        okButtonProps={{
          disabled: !selected.length && !removed.length,
          style: canManage ? undefined : { display: 'none' },
        }}
        cancelButtonProps={{ disabled: saving }}
      >
        {error && (
          <p role="alert">
            {error}{' '}
            {!access && (
              <Button type="link" onClick={() => setAttempt((v) => v + 1)}>
                重试
              </Button>
            )}
          </p>
        )}
        {!access && !error && <p role="status">正在加载成员…</p>}
        {access && (
          <div className={styles.body}>
            {canManage && (
              <div className={styles.field}>
                <span>添加团队成员</span>
                <MemberPicker
                  directory={directory}
                  excluded={ids}
                  value={selected}
                  onChange={setSelected}
                  disabled={saving}
                />
              </div>
            )}
            <div className={styles.rosterHeading}>
              <span>{access.members_restricted ? '已有成员' : '团队全体成员'}</span>
              <span>{ids.length} 人</span>
            </div>
            <ul className={styles.roster}>
              {ids.map((id) => {
                const name = directory.options.find((option) => option.value === id)?.label || `成员 ${id}`
                const pending = removed.includes(id)
                return (
                  <li key={id} className={styles.row}>
                    <Avatar size={32} className={styles.avatar}>
                      {Array.from(name)[0]?.toUpperCase()}
                    </Avatar>
                    <span className={styles.name}>{name}</span>
                    {id === access.creator_id ? (
                      <span className={styles.role}>创建者</span>
                    ) : (
                      canManage && (
                        <Button
                          type="text"
                          size="small"
                          disabled={saving}
                          danger={!pending}
                          aria-label={`${pending ? '撤销移除' : '移除'} ${name}`}
                          onClick={() => setRemoved((old) => (pending ? old.filter((x) => x !== id) : [...old, id]))}
                        >
                          {pending ? '撤销移除' : '移除'}
                        </Button>
                      )
                    )}
                  </li>
                )
              })}
            </ul>
            {!access.members_restricted && removed.length > 0 && <small>保存后，仅保留的成员可打开此画布。</small>}
          </div>
        )}
      </Modal>
    </ConfigProvider>
  )
}
