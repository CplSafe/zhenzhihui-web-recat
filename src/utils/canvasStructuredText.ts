export type CanvasStoryboardItem = {
  title: string
  prompt: string
  duration?: string
  shot?: string
}

export type CanvasStructuredText =
  | { kind: 'storyboard'; items: CanvasStoryboardItem[] }
  | { kind: 'plain'; text: string }

const STORYBOARD_MARKER = /<<<\s*STORYBOARD_JSON\s*>>>/gi

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function normalizeStoryboardItem(value: unknown, index: number): CanvasStoryboardItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const title = asText(item.title || item.name || item.shot_title || item.scene_title) || `镜头 ${index + 1}`
  const prompt = asText(
    item.prompt ||
      item.desc ||
      item.description ||
      item.content ||
      item.visual ||
      item.scene ||
      item.scene_description ||
      item.visual_description ||
      item.image_prompt,
  )
  if (!prompt && !asText(item.title || item.name || item.shot_title || item.scene_title)) return null
  const durationValue = item.duration ?? item.seconds ?? item.duration_seconds
  const shotValue = item.shot ?? item.camera ?? item.shot_type ?? item.camera_movement
  return {
    title,
    prompt,
    duration: asText(durationValue),
    shot: asText(shotValue),
  }
}

function extractJsonCandidate(text: string): string {
  const withoutMarker = text.replace(STORYBOARD_MARKER, '').trim()
  const withoutFence = withoutMarker
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const arrayStart = withoutFence.indexOf('[')
  const arrayEnd = withoutFence.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) return withoutFence.slice(arrayStart, arrayEnd + 1)
  const objectStart = withoutFence.indexOf('{')
  const objectEnd = withoutFence.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) return withoutFence.slice(objectStart, objectEnd + 1)
  return withoutFence
}

/**
 * 将模型返回的分镜 JSON 转为适合画布展示的数据。
 * 原始文本仍由节点保存；解析失败时仅去掉协议标记并按普通文本展示。
 */
export function parseCanvasStructuredText(value: unknown): CanvasStructuredText {
  const original = asText(value)
  if (!original) return { kind: 'plain', text: '' }
  const candidate = extractJsonCandidate(original)
  try {
    const parsed = JSON.parse(candidate) as unknown
    const records = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? ((parsed as Record<string, unknown>).storyboard ??
          (parsed as Record<string, unknown>).shots ??
          (parsed as Record<string, unknown>).scenes ??
          [])
        : []
    const items = Array.isArray(records)
      ? records.map(normalizeStoryboardItem).filter((item): item is CanvasStoryboardItem => Boolean(item))
      : []
    if (items.length > 0) return { kind: 'storyboard', items }
  } catch {
    // 非法或被截断的 JSON 继续按普通文本展示，避免隐藏模型实际返回内容。
  }
  return { kind: 'plain', text: original.replace(STORYBOARD_MARKER, '').trim() }
}

export function isCanvasStoryboardText(value: unknown): boolean {
  const parsed = parseCanvasStructuredText(value)
  return parsed.kind === 'storyboard' && parsed.items.every((item) => Boolean(item.prompt.trim()))
}

/** Keep the user's brief separate from the generated JSON contract. */
export function buildCanvasStoryboardPrompt(brief: string): string {
  return [
    '你是视频分镜策划。根据用户需求和参考素材生成可用于视频生成的分镜提示词。',
    '仅返回 JSON 数组，不要 Markdown 或解释。每个镜头包含 title、prompt、duration、shot。',
    'prompt 必须描述主体、场景、动作、光线和风格；shot 描述运镜，duration 为秒数。',
    '保持镜头间主体和风格一致，遵守用户指定的总时长；未指定时规划一段简短视频。',
    '不要要求画面生成字幕、文字或水印。不要臆造参考素材中不存在的身份信息。',
    `用户需求：\n${brief.trim()}`,
  ].join('\n')
}

/** Convert internal structured text into neutral, readable downstream context. */
export function toCanvasPromptContext(value: unknown): string {
  const parsed = parseCanvasStructuredText(value)
  if (parsed.kind === 'plain') return parsed.text

  return parsed.items
    .map((item, index) => {
      const meta = [item.duration ? `时长 ${item.duration}` : '', item.shot ? `镜头 ${item.shot}` : '']
        .filter(Boolean)
        .join('，')
      return `${index + 1}. ${item.title}${meta ? `（${meta}）` : ''}\n${item.prompt}`
    })
    .join('\n\n')
}
