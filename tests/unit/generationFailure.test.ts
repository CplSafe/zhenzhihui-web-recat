import { afterEach, describe, expect, it, vi } from 'vitest'
import { BusinessApiError, updateWorkspace, waitForAiTask } from '@/api/business'
import {
  archiveGenerationFailure,
  buildGenerationFailure,
  failureIdentifiers,
  formatGenerationFailure,
  generationSubmissionFingerprint,
  unknownSubmissionKey,
} from '@/utils/generationFailure'
import { elementsToGraph, nodeToMutation } from '@/utils/canvasElements'

afterEach(() => vi.unstubAllGlobals())

describe('generation failure diagnostics', () => {
  it('reuses an uncertain submission after refresh only when its request stays unchanged', async () => {
    const fingerprint = await generationSubmissionFingerprint({ prompt: '篮球', params: { count: 4, size: '2K' } })
    const reordered = await generationSubmissionFingerprint({ params: { size: '2K', count: 4 }, prompt: '篮球' })
    const changed = await generationSubmissionFingerprint({ prompt: '足球', params: { count: 4, size: '2K' } })
    const taskFailure = buildGenerationFailure(new Error('网络超时'), { submitted: true, submissionId: 'stable-key' })
    const mutation = nodeToMutation({
      id: 'n',
      type: 'image',
      position: { x: 0, y: 0 },
      data: { kind: 'image', taskFailure, taskSubmissionFingerprint: fingerprint, taskIdempotencyKey: 'stable-key' },
    })
    const restored = elementsToGraph([mutation]).nodes[0].data
    expect(unknownSubmissionKey(restored, reordered)).toBe('stable-key')
    expect(unknownSubmissionKey(restored, changed)).toBe('')
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
  it('keeps the task identifier when waiting for an existing task times out', async () => {
    await expect(
      waitForAiTask({ workspaceId: 1, task: { id: 71, status: 'pending' }, timeoutMs: -1 }),
    ).rejects.toMatchObject({ taskId: '71' })
  })
  it('preserves long IDs as strings without guessing an unsafe numeric ID', () => {
    const id = '20261009175303221234538'
    expect(failureIdentifiers({ response: { data: { task_id: id, request_id: 'req-1' } } })).toEqual({
      taskId: id,
      requestId: 'req-1',
    })
    expect(failureIdentifiers({ task_id: Number(id) }).taskId).toBeUndefined()
  })

  it('keeps the created task ID from a terminal task error', () => {
    const error = new BusinessApiError('内容审核失败', { response: { id: 71, status: 'failed', trace_id: 'trace-1' } })
    expect(buildGenerationFailure(error, { submitted: true })).toMatchObject({
      taskId: '71',
      requestId: 'trace-1',
      stage: 'task',
    })
  })

  it('distinguishes local validation, service rejection and uncertain network submissions', () => {
    expect(buildGenerationFailure(new Error('请填写提示词')).stage).toBe('local')
    expect(buildGenerationFailure({ message: '权限不足', status: 403 }, { submitted: true }).stage).toBe('rejected')
    expect(
      buildGenerationFailure({ message: '网络超时' }, { submitted: true, submissionId: 'submission-1' }),
    ).toMatchObject({ stage: 'unknown', submissionId: 'submission-1' })
  })

  it('extracts the server request header on an error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: '参数错误' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'backend-request-42' },
        }),
      ),
    )
    await expect(updateWorkspace({ workspaceId: 1, name: '团队' })).rejects.toMatchObject({
      requestId: 'backend-request-42',
    })
  })

  it('archives the prior failure through canvas serialization without exposing raw payloads', () => {
    const failure = buildGenerationFailure(
      { message: '失败', response: { task_id: '71', token: 'secret' } },
      { submitted: true, failedAt: '2026-10-09T08:00:00Z' },
    )
    const history = archiveGenerationFailure({ taskFailure: failure, taskStatus: 'failed' })
    const mutation = nodeToMutation({
      id: 'node-1',
      type: 'image',
      position: { x: 0, y: 0 },
      data: { kind: 'image', taskFailureHistory: history },
    })
    const restored = elementsToGraph([{ ...mutation, kind: 'node' }])
    expect(restored.nodes[0].data.taskFailureHistory).toEqual([failure])
    expect(formatGenerationFailure(failure)).toContain('TaskID：71')
    expect(formatGenerationFailure(failure)).not.toContain('secret')
    expect(archiveGenerationFailure({ taskFailureHistory: history, taskStatus: 'succeeded' })).toEqual(history)
  })
})
