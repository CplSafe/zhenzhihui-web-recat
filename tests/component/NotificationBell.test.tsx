import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import NotificationBell from '@/components/layout/NotificationBell'
import { server } from '../mocks/server'

function installFactNotifications() {
  server.use(
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
    )
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByRole('button', { name: '通知' }))

    expect(await screen.findByText('通知加载失败')).toBeInTheDocument()
    expect(screen.queryByText('暂无通知')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })
})
