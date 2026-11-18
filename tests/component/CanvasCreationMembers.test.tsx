import { ConfigProvider } from 'antd'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import CanvasCreateDialog from '@/components/canvas/CanvasCreateDialog'
import { CanvasMembersDialog } from '@/components/canvas/CanvasMembers'
import { addCanvasMembers, getCanvasMembers } from '@/api/canvasApi'

vi.mock('@/stores/workspaceSession', () => ({ useCurrentWorkspace: () => ({ type: 'team' }) }))
vi.mock('@/api/auth', () => ({
  listWorkspaceMembers: vi.fn(async () => [
    { user_id: 5, nickname: '创建者', status: 'enabled' },
    { user_id: 6, nickname: '王敏', status: 'enabled' },
    { user_id: 7, nickname: '已停用成员', status: 'disabled' },
  ]),
}))
vi.mock('@/api/canvasApi', () => ({ getCanvasMembers: vi.fn(), addCanvasMembers: vi.fn() }))
vi.mock('@/composables/useGenerationModelCatalog', () => ({
  useGenerationModelCatalog: () => ({
    groups: [
      {
        key: 'image',
        models: [{ modelVersionId: 11, displayName: '图片 A', operationCodes: ['image.text_to_image'], source: {} }],
      },
      {
        key: 'video',
        models: [{ modelVersionId: 22, displayName: '视频 B', operationCodes: ['video.generate'], source: {} }],
      },
    ],
    loading: false,
    operationStates: {},
  }),
}))
beforeEach(() => vi.clearAllMocks())

it('保存所选模型和可创作成员，切到全员后省略成员限制', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn()
  render(
    <CanvasCreateDialog workspaceId={4} currentUserId={5} creating={false} onCreate={onCreate} onClose={vi.fn()} />,
  )
  await user.type(screen.getByPlaceholderText('请输入画布名称'), '产品图')
  await user.selectOptions(screen.getByLabelText('生图模型'), '11')
  await user.selectOptions(screen.getByLabelText('生视频模型'), '22')
  await user.click(screen.getByRole('button', { name: '创建画布' }))
  expect(onCreate).toHaveBeenLastCalledWith('产品图', {
    imageModelVersionId: 11,
    videoModelVersionId: 22,
    memberUserIds: [],
  })
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择创作成员' }))
  await user.click(await screen.findByText('王敏'))
  expect(screen.queryByText('已停用成员')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '创建画布' }))
  expect(onCreate).toHaveBeenLastCalledWith('产品图', expect.objectContaining({ memberUserIds: [6] }))
  await user.selectOptions(screen.getByLabelText('谁可以打开并创作'), 'all')
  await user.click(screen.getByRole('button', { name: '创建画布' }))
  expect(onCreate).toHaveBeenLastCalledWith('产品图', expect.objectContaining({ memberUserIds: undefined }))
})

it('创作中只追加新选成员，并按服务器返回名单立即更新', async () => {
  const user = userEvent.setup()
  vi.mocked(getCanvasMembers).mockResolvedValue({ members_restricted: true, member_user_ids: [5], can_manage: true })
  vi.mocked(addCanvasMembers).mockResolvedValue({ members_restricted: true, member_user_ids: [5, 6], can_manage: true })
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <CanvasMembersDialog workspaceId={4} canvasId={9} onClose={vi.fn()} />
    </ConfigProvider>,
  )
  await waitFor(() => expect(screen.getByText('创建者')).toBeVisible())
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择创作成员' }))
  await user.click(await screen.findByText('王敏'))
  await user.click(screen.getByRole('button', { name: '添加成员' }))
  await waitFor(() => expect(addCanvasMembers).toHaveBeenCalledWith(4, 9, [6]))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

it('普通参与者能查看已有名单', async () => {
  vi.mocked(getCanvasMembers).mockResolvedValue({
    members_restricted: true,
    member_user_ids: [5, 6],
    can_manage: false,
  })
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <CanvasMembersDialog workspaceId={4} canvasId={9} onClose={vi.fn()} />
    </ConfigProvider>,
  )
  await waitFor(() => expect(screen.getByText('王敏')).toBeVisible())
  expect(screen.queryByRole('combobox', { name: '选择创作成员' })).not.toBeInTheDocument()
})
