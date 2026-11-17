import type { Node, XYPosition } from '@xyflow/react'
import { getNodeGroupId } from './canvasGrouping'
import { parseCanvasStructuredText } from './canvasStructuredText'

const LABEL_GAP = 16
const ALIGNED_LABEL_GAP = 8
const MAX_LABEL_GAP = 120
const MAX_ROW_LABEL_GAP = 168
const ROW_ALIGNMENT_TOLERANCE = 12
const MIN_ROW_GAP = 24
const MAX_ROW_REDUCTION = 32
const SECTION_HEADING_HEIGHT = 48
const SECTION_HEADING_GAP = 16
const NEARBY_SECTION_GAP = 320
const SHARE_POSITIONS_KEY = 'zzh:canvas-share:positions:v1:'

export function readShareNodePositions(token: string): Map<string, XYPosition> {
  const positions = new Map<string, XYPosition>()
  if (!token) return positions

  try {
    const items: unknown = JSON.parse(localStorage.getItem(SHARE_POSITIONS_KEY + token) || '[]')
    if (!Array.isArray(items)) return positions
    for (const item of items) {
      if (!Array.isArray(item)) continue
      const [id, x, y] = item
      if (typeof id === 'string' && Number.isFinite(x) && Number.isFinite(y)) positions.set(id, { x, y })
    }
  } catch {
    // 浏览器禁用存储或旧数据损坏时，使用发布时的布局。
  }
  return positions
}

export function saveShareNodePositions(token: string, moved: ReadonlyMap<string, XYPosition>): void {
  if (!token || !moved.size) return

  try {
    // 只合并这次拖动的节点，保留同一访客在其他标签页调整过的位置。
    const positions = readShareNodePositions(token)
    for (const [id, position] of moved) positions.set(id, position)
    const items = Array.from(positions, ([id, { x, y }]) => [id, x, y])
    localStorage.setItem(SHARE_POSITIONS_KEY + token, JSON.stringify(items))
  } catch {
    // 存储不可用时，当前页面仍可拖动节点。
  }
}

export function clearShareNodePositions(token: string): void {
  if (!token) return
  try {
    localStorage.removeItem(SHARE_POSITIONS_KEY + token)
  } catch {
    // 存储不可用时，仍可恢复当前页面的布局。
  }
}

function nodeSize(value: unknown): number {
  const size = Number(typeof value === 'string' ? value.replace(/px$/, '') : value)
  return Number.isFinite(size) && size > 0 ? size : 250
}

function shareNodeBounds(node: Node) {
  const width = nodeSize(node.style?.width ?? node.width)
  const height = nodeSize(node.style?.height ?? node.height)
  const { x, y } = node.position
  return { node, x, y, right: x + width, bottom: y + height, width, height }
}

type ShareNodeBounds = ReturnType<typeof shareNodeBounds>

function horizontalOverlap(a: ShareNodeBounds, b: ShareNodeBounds) {
  return Math.min(a.right, b.right) - Math.max(a.x, b.x)
}

function sectionHeadingAt(node: Node, x: number, y: number, width: number): Node {
  return {
    ...node,
    position: { x, y },
    style: { ...node.style, width, height: SECTION_HEADING_HEIGHT },
    data: { ...node.data, shareSectionHeading: true },
  }
}

/** 只读画布里，成排短标签靠近并对齐各自的视频节点。 */
export function alignSharedVideoLabels(nodes: Node[]): Node[] {
  const bounds = nodes.map(shareNodeBounds)
  const pairs = new Map<
    string,
    {
      label: (typeof bounds)[number]
      video: (typeof bounds)[number]
      gap: number
      directMatch: boolean
    }
  >()

  for (const label of bounds) {
    const body = label.node.data.text ?? label.node.data.prompt
    if (
      label.node.data.kind !== 'text' ||
      label.height > 88 ||
      typeof body !== 'string' ||
      !body.trim() ||
      body.trim().length > 80 ||
      /[\r\n]/.test(body.trim())
    ) {
      continue
    }

    let below: (typeof bounds)[number] | undefined
    for (const other of bounds) {
      if (
        other === label ||
        other.bottom <= label.bottom ||
        other.y > label.bottom + MAX_ROW_LABEL_GAP ||
        other.x >= label.right ||
        other.right <= label.x
      ) {
        continue
      }
      if (!below || other.y < below.y) below = other
    }
    if (!below || !['video', 'timeline'].includes(String(below.node.data.kind))) continue

    const gap = below.y - label.bottom
    const overlap =
      (Math.min(label.right, below.right) - Math.max(label.x, below.x)) / Math.max(label.width, below.width)
    if (gap < 0 || overlap < 0.72) continue

    const directMatch =
      label.height <= 64 &&
      gap <= MAX_LABEL_GAP &&
      overlap >= 0.8 &&
      getNodeGroupId(below.node) === getNodeGroupId(label.node)
    pairs.set(label.node.id, { label, video: below, gap, directMatch })
  }

  const matchedPairs = [...pairs.values()]
  const captions = new Map<string, Node>()
  const captionedVideos = new Set<string>()
  for (const pair of matchedPairs) {
    const { label, video } = pair
    const node = label.node
    const repeatedRow = matchedPairs.some(
      ({ video: peer }) =>
        Math.abs(peer.y - video.y) <= ROW_ALIGNMENT_TOLERANCE && (peer.right <= video.x || peer.x >= video.right),
    )
    if (repeatedRow) {
      const y = video.y - label.height - ALIGNED_LABEL_GAP
      const blocked = bounds.some(
        (other) =>
          other !== label &&
          other.x < video.right &&
          other.right > video.x &&
          other.y < y + label.height &&
          other.bottom > y,
      )
      if (blocked || captionedVideos.has(video.node.id)) continue
      captions.set(node.id, {
        ...node,
        position: { x: video.x, y },
        style: { ...node.style, width: video.width },
        data: { ...node.data, shareCaptionVideoId: video.node.id },
      })
      captionedVideos.add(video.node.id)
      continue
    }

    if (!pair.directMatch || captionedVideos.has(video.node.id)) continue
    captions.set(node.id, {
      ...node,
      position: pair.gap > LABEL_GAP ? { ...node.position, y: video.y - label.height - LABEL_GAP } : node.position,
      data: { ...node.data, shareTitleVideoId: video.node.id },
    })
    captionedVideos.add(video.node.id)
  }
  return nodes.map((node) => captions.get(node.id) ?? node)
}

/** 把垂直重叠的节点合为一条占用带，同时记录各带的水平范围。 */
function occupiedBands(nodes: ReturnType<typeof shareNodeBounds>[]) {
  const bands: { start: number; end: number; left: number; right: number; count: number }[] = []
  for (const node of [...nodes].sort((a, b) => a.y - b.y)) {
    const previous = bands[bands.length - 1]
    if (!previous || node.y > previous.end) {
      bands.push({ start: node.y, end: node.bottom, left: node.x, right: node.right, count: 1 })
      continue
    }
    previous.end = Math.max(previous.end, node.bottom)
    previous.left = Math.min(previous.left, node.x)
    previous.right = Math.max(previous.right, node.right)
    previous.count++
  }
  return bands
}

/** 只压缩相邻视频排之间的空白带，下方标签和视频一起平移。 */
export function tightenSharedVideoRows(nodes: Node[]): Node[] {
  const bounds = nodes.map(shareNodeBounds)
  const rows = occupiedBands(bounds.filter(({ node }) => node.data.kind === 'video'))
  if (rows.length < 2) return nodes

  const occupied = occupiedBands(bounds)
  const gaps = occupied.slice(1).map((band, index) => ({ top: occupied[index].end, bottom: band.start }))
  const cuts: { at: number; offset: number }[] = []
  for (let index = 1; index < rows.length; index++) {
    const upper = rows[index - 1]
    const lower = rows[index]
    if (upper.count < 2 || lower.count < 2) continue

    const overlap = Math.min(upper.right, lower.right) - Math.max(upper.left, lower.left)
    const narrowerWidth = Math.min(upper.right - upper.left, lower.right - lower.left)
    if (overlap < narrowerWidth * 0.6) continue

    // 优先压缩排间最大的空白，已贴近视频的短标签和播放区域都算在占用范围内。
    let largest: (typeof gaps)[number] | undefined
    for (const gap of gaps) {
      if (gap.top < upper.end || gap.bottom > lower.start) continue
      if (!largest || gap.bottom - gap.top > largest.bottom - largest.top) largest = gap
    }
    if (!largest) continue

    const height = largest.bottom - largest.top
    if (height <= MIN_ROW_GAP) continue
    const offset = Math.min(Math.round(height / 4), MAX_ROW_REDUCTION, height - MIN_ROW_GAP)
    cuts.push({ at: largest.bottom, offset })
  }
  if (!cuts.length) return nodes

  return nodes.map((node) => {
    const offset = cuts.reduce((total, cut) => (node.position.y >= cut.at ? total + cut.offset : total), 0)
    return offset ? { ...node, position: { ...node.position, y: node.position.y - offset } } : node
  })
}

/** 将视频分区的单行标题对齐。坐标只用于分享视图。 */
export function alignSharedVideoSectionHeadings(nodes: Node[]): Node[] {
  const bounds = nodes.map(shareNodeBounds)
  const captions = bounds
    .filter(({ node }) => typeof node.data.shareCaptionVideoId === 'string')
    .sort((a, b) => a.y - b.y)
  if (captions.length < 2) return nodes

  const headings = bounds.filter(({ node, width, height }) => {
    if (node.data.kind !== 'text' || node.data.shareCaptionVideoId || height > 120 || width < height * 4) {
      return false
    }
    const body = parseCanvasStructuredText(node.data.text || node.data.prompt)
    return body.kind === 'plain' && Boolean(body.text) && body.text.length <= 120 && !/[\r\n]/.test(body.text)
  })

  const changes = new Map<string, Node>()
  const sections: { originalY: number; y: number; right: number }[] = []
  for (const heading of headings) {
    const below = captions.filter(({ x, y, width }) => {
      const center = x + width / 2
      return (
        y >= heading.bottom && y <= heading.bottom + MAX_ROW_LABEL_GAP && center >= heading.x && center <= heading.right
      )
    })
    const first = below[0]
    if (!first) continue
    const row = below.filter(({ y }) => y - first.y <= ROW_ALIGNMENT_TOLERANCE)
    const left = Math.min(...row.map(({ x }) => x))
    const right = Math.max(...row.map((caption) => caption.right))
    const width = right - left
    const overlap = Math.min(heading.right, right) - Math.max(heading.x, left)
    if (row.length < 2 || overlap < Math.max(width, heading.width) * 0.8) continue

    const y = first.y - SECTION_HEADING_GAP - SECTION_HEADING_HEIGHT
    const top = Math.min(y, heading.y)
    const blocked = bounds.some(
      (other) => other !== heading && other.x < right && other.right > left && other.y < first.y && other.bottom > top,
    )
    if (blocked) continue

    changes.set(heading.node.id, sectionHeadingAt(heading.node, left, y, width))
    sections.push({ originalY: heading.y, y, right })
  }
  if (sections.length === 0) return nodes

  sections.sort((a, b) => b.right - a.right)
  const videos = bounds.filter(({ node }) => node.data.kind === 'video' || node.data.kind === 'timeline')
  for (const heading of headings) {
    if (changes.has(heading.node.id)) continue
    const section = sections.find(
      ({ originalY, right }) =>
        heading.x >= right &&
        heading.x - right <= NEARBY_SECTION_GAP &&
        Math.abs(heading.y - originalY) <= SECTION_HEADING_HEIGHT,
    )
    if (!section) continue

    const below = videos.filter(
      (video) =>
        video.y >= heading.bottom &&
        video.y <= heading.bottom + MAX_ROW_LABEL_GAP &&
        horizontalOverlap(heading, video) >= video.width * 0.8,
    )
    if (below.length !== 1) continue
    const [video] = below
    const videoY = Math.max(video.y, section.y + SECTION_HEADING_HEIGHT + SECTION_HEADING_GAP)

    // 仅当标题会贴住视频时向下留出间距，遇到其他节点则保留原来的排列。
    const blocked = bounds.some((other) => {
      if (other === heading || other === video) return false
      return (
        (horizontalOverlap(heading, other) > 0 && other.y < videoY && other.bottom > Math.min(section.y, heading.y)) ||
        (videoY > video.y &&
          horizontalOverlap(video, other) > 0 &&
          other.y < videoY + video.height &&
          other.bottom > video.bottom)
      )
    })
    if (blocked) continue

    const title = sectionHeadingAt(heading.node, heading.x, section.y, heading.width)
    changes.set(title.id, { ...title, data: { ...title.data, shareTitleVideoId: video.node.id } })
    if (videoY > video.y) changes.set(video.node.id, { ...video.node, position: { x: video.x, y: videoY } })
  }

  return nodes.map((node) => changes.get(node.id) ?? node)
}
