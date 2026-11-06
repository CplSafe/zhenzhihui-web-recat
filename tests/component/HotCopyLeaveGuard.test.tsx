import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider, type Location } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { useUnsavedEntryLeaveGuard } from '@/composables/useHotCopyLeaveGuard'

const confirm = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useToast', () => ({ useConfirmDialog: () => ({ requestConfirm: confirm }) }))

function setup(dirty = true, allowNavigation?: (nextLocation: Location) => boolean) {
  const discard = vi.fn()
  function Entry() {
    const [text, setText] = useState(dirty ? '尚未提交的文案' : '')
    useUnsavedEntryLeaveGuard(Boolean(text), discard, allowNavigation)
    return (
      <>
        <input aria-label="文案" value={text} onChange={(e) => setText(e.target.value)} />
        <Link to="/canvas">无限画布</Link>
        <Link to="/hot-copy/303" state={{ bindProjectId: 303 }}>
          绑定当前项目
        </Link>
      </>
    )
  }
  const router = createMemoryRouter(
    [
      { path: '/hot-copy', element: <Entry /> },
      { path: '/canvas', element: <h1>画布列表</h1> },
      { path: '/hot-copy/303', element: <h1>当前项目</h1> },
    ],
    { initialEntries: ['/hot-copy'] },
  )
  render(<RouterProvider router={router} />)
  return { discard, router, user: userEvent.setup() }
}

it('取消离开保持输入，确认离开后才清理并跳转', async () => {
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const { discard, user } = setup()
  await user.click(screen.getByRole('link', { name: '无限画布' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledWith('离开后数据将不保存，是否确认离开？', expect.any(Object)))
  expect(screen.getByRole('textbox')).toHaveValue('尚未提交的文案')
  expect(discard).not.toHaveBeenCalled()
  await user.click(screen.getByRole('link', { name: '无限画布' }))
  expect(await screen.findByRole('heading', { name: '画布列表' })).toBeInTheDocument()
  expect(discard).toHaveBeenCalledTimes(1)
})

it('空白入口直接离开，不弹确认', async () => {
  confirm.mockClear()
  const { user } = setup(false)
  await user.click(screen.getByRole('link', { name: '无限画布' }))
  expect(await screen.findByRole('heading', { name: '画布列表' })).toBeInTheDocument()
  expect(confirm).not.toHaveBeenCalled()
})

it('有未提交输入时拦截刷新，清空输入后解除', async () => {
  const { user } = setup()
  const before = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(before)
  expect(before.defaultPrevented).toBe(true)
  await user.clear(screen.getByRole('textbox'))
  const after = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(after)
  expect(after.defaultPrevented).toBe(false)
})

it('只放行调用方认可的内部绑定，其他离开仍需确认且不提前清空输入', async () => {
  confirm.mockReset().mockResolvedValue(false)
  const { discard, user } = setup(
    true,
    (next) => next.pathname === '/hot-copy/303' && next.state?.bindProjectId === 303,
  )
  await user.click(screen.getByRole('link', { name: '无限画布' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('textbox')).toHaveValue('尚未提交的文案')
  await user.click(screen.getByRole('link', { name: '绑定当前项目' }))
  expect(await screen.findByRole('heading', { name: '当前项目' })).toBeInTheDocument()
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(discard).not.toHaveBeenCalled()
})
