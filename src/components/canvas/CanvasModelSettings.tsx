import { useEffect, useState } from 'react'
import { Alert, ConfigProvider, Modal, theme } from 'antd'
import {
  getCanvas,
  getCanvasMembers,
  patchCanvas,
  type CanvasModelSelection,
  type CanvasSummary,
} from '@/api/canvasApi'
import { getBusinessErrorMessage } from '@/api/business'
import CanvasModelFields from './CanvasModelFields'

export default function CanvasModelSettings({
  workspaceId,
  canvasId,
  dark,
  onClose,
  onSaved,
}: {
  workspaceId: number
  canvasId: number
  dark?: boolean
  onClose: () => void
  onSaved: (row: CanvasSummary) => void
}) {
  const [initial, setInitial] = useState<CanvasModelSelection>()
  const [draft, setDraft] = useState<CanvasModelSelection>()
  const [manage, setManage] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([getCanvas({ workspaceId, canvasId }), getCanvasMembers(workspaceId, canvasId)])
      .then(([page, acl]) => {
        if (!active) return
        if (!page) throw new Error('画布不存在')
        const data = {
          image_model_version_ids:
            page.imageModelVersionIds ?? (page.imageModelVersionId ? [page.imageModelVersionId] : []),
          video_model_version_ids:
            page.videoModelVersionIds ?? (page.videoModelVersionId ? [page.videoModelVersionId] : []),
        }
        setInitial(data)
        setDraft(data)
        setManage(acl.can_manage)
      })
      .catch((e) => {
        if (active) setError(getBusinessErrorMessage(e, '无法加载模型设置'))
      })
    return () => {
      active = false
    }
  }, [workspaceId, canvasId])
  async function save() {
    if (!initial || !draft || saving || !manage) return
    setSaving(true)
    setError('')
    try {
      const row = await patchCanvas({ workspaceId, canvasId, models: draft, expectedModels: initial })
      if (!row) throw new Error('保存模型设置失败')
      onSaved(row)
      onClose()
    } catch (e) {
      setError(getBusinessErrorMessage(e, '保存模型设置失败'))
    } finally {
      setSaving(false)
    }
  }
  return (
    <ConfigProvider theme={dark ? { algorithm: theme.darkAlgorithm } : undefined}>
      <Modal
        open
        centered
        title="模型设置"
        zIndex={1400}
        onCancel={saving ? undefined : onClose}
        maskClosable={!saving}
        closable={!saving}
        cancelButtonProps={{ disabled: saving }}
        cancelText="关闭"
        okText="保存"
        confirmLoading={saving}
        okButtonProps={{ disabled: !manage || JSON.stringify(initial) === JSON.stringify(draft) }}
        onOk={save}
      >
        {error && <Alert type="error" message={error} />}
        {draft ? (
          <div style={{ display: 'grid', gap: 14, paddingBlock: 12 }}>
            <CanvasModelFields
              workspaceId={workspaceId}
              disabled={!manage || saving}
              imageModelVersionIds={draft.image_model_version_ids}
              videoModelVersionIds={draft.video_model_version_ids}
              setImage={(ids) => setDraft({ ...draft, image_model_version_ids: ids })}
              setVideo={(ids) => setDraft({ ...draft, video_model_version_ids: ids })}
            />
            <small>
              {manage
                ? '某类模型留空时，可使用工作空间内该类的全部可用模型。'
                : '仅画布创建者或有管理权限的团队成员可修改。'}
            </small>
          </div>
        ) : (
          !error && <p>正在加载模型设置…</p>
        )}
      </Modal>
    </ConfigProvider>
  )
}
