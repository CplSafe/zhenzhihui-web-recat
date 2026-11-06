import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import RefineTaskList from '@/components/smart/refine/RefineTaskList'
import { useRefineDemoStore, type RefineDemoTask } from '@/stores/refineDemo'

const task: RefineDemoTask = {
  id: 'one',
  ownerId: 7,
  workspaceId: 2,
  description: '咖啡视频',
  script: '测评视频',
  duration: 30,
  ratio: '16:9',
  resolution: '720p',
  credits: 1125,
  materialCount: 2,
  createdAt: 1000000,
  dueAt: 2000000,
  status: '精修中',
  revision: 0,
}
beforeEach(() =>
  useRefineDemoStore.setState({
    tasks: [
      task,
      { ...task, id: 'other', ownerId: 8, description: '其他账号' },
      { ...task, id: 'space', workspaceId: 3, description: '其他空间' },
    ],
  }),
)

describe('精制演示任务', () => {
  it('只展示当前账号与空间，筛选后可查看任务详情', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RefineTaskList ownerId={7} workspaceId={2} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('其他账号')).not.toBeInTheDocument()
    expect(screen.queryByText('其他空间')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('状态'), '待验收')
    expect(screen.getByText('暂无符合条件的精制演示任务')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(screen.getByLabelText('状态')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: /咖啡视频/ }))
    const dialog = screen.getByRole('dialog', { name: '精制任务详情（演示）' })
    expect(within(dialog).getByText('2 个')).toBeInTheDocument()
    expect(within(dialog).getByText('1,125 积分（模拟）')).toBeInTheDocument()
  })
  it('更新必须匹配账号和空间', () => {
    useRefineDemoStore.getState().update('one', 8, 2, { status: '待验收' })
    expect(useRefineDemoStore.getState().tasks[0].status).toBe('精修中')
    useRefineDemoStore.getState().update('one', 7, 2, { status: '待验收' })
    expect(useRefineDemoStore.getState().tasks[0].status).toBe('待验收')
  })

  it('退款后的任务显示承诺交付时间，不再显示预计交付', () => {
    useRefineDemoStore.getState().update('one', 7, 2, { status: '积分已退回' })
    render(
      <MemoryRouter>
        <RefineTaskList ownerId={7} workspaceId={2} />
      </MemoryRouter>,
    )
    const card = screen.getByRole('button', { name: /咖啡视频/ })
    expect(within(card).getByText(/承诺交付/)).toBeInTheDocument()
    expect(within(card).queryByText(/预计交付/)).not.toBeInTheDocument()
  })
})
