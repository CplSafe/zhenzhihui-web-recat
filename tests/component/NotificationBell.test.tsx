import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import NotificationBell from '@/components/layout/NotificationBell'
import { server } from '../mocks/server'

function installFactNotifications() {
  server.use(
    http.get('/api/v1/student-applications', () => HttpResponse.json({ code: 0, data: { items: [], total: 0 } })),
    http.get('/api/v1/market/me/demands', () =>
      HttpResponse.json({
        code: 0,
        data: {
          items: [
            {
              id: 8,
              title: '产品短片',
              status: 'completed',
              published_at: '2026-08-01T00:00:00Z',
              completed_at: '2026-08-22T00:00:00Z',
            },
          ],
          total: 1,
        },
      }),
    ),
    http.get('/api/v1/market/me/applications', () => HttpResponse.json({ code: 0, data: { items: [], total: 0 } })),
  )
}

function renderBell() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<NotificationBell userKey="fact-user" />} />
        <Route path="/demand/:id" element={<h1>需求事实详情</h1>} />
        <Route path="/script-ideas/:id" element={<h1>剧本申请详情</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NotificationBell 通知事实与已读行为', () => {
  beforeEach(() => {
    window.localStorage.clear()
    installFactNotifications()
  })

  it('打开面板不会擅自标为已读，只有明确操作才清除未读数', async () => {
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByRole('button', { name: '通知' }))
    expect(await screen.findByRole('button', { name: /需求已完成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通知（1 条未读）' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '全部已读' }))
    expect(screen.getByRole('button', { name: '通知' })).toBeInTheDocument()
    expect(window.localStorage.getItem('zzh-market-notify-read:v2:fact-user')).toContain('demand-completed-8')
  })

  it('点击事实通知后单独标记已读并进入对应业务详情', async () => {
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByRole('button', { name: '通知' }))
    await user.click(await screen.findByRole('button', { name: /需求已完成/ }))

    expect(await screen.findByRole('heading', { name: '需求事实详情' })).toBeInTheDocument()
    expect(window.localStorage.getItem('zzh-market-notify-read:v2:fact-user')).toContain('demand-completed-8')
  })

  it('事实来源请求失败时显示错误，不显示虚假的暂无通知', async () => {
    server.use(
      http.get('/api/v1/market/me/demands', () => HttpResponse.json({ code: 1 }, { status: 500 })),
      http.get('/api/v1/market/me/applications', () => HttpResponse.json({ code: 1 }, { status: 500 })),
      http.get('/api/v1/student-applications', () => HttpResponse.json({ code: 1 }, { status: 500 })),
    )
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByRole('button', { name: '通知' }))

    expect(await screen.findByText('通知加载失败')).toBeInTheDocument()
    expect(screen.queryByText('暂无通知')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })

  it('显示审核通过的备注，点击通知进入对应申请并标记已读', async () => {
    server.use(
      http.get('/api/v1/student-applications', () =>
        HttpResponse.json({ code: 0, data: { items: [{ id: 46 }], total: 1 } }),
      ),
      http.get('/api/v1/student-applications/46', () =>
        HttpResponse.json({
          code: 0,
          data: {
            application: { id: 46, title: '测试剧' },
            progress_available: true,
            workflow: {
              reviews: [
                {
                  status: 2,
                  stage: 'script',
                  version: 2,
                  task_id: 'review-1',
                  reason: '请完善第九集',
                  finished_at: 1700000000,
                },
              ],
            },
          },
        }),
      ),
    )
    const user = userEvent.setup()
    renderBell()
    await user.click(screen.getByRole('button', { name: '通知' }))
    const notice = await screen.findByRole('button', { name: /剧本创意审核通过.*请完善第九集/ })
    expect(notice).toHaveTextContent('测试剧')
    await user.click(notice)
    expect(await screen.findByRole('heading', { name: '剧本申请详情' })).toBeInTheDocument()
    expect(window.localStorage.getItem('zzh-market-notify-read:v2:fact-user')).toContain(
      'script-approved-46-2-review-1',
    )
  })

  it('剧本接口失败时仍展示需求市场通知并提示重试', async () => {
    server.use(http.get('/api/v1/student-applications', () => HttpResponse.json({ code: 1 }, { status: 500 })))
    const user = userEvent.setup()
    renderBell()
    await user.click(screen.getByRole('button', { name: '通知' }))
    expect(await screen.findByRole('button', { name: /需求已完成/ })).toBeInTheDocument()
    expect(screen.getByText(/剧本消息加载失败/)).toBeInTheDocument()
  })

  it('剧本接口迟迟未完成时先显示已返回的需求通知', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/v1/student-applications', async () => {
        await pending
        return HttpResponse.json({ code: 0, data: { items: [], total: 0 } })
      }),
    )
    const user = userEvent.setup()
    renderBell()
    await user.click(screen.getByRole('button', { name: '通知' }))
    expect(await screen.findByRole('button', { name: /需求已完成/ })).toBeInTheDocument()
    expect(screen.getByText('剧本消息加载中…')).toBeInTheDocument()
    release()
    await waitFor(() => expect(screen.queryByText('剧本消息加载中…')).not.toBeInTheDocument())
  })

  it('剧本请求超时后显示失败与重试，已返回的需求通知仍可用', async () => {
    server.use(
      http.get('/api/v1/student-applications', async () => {
        await new Promise(() => {})
        return HttpResponse.json({ code: 0, data: { items: [], total: 0 } })
      }),
    )
    const user = userEvent.setup()
    renderBell()
    await user.click(screen.getByRole('button', { name: '通知' }))
    expect(await screen.findByRole('button', { name: /需求已完成/ })).toBeInTheDocument()
    expect(await screen.findByText(/剧本消息加载失败/, {}, { timeout: 15_000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeEnabled()
  }, 20_000)
})
