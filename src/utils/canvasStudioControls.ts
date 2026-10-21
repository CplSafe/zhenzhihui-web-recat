import type { ToolField } from '@/api/canvasTools'

export function studioCaptureSize(values: Record<string, unknown>): [number, number] {
  const width = Number(values.capture_width || 1920)
  const height = Number(values.capture_height || 1080)
  return [
    [1920, 1080],
    [1080, 1920],
    [1536, 1536],
  ].some(([w, h]) => w === width && h === height)
    ? [width, height]
    : [1920, 1080]
}

export function wrapStudioAngle(value: number): number {
  return ((value % 360) + 360) % 360
}

/** 仅提示明显的四角黑/透明遮幅；暗场等不确定内容不据此判为错误。 */
export function hasPanoramaFrame(data: ArrayLike<number>, width: number, height: number): boolean {
  if (width < 4 || height < 4 || data.length < width * height * 4) return false
  const dark = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return data[i + 3] < 16 || Math.max(data[i], data[i + 1], data[i + 2]) < 12
  }
  const corners = [
    [1, 1],
    [width - 2, 1],
    [1, height - 2],
    [width - 2, height - 2],
  ]
  return corners.every(([x, y]) => dark(x, y)) && !dark(Math.floor(width / 2), Math.floor(height / 2))
}
export function studioLightVector(azimuth: number, elevation: number): [number, number, number] {
  const a = (wrapStudioAngle(azimuth) * Math.PI) / 180
  const e = (Math.max(-89, Math.min(89, elevation)) * Math.PI) / 180
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]
}
export function studioLightPosition(direction: unknown): { light_azimuth: number; light_elevation: number } {
  const positions: Record<string, [number, number]> = {
    front: [0, 0],
    right: [90, 0],
    back: [180, 0],
    left: [270, 0],
    top: [0, 75],
    bottom: [0, -75],
  }
  const [light_azimuth, light_elevation] = positions[String(direction)] || positions.front
  return { light_azimuth, light_elevation }
}
/** v1 仍携带合法基础方向，连续角度通过同一请求的提示词补充，绝不伪造 v2 参数。 */
export function studioLightDirection(azimuth: number, elevation: number): string {
  if (elevation >= 55) return 'top'
  if (elevation <= -55) return 'bottom'
  return ['front', 'right', 'back', 'left'][Math.round(wrapStudioAngle(azimuth) / 90) % 4]
}
export function composeStudioPrompt(code: string, prompt: string, values: Record<string, unknown>): string {
  const text = prompt.trim()
  if (code === 'image.panorama')
    return [
      '将参考场景扩展为完整360°水平、180°垂直的等距柱状全景图（equirectangular），画幅2:1，单一光学中心。左右边缘无缝衔接，填满天顶和地面；不要鱼眼、圆形镜头、黑边、留白、相框、拼贴或重复人物。保持原场景光照、地平线及主体身份一致，人物仅出现一次且比例自然。',
      text,
    ]
      .filter(Boolean)
      .join('\n')
  if (code === 'image.multi_angle')
    return [
      '以同一主体为中心移动拍摄机位，按指定相机角度重新观察真实空间；保持身份、服装、物体结构及场景连续性。不要用平移裁切、镜像或鱼眼变形代替机位变化。',
      text,
    ]
      .filter(Boolean)
      .join('\n')
  if (
    code === 'image.relight' &&
    values.mode === 'manual' &&
    typeof values.light_azimuth === 'number' &&
    typeof values.light_elevation === 'number'
  ) {
    return [
      `主光围绕主体的水平角为${Math.round(wrapStudioAngle(values.light_azimuth))}°，俯仰角为${Math.round(values.light_elevation)}°（0°正面、90°右侧、180°背后、270°左侧，正俯仰位于上方）。请以此连续空间位置细化基础光向，使受光面、投影和高光一致；保留人物身份、服装、构图与背景，不增加可见灯具。`,
      text,
    ]
      .filter(Boolean)
      .join('\n')
  }
  return text
}

/** 仅选择模型声明支持的 2:1 档位；不把任意尺寸参数强塞给不同供应商。 */
export function panoramaModelDefaults(fields: ToolField[], defaults: Record<string, unknown>): Record<string, unknown> {
  const values = { ...defaults }
  for (const field of fields) {
    const options = (field.options || []).map((option) =>
      option && typeof option === 'object' ? (option as { value?: unknown }).value : option,
    )
    if (['ratio', 'aspect_ratio', 'aspectRatio'].includes(field.name) && options.includes('2:1'))
      values[field.name] = '2:1'
    if (field.name === 'size') {
      const match = options.find((o) => {
        const size = typeof o === 'string' ? o.match(/^(\d+)\s*[x*×]\s*(\d+)$/i) : null
        return size && Number(size[1]) === Number(size[2]) * 2
      })
      if (match) values.size = match
      else if (!options.length && field.type === 'string') {
        const format = `${field.default ?? ''} ${field.help ?? ''}`.match(/\d+\s*([x*×])\s*\d+/i)
        if (format) values.size = `2048${format[1]}1024`
      }
    }
  }
  return values
}
