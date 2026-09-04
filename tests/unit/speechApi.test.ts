import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BusinessApiError } from '@/api/business'
import { transcribeAudio } from '@/api/speech'
import { server } from '../mocks/server'

const ENDPOINT = '/api/v1/ai/speech/transcriptions'

describe('transcribeAudio', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('times out a stalled upload as a TIMEOUT error and keeps caller cancellation as AbortError', async () => {
    vi.useFakeTimers()
    // 模拟一个只会响应 abort 的挂起 fetch:代理卡住时就是这个样子。
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )

    const stalled = transcribeAudio(new Blob(['a'], { type: 'audio/webm' }))
    const timedOut = expect(stalled).rejects.toMatchObject({ name: 'BusinessApiError', cause: 'timeout' })
    await vi.advanceTimersByTimeAsync(30_000)
    await timedOut

    const controller = new AbortController()
    const cancelled = transcribeAudio(new Blob(['a'], { type: 'audio/webm' }), { signal: controller.signal })
    const aborted = expect(cancelled).rejects.toMatchObject({ name: 'BusinessApiError', cause: 'aborted' })
    controller.abort()
    await aborted
  })

  it('posts the recording as multipart with language and context, and normalizes the result', async () => {
    let fileType = ''
    let language = ''
    let context = ''
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const form = await request.formData()
        const file = form.get('file') as File
        // 文件名与字节数不断言:jsdom 的 Blob/File 经 Node fetch 序列化后名字会丢成 blob、正文会变成字符串 "undefined",
        // 浏览器里不会;后端只看 part 的 Content-Type,这里只验证 MIME。
        fileType = file.type
        language = String(form.get('language') || '')
        context = String(form.get('context') || '')
        return HttpResponse.json({ code: 0, data: { text: '  做一条带货视频 ', language: 'zh', seconds: '4' } })
      }),
    )

    const blob = new Blob(['opus'], { type: 'audio/webm;codecs=opus' })
    const result = await transcribeAudio(blob, { language: 'zh', context: '帧智汇' })

    expect(result).toEqual({ text: '做一条带货视频', language: 'zh', seconds: 4 })
    expect(fileType).toBe('audio/webm;codecs=opus')
    expect(language).toBe('zh')
    expect(context).toBe('帧智汇')
  })

  it('keeps the Safari mp4 type and omits empty optional fields', async () => {
    let fileType = ''
    let hasLanguage = true
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const form = await request.formData()
        fileType = (form.get('file') as File).type
        hasLanguage = form.has('language')
        return HttpResponse.json({ code: 0, data: { text: 'hi' } })
      }),
    )
    const result = await transcribeAudio(new Blob(['a'], { type: 'audio/mp4' }))
    expect(fileType).toBe('audio/mp4')
    expect(hasLanguage).toBe(false)
    expect(result).toEqual({ text: 'hi', language: '', seconds: 0 })
  })

  it('rejects an empty recording without hitting the network', async () => {
    let called = false
    server.use(
      http.post(ENDPOINT, () => {
        called = true
        return HttpResponse.json({ code: 0, data: { text: 'x' } })
      }),
    )
    await expect(transcribeAudio(new Blob([], { type: 'audio/webm' }))).rejects.toMatchObject({ code: 'EMPTY_AUDIO' })
    expect(called).toBe(false)
  })

  it.each([
    [503, 'SPEECH_NOT_CONFIGURED'],
    [413, 'SPEECH_AUDIO_TOO_LARGE'],
    [415, 'SPEECH_UNSUPPORTED_FORMAT'],
    [429, 'TOO_MANY_REQUESTS'],
    [502, 'SPEECH_PROVIDER_ERROR'],
  ])('passes HTTP %d %s through as a BusinessApiError with the server message', async (status, code) => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({ code: 10000 + status, code_string: code, message: '服务端文案' }, { status }),
      ),
    )
    const error = await transcribeAudio(new Blob(['a'], { type: 'audio/webm' })).catch((e) => e)
    expect(error).toBeInstanceOf(BusinessApiError)
    // 后端 message 已是中文,前端不再维护一份重复文案;字符串码在 response.code_string 里。
    expect(error).toMatchObject({ status, message: '服务端文案', response: { code_string: code } })
  })

  it('rewords a 401 for the voice entry after the silent session refresh also fails', async () => {
    let attempts = 0
    server.use(
      http.post(ENDPOINT, () => {
        attempts += 1
        return HttpResponse.json(
          { code: 10101, code_string: 'UNAUTHORIZED', message: 'access_token 无效' },
          { status: 401 },
        )
      }),
      http.all('/api/v1/auth/refresh', () =>
        HttpResponse.json({ code: 10101, code_string: 'UNAUTHORIZED' }, { status: 401 }),
      ),
    )
    await expect(transcribeAudio(new Blob(['a'], { type: 'audio/webm' }))).rejects.toMatchObject({
      status: 401,
      message: '请先登录后再使用语音输入',
      response: { code_string: 'UNAUTHORIZED' },
    })
    expect(attempts).toBe(1)
  })

  it('falls back to the server message for unknown codes and reports network failures', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({ code: 10400, code_string: 'BAD_REQUEST', message: '缺少录音文件' }, { status: 400 }),
      ),
    )
    await expect(transcribeAudio(new Blob(['a'], { type: 'audio/webm' }))).rejects.toMatchObject({
      status: 400,
      message: '缺少录音文件',
      response: { code_string: 'BAD_REQUEST' },
    })

    server.use(http.post(ENDPOINT, () => HttpResponse.error()))
    await expect(transcribeAudio(new Blob(['a'], { type: 'audio/webm' }))).rejects.toMatchObject({
      name: 'BusinessApiError',
      message: '网络请求失败，请检查接口服务或本地代理配置',
    })
  })
})
