/**
 * 语音转文字(创作入口的语音输入)。
 * - POST /api/v1/ai/speech/transcriptions  multipart:file(录音)+ language + context
 * 后端调阿里云百炼 qwen3-asr-flash,浏览器只负责录音,不接触供应商凭证。
 * 走 requestBusinessJson:同源 cookie、30s 超时、401 静默续期重试、业务信封解包与 BusinessApiError 归一。
 */
import { BusinessApiError, requestBusinessJson } from './business'

/** 语音识别结果。text 为空串表示没听到有效语音(不是错误)。 */
export interface SpeechTranscription {
  text: string
  language: string
  seconds: number
}

export interface TranscribeAudioOptions {
  /** 语种提示,如 zh / en;留空由模型自动识别。 */
  language?: string
  /** 热词上下文(产品名、专有名词等),提升专有名词识别率。 */
  context?: string
  signal?: AbortSignal
}

/** 后端 message 已是可展示的中文;只有鉴权失败的文案是面向接口的,这里换成面向语音入口的。 */
const UNAUTHORIZED_MESSAGE = '请先登录后再使用语音输入'

/** 上传一段录音并返回识别文本;失败时抛出 BusinessApiError(取消时 cause 为 'aborted')。 */
export async function transcribeAudio(audio: Blob, options: TranscribeAudioOptions = {}): Promise<SpeechTranscription> {
  if (!audio || audio.size === 0) {
    throw new BusinessApiError('录音为空，请再说一次', { status: 400, code: 'EMPTY_AUDIO' })
  }
  const form = new FormData()
  // 后端只认 part 的 Content-Type(取自 Blob.type),文件名无人消费。
  form.append('file', new File([audio], 'voice', { type: audio.type }))
  if (options.language) form.append('language', options.language)
  if (options.context) form.append('context', options.context)

  let data: any
  try {
    data = await requestBusinessJson<any>('/api/v1/ai/speech/transcriptions', {
      method: 'POST',
      body: form,
      signal: options.signal,
    })
  } catch (error: any) {
    // BusinessApiError.code 存的是数字业务码,鉴权失败按 HTTP 状态判定即可(续期失败后才会走到这里)。
    if (error?.status === 401) {
      throw new BusinessApiError(UNAUTHORIZED_MESSAGE, {
        status: error.status,
        code: error.code,
        response: error.response,
      })
    }
    throw error
  }
  return {
    text: String(data?.text ?? '').trim(),
    language: String(data?.language ?? ''),
    seconds: Number(data?.seconds) || 0,
  }
}
