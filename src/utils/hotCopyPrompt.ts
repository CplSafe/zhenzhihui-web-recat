/**
 * 爆款复刻（video.replicate）提示词。
 *
 * 替换意图主要靠输入素材表达（源视频 role:video + 主体图 role:image），文字负责说清三件事：
 * 保留什么、替换什么、替换进去的东西必须长什么样。产品外观锁定是最重要的一条——
 * 模型不知道参考图是「必须原样保留的产品」还是「风格参考」时，换进去的产品会变色、变形、换 logo。
 * 禁文字硬约束由调用方用 withNoOnscreenTextGuard 统一追加，这里不重复。
 */

export type HotCopyPromptTab = 'remake' | 'replica'

export interface HotCopyPromptProduct {
  /** blurred 表示参考图检测到人脸：这是换人而非换产品，措辞要跟着变。 */
  faceCheckStatus?: 'blurred' | 'no_face'
  isVideo?: boolean
}

export interface HotCopyPromptArgs {
  tab: HotCopyPromptTab
  text?: string
  products?: readonly HotCopyPromptProduct[]
  /** 入口的背景音开关；undefined 表示模型不支持该参数，不提音频。 */
  generateAudio?: boolean
}

/** 源视频普遍带字幕/贴字，模型照抄只会渲染成乱码。 */
export const NO_SOURCE_OVERLAY_REQUIREMENT = '源视频中的字幕、贴字与水印不要复刻。'

/** 在提示词末尾追加禁复刻贴字约束；已包含时原样返回。 */
export function withNoSourceOverlayGuard(prompt: string): string {
  const text = String(prompt || '').trim()
  if (!text) return NO_SOURCE_OVERLAY_REQUIREMENT
  if (text.includes(NO_SOURCE_OVERLAY_REQUIREMENT)) return text
  return `${text}\n${NO_SOURCE_OVERLAY_REQUIREMENT}`
}

export function buildHotCopyReplicatePrompt(args: HotCopyPromptArgs): string {
  const text = String(args.text || '').trim()
  const images = (args.products || []).filter((product) => !product?.isVideo)
  const hasFace = images.some((product) => product?.faceCheckStatus === 'blurred')
  const subject = hasFace ? '人物' : '产品'
  const lines: string[] = []

  if (text) lines.push(text)

  if (args.tab === 'replica') {
    lines.push('任务:精准复刻。尽量 1:1 还原源视频的画面内容、镜头顺序、时长节奏、运镜方式、场景与光线。')
    if (images.length) lines.push(`参考图仅用于统一画面中${subject}的外观,不改变源视频的构图与动作。`)
  } else {
    lines.push('任务:同款翻拍。保留源视频的镜头顺序、时长节奏、运镜方式、场景与光线。')
    if (images.length) {
      lines.push(`将源视频中的主体${subject}替换为参考图中的${subject},其余画面元素保持不变。`)
    } else {
      lines.push('保留源视频的爆点结构与主体,按上述要求重新演绎。')
    }
  }

  if (images.length) {
    if (hasFace) {
      lines.push(
        '参考图为需要替换进画面的人物:保持其面部特征、发型、体型与服装一致,在所有镜头中身份稳定,不得中途换人或面部漂移。',
      )
    } else {
      lines.push(
        '替换后的产品必须与参考图外观完全一致:颜色、形状、比例、品牌标识、材质与可动部件不得改变,在所有镜头中保持稳定,不得变形、模糊或中途换款。',
      )
    }
    if (images.length > 1) {
      lines.push(`多张参考图为同一${subject}的不同角度,请综合它们理解其完整三维外观,而不是当作多个不同${subject}。`)
    }
    // 爆款视频大量是手持展示,手与产品的接触正是变形高发区
    lines.push(
      `画面中出现手持、拿起、递出或操作${subject}时,手指与${subject}的接触部位、遮挡关系和受力方向在相邻帧间连续稳定,${subject}始终贴合手部运动轨迹,不得穿模、悬浮或滑脱。`,
    )
  }

  if (args.generateAudio === false) {
    lines.push('不要生成任何人声、旁白与背景音乐。')
  } else if (args.generateAudio === true) {
    // 只提「匹配画面」，不禁人声：此前写过「不复刻源视频中的人声」，模型把自己生成配音也一并停了，
    // 用户失去了原本有的旁白效果。模型生成的声音本就不是源视频原声，无需再防复刻。
    lines.push('可生成与画面内容匹配的配音与背景音乐,节奏贴合画面剪辑点。')
  }

  lines.push(NO_SOURCE_OVERLAY_REQUIREMENT)
  return lines.join('\n')
}
