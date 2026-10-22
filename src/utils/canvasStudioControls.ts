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
  if (code === 'image.multi_angle') {
    const horizontal = Number(values.horizontal_angle ?? 0)
    const vertical = Number(values.vertical_angle ?? 0)
    const zoom = Number(values.zoom ?? 5)
    const yaw = Number.isFinite(horizontal) ? Math.round(wrapStudioAngle(horizontal)) : 0
    const pitch = Number.isFinite(vertical) ? Math.round(vertical) : 0
    const framing = zoom >= 9 ? '极度特写' : zoom < 3.5 ? '远景' : zoom > 6.5 ? '近景' : '中景'
    const views = [
      '沿原机位方向观察',
      '右前侧观察，呈现侧面与遮挡关系',
      '右侧观察，以侧面轮廓和侧向纵深为主',
      '右后侧观察，展示背侧表面',
      '背面观察，人物以背影和后脑为主',
      '左后侧观察，展示背侧表面',
      '左侧观察，以侧面轮廓和侧向纵深为主',
      '左前侧观察，呈现侧面与遮挡关系',
    ]
    const view = views[Math.round(yaw / 45) % views.length]
    const elevation = pitch > 0 ? '增加顶部可见面积' : pitch < 0 ? '呈现底部可见面' : '保持原拍摄高度'
    return [
      `以参考图机位为0°，水平环绕${yaw}°，${pitch > 0 ? '俯拍' : pitch < 0 ? '仰拍' : '平视'}${Math.abs(pitch)}°，${framing}构图。`,
      `${view}；${elevation}。`,
      zoom >= 9 ? '极度特写镜头，广角镜头，边缘带有鱼眼畸变效果。' : '',
      '保持主体身份，主体姿态和朝向保持；不锁定原构图、可见面或背景位置。不要用平移裁切、镜像代替机位变化。',
      text,
    ]
      .filter(Boolean)
      .join('\n')
  }
  if (code === 'image.relight' && values.mode === 'manual') {
    const position = studioLightPosition(values.key_light)
    const azimuth = Number.isFinite(values.light_azimuth) ? Number(values.light_azimuth) : position.light_azimuth
    const elevation = Number.isFinite(values.light_elevation)
      ? Number(values.light_elevation)
      : position.light_elevation
    const color = /^#[0-9a-f]{6}$/i.test(String(values.color || '')) ? String(values.color) : ''
    return [
      '以本次输入图片为编辑底图，保留已有光源的方向、颜色和光照效果，包括已有彩色边光；本次仅新增一盏局部补光，不替换或重新设计原有布光。工具参数中的光向、亮度和颜色仅描述本次新增光源。',
      `新增光源相对画面机位的水平角为${Math.round(wrapStudioAngle(azimuth))}°，俯仰角为${Math.round(elevation)}°（0°正面、90°画面右侧、180°背后、270°画面左侧，正俯仰位于上方）。使新增光源的受光面、遮挡、投影和高光一致，不镜像左右方向，不增加可见灯具。`,
      color ? `新增光源颜色为${color}，仅影响实际受光区域，保留其余区域的原有色彩；不要把整张图片染成该颜色。` : '',
      '保持原图人物身份、五官、姿态、服装、构图与背景结构，保留发丝、皮肤和织物的清晰细节及自然纹理。只调整必要的局部光影，不添加颗粒、噪点、模糊、过度磨皮或锐化光晕，避免高光过曝。',
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
