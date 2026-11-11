import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { MediaRetry } from '@/components/director/MediaRetry'
import { createStudioAPI } from '@/components/director/studio'

const candidate = {
  task_id: 10,
  title: '角色参考',
  tool: 'model.generate_image',
  before: {
    model_version_id: 2,
    operation_code: 'image.text_to_image',
    prompt: 'Original adult lawyer',
    params: { quality: 'high' },
  },
}
const models = [
  {
    id: 2,
    model: 'old-model',
    operation_codes: ['image.text_to_image'],
    params_schema: { fields: [{ name: 'quality', options: ['high'] }] },
  },
  {
    id: 4,
    model: 'new-model',
    operation_codes: ['image.text_to_image'],
    params_schema: { fields: [{ name: 'ratio', default: '1:1', options: ['1:1', '2:3'] }] },
  },
]
const draft = {
  id: 'proposal',
  status: 'proposed',
  decision_id: 'decision',
  source: { task_id: 10 },
  estimated_credits: '7.5',
  after: { model_version_id: 4, prompt: 'Approved prompt', params: { ratio: '1:1' } },
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})

it('switches model with fresh parameters and atomically confirms and starts', async () => {
  const calls: string[] = [],
    reload = vi.fn().mockResolvedValue(undefined)
  server.use(
    http.get('*/api/runs/r/media-retries', () => HttpResponse.json({ candidates: [candidate], items: [] })),
    http.post('*/api/runs/r/media-retries', async ({ request }) => {
      const body = await request.json()
      expect(body).toMatchObject({ model_version_id: 4, task_id: 10, params: { ratio: '1:1' } })
      expect(JSON.stringify(body)).not.toContain('quality')
      calls.push('quote')
      return HttpResponse.json(draft)
    }),
    http.post('*/api/runs/r/media-retries/proposal/decision', async ({ request }) => {
      expect(await request.json()).toMatchObject({ decision: 'approve', start: true })
      calls.push('approve')
      return HttpResponse.json({ ...draft, status: 'approved' })
    }),
    http.post('*/api/runs/r/resume', () => {
      calls.push('resume')
      return HttpResponse.json({ ok: true })
    }),
  )
  render(<MediaRetry api={createStudioAPI()} runId="r" models={models} reload={reload} />)
  fireEvent.click(screen.getByText('重试失败素材 / 更换模型'))
  fireEvent.change(await screen.findByLabelText('重试模型'), { target: { value: '4' } })
  fireEvent.click(screen.getByText('查看预计积分'))
  await screen.findByText(/预计 7.5 积分/)
  expect(calls).toEqual(['quote'])
  fireEvent.click(screen.getByText('确认重试一次'))
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  expect(calls).toEqual(['quote', 'approve'])
})

it('reopens the actual approved model and prompt, not the failed original parameters', async () => {
  server.use(
    http.get('*/api/runs/r/media-retries', () =>
      HttpResponse.json({ candidates: [candidate], items: [{ ...draft, status: 'approved' }] }),
    ),
  )
  render(<MediaRetry api={createStudioAPI()} runId="r" models={models} reload={vi.fn()} />)
  fireEvent.click(screen.getByText('重试失败素材 / 更换模型'))
  expect(await screen.findByLabelText('重试模型')).toHaveValue('4')
  expect(screen.getByLabelText('提示词')).toHaveValue('Approved prompt')
  expect(screen.getByLabelText('ratio')).toHaveValue('"1:1"')
  expect(screen.getByLabelText('提示词')).toBeDisabled()
  expect(screen.getByText('恢复已批准的重试')).toBeVisible()
})
