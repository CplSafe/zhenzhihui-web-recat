import { ConfigProvider } from 'antd'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import CanvasCreateDialog from '@/components/canvas/CanvasCreateDialog'
import { CanvasMembersDialog } from '@/components/canvas/CanvasMembers'
import { changeCanvasMembers, getCanvasMembers } from '@/api/canvasApi'

vi.mock('@/stores/workspaceSession', () => ({ useCurrentWorkspace: () => ({ type: 'team' }) }))
vi.mock('@/api/auth', () => ({
  listWorkspaceMembers: vi.fn(async () => [
    { user_id: 5, nickname: '创建者', status: 'enabled' },
    { user_id: 6, nickname: '王敏', status: 'enabled' },
    { user_id: 7, nickname: '已停用成员', status: 'disabled' },
  ]),
}))
vi.mock('@/api/canvasApi', () => ({ getCanvasMembers: vi.fn(), changeCanvasMembers: vi.fn() }))
vi.mock('@/composables/useGenerationModelCatalog', () => ({
  useGenerationModelCatalog: () => ({
    groups: [
      {
        key: 'image',
        models: [
          { modelVersionId: 11, displayName: '图片 A', operationCodes: ['image.text_to_image'], source: {} },
          { modelVersionId: 12, displayName: '图片 C', operationCodes: ['image.text_to_image'], source: {} },
          { modelVersionId: 13, displayName: '图片 D', operationCodes: ['image.text_to_image'], source: {} },
        ],
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
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '生图模型' }))
  await user.click(await screen.findByText('图片 A'))
  await user.click(await screen.findByText('图片 C'))
  expect(screen.getByRole('combobox', { name: '生图模型' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('已选 2 项')).toBeInTheDocument()
  await user.click(screen.getByText('已选 2 项').parentElement!.querySelector('button')!)
  expect(screen.getByRole('combobox', { name: '生图模型' })).toHaveAttribute('aria-expanded', 'false')
  expect(onCreate).not.toHaveBeenCalled()
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '生视频模型' }))
  await user.click(await screen.findByText('视频 B'))
  fireEvent.keyDown(screen.getByRole('combobox', { name: '生视频模型' }), { key: 'Escape' })
  await user.click(screen.getByRole('button', { name: '创建画布' }))
  expect(onCreate).toHaveBeenLastCalledWith('产品图', {
    imageModelVersionIds: [11, 12],
    videoModelVersionIds: [22],
    memberUserIds: [],
  })
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择创作成员' }))
  await user.click(await screen.findByText('王敏'))
  expect(screen.queryByText('已停用成员')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '创建画布' }))
  expect(onCreate).toHaveBeenLastCalledWith('产品图', expect.objectContaining({ memberUserIds: [6] }))
  await user.click(screen.getByText('团队全体成员'))
  expect(screen.getByRole('radio', { name: '团队全体成员' })).toBeChecked()
  expect(screen.queryByRole('combobox', { name: '选择创作成员' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '创建画布' }))
  expect(onCreate).toHaveBeenLastCalledWith('产品图', expect.objectContaining({ memberUserIds: undefined }))
  await user.click(screen.getByText('指定成员'))
  expect(screen.getByRole('radio', { name: '指定成员' })).toBeChecked()
  const members = screen.getByRole('combobox', { name: '选择创作成员' })
  expect(screen.getByText('你和所选的 1 位成员可打开并创作。')).toBeVisible()
  fireEvent.mouseDown(members)

  const memberOption = screen.getByText('王敏', { selector: '.ant-select-item-option-content' })
  const menu = memberOption.closest<HTMLElement>('.ant-select-dropdown')!
  await user.click(memberOption)
  expect(within(menu).getByText('已选 0 项')).toBeInTheDocument()
  await user.click(within(menu).getByText('完成'))
  await user.click(screen.getByRole('button', { name: '创建画布' }))
  expect(onCreate).toHaveBeenLastCalledWith('产品图', expect.objectContaining({ memberUserIds: [] }))
})

it('多选折叠长名单，移除已选标签后保留其他模型并保持弹窗打开', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn()
  const onClose = vi.fn()
  render(
    <CanvasCreateDialog workspaceId={4} currentUserId={5} creating={false} onCreate={onCreate} onClose={onClose} />,
  )
  await user.type(screen.getByPlaceholderText('请输入画布名称'), '测试')
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '生图模型' }))
  for (const name of ['图片 A', '图片 C', '图片 D']) {
    await user.click(await screen.findByText(name, { selector: '.ant-select-item-option-content' }))
  }
  expect(screen.getByText('+1')).toBeInTheDocument()
  const footer = screen.getByText('已选 3 项').parentElement!
  await user.click(within(footer).getByText('完成'))
  const tag = screen.getByText('图片 A', { selector: '.ant-select-selection-item-content' }).parentElement!
  await user.click(tag.querySelector('.ant-select-selection-item-remove')!)
  expect(onClose).not.toHaveBeenCalled()
  expect(onCreate).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '创建画布' }))
  expect(onCreate).toHaveBeenCalledWith('测试', expect.objectContaining({ imageModelVersionIds: [12, 13] }))
})

it('创作中只追加新选成员，并按服务器返回名单立即更新', async () => {
  const user = userEvent.setup()
  vi.mocked(getCanvasMembers).mockResolvedValue({
    creator_id: 5,
    members_restricted: true,
    member_user_ids: [5],
    can_manage: true,
  })
  vi.mocked(changeCanvasMembers).mockResolvedValue({
    creator_id: 5,
    members_restricted: true,
    member_user_ids: [5, 6],
    can_manage: true,
  })
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <CanvasMembersDialog workspaceId={4} canvasId={9} onClose={vi.fn()} />
    </ConfigProvider>,
  )
  await waitFor(() => expect(screen.getAllByText('创建者')[0]).toBeVisible())
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择创作成员' }))
  await user.click(await screen.findByText('王敏'))
  await user.click(screen.getByRole('button', { name: '保存更改' }))
  await waitFor(() => expect(changeCanvasMembers).toHaveBeenCalledWith(4, 9, [6], []))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: '移除 王敏' }))
  await user.click(screen.getByRole('button', { name: '保存更改' }))
  await waitFor(() => expect(changeCanvasMembers).toHaveBeenLastCalledWith(4, 9, [], [6]))
})

it('普通参与者能查看已有名单', async () => {
  vi.mocked(getCanvasMembers).mockResolvedValue({
    creator_id: 5,
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
