/**
 * 智能成片 — AI 图片生成(Qwen-Image,OpenAI 兼容 /v1/images/generations,经 /aimodel-img 代理)。
 * 用于「AI 自动生成」素材/分镜图:按提示词出图,返回可直接渲染的 data URL。
 */
// @ts-nocheck
const ENDPOINT = '/aimodel-img/v1/images/generations'
const MODEL = (import.meta.env.VITE_AI_IMG_NAME as string) || 'Qwen-Image'

/** 画面比例 → 生成尺寸 */
export function sizeForRatio(ratio?: string): string {
  switch (ratio) {
    case '16:9':
      return '1280x720'
    case '9:16':
      return '720x1280'
    case '4:3':
      return '1024x768'
    case '3:4':
      return '768x1024'
    default:
      return '1024x1024'
  }
}

export async function generateImage(input: {
  prompt: string
  size?: string
  signal?: AbortSignal
}): Promise<string> {
  const prompt = (input.prompt || '').trim()
  if (!prompt) throw new Error('提示词为空')
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({ model: MODEL, prompt, n: 1, size: input.size || '1024x1024' }),
  })
  if (!res.ok) throw new Error(`图片生成失败(${res.status})`)
  const data = await res.json()
  const item = data?.data?.[0] || {}
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
  if (item.url) return item.url
  throw new Error('图片生成返回为空')
}
