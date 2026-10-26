export interface CanvasModelGuidance {
  tags: string[]
  scenario: string
}

/** 仅提供用途说明，不推断质量排名、速度或价格；费用由现有报价流程展示。 */
export function getCanvasModelGuidance(input: object, operation = ''): CanvasModelGuidance {
  const model = input as Record<string, unknown>
  const source = (model.source && typeof model.source === 'object' ? model.source : model) as Record<string, unknown>
  const identity = [model.displayName, source.display_name, source.name, source.model_code, source.model]
    .filter((value) => typeof value === 'string')
    .map((value) =>
      String(value)
        .toLowerCase()
        .replace(/[\s_.-]+/g, ''),
    )
  const matches = (pattern: RegExp) => identity.some((value) => pattern.test(value))
  if (matches(/seedream5/)) return { tags: ['指令理解', '创意生图'], scenario: '适合商品场景图、营销配图和分镜设计。' }
  if (matches(/nanobanana2/))
    return { tags: ['参考图编辑', '主体一致性'], scenario: '适合人物换场景、商品改图和系列配图。' }
  if (matches(/midjourney|^mj(?:v?\d|$)/))
    return { tags: ['风格探索', '视觉创意'], scenario: '适合概念设计、氛围图和创意海报底图。' }
  if (matches(/seedance25/)) return { tags: ['叙事创作', '参考控制'], scenario: '适合故事短片、多镜头内容和视频修改。' }
  if (matches(/seedance20/)) return { tags: ['多模态参考', '音画生成'], scenario: '适合广告镜头、剧情片段和产品展示。' }
  if (matches(/minimaxh3|海螺0?3/))
    return { tags: ['多模态理解', '视频创作'], scenario: '适合结合参考素材制作创意短片和内容再创作。' }
  if (operation === 'audio.tts' && matches(/minimax/))
    return { tags: ['声音表现', '旁白配音'], scenario: '适合广告口播、故事旁白和角色配音。' }
  if (matches(/seedtts20/)) return { tags: ['文本转语音'], scenario: '适合视频解说、产品介绍和日常内容配音。' }
  // 未确认型号的模型按实际操作能力说明用途，不从名称猜测优势。
  const uses: Record<string, CanvasModelGuidance> = {
    'image.text_to_image': { tags: ['文字生图'], scenario: '根据文字描述生成图片，适合创意配图和分镜草图。' },
    'image.image_to_image': { tags: ['参考图创作'], scenario: '结合已有图片生成新画面，适合改图和场景变化。' },
    'video.generate': { tags: ['视频生成'], scenario: '适合将创意与参考素材制作成视频片段。' },
    'video.edit': { tags: ['视频修改'], scenario: '适合围绕已有视频调整画面内容。' },
    'audio.tts': { tags: ['文本转语音'], scenario: '适合口播、视频解说和旁白配音。' },
    'audio.clone': { tags: ['音色克隆'], scenario: '适合使用参考声音制作配音，音色要求以当前模型为准。' },
    'audio.generate': { tags: ['音频生成'], scenario: '适合为视频和内容创作生成音频素材。' },
    'audio.music': { tags: ['音乐生成'], scenario: '适合为视频、广告和内容创作制作配乐。' },
    'image.upscale': { tags: ['清晰度提升'], scenario: '适合放大已有图片，用于低清素材整理和图片输出。' },
    'video.upscale': { tags: ['清晰度提升'], scenario: '适合放大已有视频，用于低清素材整理和成片输出。' },
    'responses.multimodal': { tags: ['内容理解', '文本创作'], scenario: '适合创意梳理、文案撰写和脚本构思。' },
  }
  const operations = Array.isArray(source.operation_codes) ? source.operation_codes : model.operationCodes
  return uses[operation] || (Array.isArray(operations) && uses[String(operations[0])]) || { tags: [], scenario: '' }
}
