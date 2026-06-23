/**
 * 创意脚本与分镜数据处理
 * 核心解析逻辑：从 AI 生成的脚本文本中提取 <<<STORYBOARD_JSON>>> 标记内的分镜数据、
 * 截断 JSON 恢复、分镜词规范化、时间线构建、视频 Prompt 生成。
 */
const STORYBOARD_FALLBACK_TITLES = [
  '钩子＋一键操作起势',
  '支付确认＋成功释然',
  '交付信任蒙太奇',
  '价值呈现＋VO落句',
  '品牌记忆＋转化收束',
]

const MAX_STORYBOARDS = 9

const STORYBOARD_OPEN = '<<<STORYBOARD_JSON>>>'
const STORYBOARD_CLOSE = '<<<END_STORYBOARD_JSON>>>'

export function extractStoryboardPayload(scriptText) {
  if (!scriptText || typeof scriptText !== 'string') {
    return {
      storyboards: [],
      markdown: scriptText || '',
      jsonText: '',
      hasMarker: false,
    }
  }

  const found = locateStoryboardJson(scriptText)

  if (!found) {
    return {
      storyboards: [],
      markdown: scriptText,
      jsonText: '',
      hasMarker: false,
    }
  }

  const markdown = scriptText.slice(0, found.markdownEnd).trimEnd()
  const jsonText = found.jsonText

  if (!jsonText) {
    return { storyboards: [], markdown, jsonText: '', hasMarker: true }
  }

  let parsed

  try {
    parsed = JSON.parse(jsonText)
  } catch {
    parsed = salvageTruncatedJson(jsonText)
  }

  const rawList = Array.isArray(parsed)
    ? parsed
    : parsed?.storyboards || (parsed && typeof parsed === 'object' && (parsed.title || parsed.prompt) ? [parsed] : [])

  if (!Array.isArray(rawList) || !rawList.length) {
    return { storyboards: [], markdown, jsonText, hasMarker: true }
  }

  const storyboards = rawList
    .slice(0, MAX_STORYBOARDS)
    .map((item, index) => normalizeStoryboardItem(item, index))
    .filter(Boolean)

  return { storyboards, markdown, jsonText, hasMarker: true }
}

function locateStoryboardJson(text) {
  const openIdx = text.indexOf(STORYBOARD_OPEN)

  if (openIdx !== -1) {
    const afterOpen = text.slice(openIdx + STORYBOARD_OPEN.length)
    const closeIdx = afterOpen.indexOf(STORYBOARD_CLOSE)
    const body = closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx)
    return {
      markdownEnd: openIdx,
      jsonText: body.trim(),
    }
  }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)

  if (fenceMatch && /storyboards?\s*"?\s*:|^\s*\[/.test(fenceMatch[1])) {
    return {
      markdownEnd: fenceMatch.index,
      jsonText: fenceMatch[1].trim(),
    }
  }

  const openFence = text.search(/```json/i)

  if (openFence !== -1) {
    return {
      markdownEnd: openFence,
      jsonText: text
        .slice(openFence)
        .replace(/^```json\s*/i, '')
        .trim(),
    }
  }

  const braceMatch = text.match(/\{\s*"storyboards"/)

  if (braceMatch) {
    return {
      markdownEnd: braceMatch.index,
      jsonText: text.slice(braceMatch.index).trim(),
    }
  }

  const arrayStart = text.search(/\[\s*\{\s*"title"/)

  if (arrayStart !== -1) {
    return {
      markdownEnd: arrayStart,
      jsonText: text.slice(arrayStart).trim(),
    }
  }

  return null
}

function salvageTruncatedJson(content) {
  const trimmed = (content || '').trim()

  if (!trimmed) {
    return null
  }

  const arrayStart = trimmed.indexOf('[')

  if (arrayStart === -1) {
    return null
  }

  const objects = []
  let depth = 0
  let inString = false
  let escape = false
  let objectStart = -1

  for (let i = arrayStart + 1; i < trimmed.length; i += 1) {
    const ch = trimmed[i]

    if (escape) {
      escape = false
      continue
    }

    if (ch === '\\' && inString) {
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (ch === '{') {
      if (depth === 0) {
        objectStart = i
      }
      depth += 1
      continue
    }

    if (ch === '}') {
      depth -= 1

      if (depth === 0 && objectStart !== -1) {
        const segment = trimmed.slice(objectStart, i + 1)

        try {
          objects.push(JSON.parse(segment))
        } catch {
          // Skip malformed object.
        }

        objectStart = -1
      }
    }
  }

  if (!objects.length) {
    return null
  }

  return { storyboards: objects }
}

export function buildFallbackStoryboards(blueprintTitles = STORYBOARD_FALLBACK_TITLES) {
  return blueprintTitles.slice(0, MAX_STORYBOARDS).map((title, index) => ({
    title,
    prompt: '',
    duration: 2,
    voiceover: '',
    subtitle: '',
    sfx: '',
    index,
  }))
}

export function buildTimelineSegments(storyboards = []) {
  let cursor = 0

  return storyboards.map((board, index) => {
    const duration = clampDuration(board?.duration, 2)
    const start = Number(cursor.toFixed(2))
    const end = Number((cursor + duration).toFixed(2))
    cursor = end

    return {
      id: `segment-${index + 1}`,
      storyboardIndex: index,
      start,
      end,
      voiceover: typeof board?.voiceover === 'string' ? board.voiceover : '',
      subtitle: typeof board?.subtitle === 'string' ? board.subtitle : '',
      sfx: typeof board?.sfx === 'string' ? board.sfx : '',
    }
  })
}

export function buildTimelineTracks(storyboards = []) {
  const segments = buildTimelineSegments(storyboards)

  return {
    segments,
    voiceover: segments
      .filter((segment) => segment.voiceover)
      .map((segment, index) => ({
        id: `voice-${index + 1}`,
        start: segment.start,
        end: segment.end,
        text: segment.voiceover,
      })),
    subtitle: segments
      .filter((segment) => segment.subtitle)
      .map((segment, index) => ({
        id: `subtitle-${index + 1}`,
        start: segment.start,
        end: segment.end,
        text: segment.subtitle,
      })),
    sfx: segments
      .filter((segment) => segment.sfx)
      .map((segment, index) => ({
        id: `sfx-${index + 1}`,
        start: segment.start,
        end: segment.end,
        text: segment.sfx,
      })),
  }
}

export function getTimelineDuration(timeline) {
  if (!timeline) {
    return 0
  }

  const sources = [
    ...(timeline.segments || []),
    ...(timeline.voiceover || []),
    ...(timeline.subtitle || []),
    ...(timeline.sfx || []),
  ]

  return sources.reduce((max, item) => Math.max(max, Number(item?.end) || 0), 0)
}

export function buildVideoPromptFromTimeline({ basePrompt, storyboards = [], timeline, ratio, styleText }) {
  const segments = timeline?.segments || []

  const lines = [
    '请按照下面的时间线生成一条短视频广告，逐段对齐画面、旁白、字幕、音效。',
    basePrompt ? `广告描述：${basePrompt}` : '',
  ]

  segments.forEach((segment, index) => {
    const board = storyboards[index] || storyboards[segment.storyboardIndex] || {}
    const visualPrompt = board.prompt || board.title || `分镜 ${index + 1}`
    const fragments = [`图${index + 1}（${segment.start}-${segment.end}s）：${visualPrompt}`]

    const overlap = (track) =>
      (track || [])
        .filter((entry) => entry.start < segment.end && entry.end > segment.start)
        .map((entry) => entry.text)
        .filter(Boolean)
        .join(' / ')

    const voice = overlap(timeline?.voiceover) || segment.voiceover
    const subtitle = overlap(timeline?.subtitle) || segment.subtitle
    const sfx = overlap(timeline?.sfx) || segment.sfx

    if (voice) {
      fragments.push(`旁白：「${voice}」`)
    }

    if (subtitle) {
      fragments.push(`字幕：「${subtitle}」`)
    }

    if (sfx) {
      fragments.push(`音效：${sfx}`)
    }

    lines.push(fragments.join('；'))
  })

  const totalDuration = getTimelineDuration(timeline)

  if (totalDuration > 0) {
    lines.push(`总时长：${totalDuration}s。`)
  }

  if (ratio) {
    lines.push(`画面比例：${ratio}。`)
  }

  if (styleText) {
    lines.push(`整体风格：${styleText}。`)
  }

  return lines.filter(Boolean).join('\n')
}

function normalizeStoryboardItem(item, index) {
  if (!item || typeof item !== 'object') {
    return null
  }

  const title = pickString(item.title, item.name, item.shot, item.heading)
  const prompt = pickString(item.prompt, item.visual, item.scene, item.description, item.image_prompt, item.imagePrompt)

  if (!title && !prompt) {
    return null
  }

  return {
    title: title || `分镜 ${index + 1}`,
    prompt: prompt || title || `分镜 ${index + 1}`,
    duration: clampDuration(item.duration ?? item.length ?? item.seconds, 2),
    voiceover: pickString(item.voiceover, item.voice_over, item.narration, item.vo),
    subtitle: pickString(item.subtitle, item.caption, item.text),
    sfx: pickString(item.sfx, item.sound_effect, item.sound, item.audio),
    index,
  }
}

function pickString(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = pickString(...value)
      if (nested) return nested
    }
    if (value && typeof value === 'object') {
      const nested = pickString(value.text, value.content, value.value)
      if (nested) return nested
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function clampDuration(value, fallback) {
  const num = Number(value)

  if (!Number.isFinite(num) || num <= 0) {
    return fallback
  }

  return Math.min(Math.max(num, 0.5), 12)
}
