export interface CanvasSubjectSelectionBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Convert the visible alpha coverage to coordinates in [0, 1] on the source image. */
export function readSelectionBounds(mask: ImageData): CanvasSubjectSelectionBounds | undefined {
  const { width, height, data } = mask
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!data[(y * width + x) * 4 + 3]) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) return undefined
  return { x: left / width, y: top / height, width: (right + 1 - left) / width, height: (bottom + 1 - top) / height }
}

/** Fill only the four-connected region near the clicked color. The input is a bounded preview, never the full image. */
export function createConnectedColorMask(image: ImageData, output: ImageData, x: number, y: number): boolean {
  const { width, height, data } = image
  const start = y * width + x
  const offset = start * 4
  const [red, green, blue, alpha] = data.subarray(offset, offset + 4)
  if (!alpha) return false
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(visited.length)
  let count = 0

  function enqueue(pixel: number) {
    if (visited[pixel]) return
    visited[pixel] = 1
    const index = pixel * 4
    const dr = data[index] - red
    const dg = data[index + 1] - green
    const db = data[index + 2] - blue
    if (!data[index + 3] || Math.abs(data[index + 3] - alpha) > 32 || dr * dr + dg * dg + db * db > 48 ** 2) return
    output.data[index + 1] = 229
    output.data[index + 2] = 190
    output.data[index + 3] = 255
    queue[count] = pixel
    count += 1
  }

  enqueue(start)
  for (let index = 0; index < count; index += 1) {
    const pixel = queue[index]
    const column = pixel % width
    if (column > 0) enqueue(pixel - 1)
    if (column < width - 1) enqueue(pixel + 1)
    if (pixel >= width) enqueue(pixel - width)
    if (pixel < width * (height - 1)) enqueue(pixel + width)
  }
  return count > 0
}
