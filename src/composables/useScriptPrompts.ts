/**
 * Composable: script prompt builders and AI request helpers.
 * Extracted from CreativeScriptView.vue to reduce the view's surface area.
 *
 * Uses the project's deps-injection pattern (same as useStoryboardGeneration).
 */
import { streamAiResponse, createAiResponse, getBusinessErrorMessage } from '@/api/business'
import { buildVideoPromptFromTimeline, extractStoryboardPayload } from '@/utils/creativeScript'
import { normalizeSeedanceRatio } from '@/utils/videoOptions'

const MAX_STORYBOARDS = 9

// 依赖注入：原 Vue 版本里这些是 ref，这里改为「返回当前值的 getter」以模拟 .value 读取。
interface ScriptPromptDeps {
  description: { value: string }
  generatedPrompt: { value: string }
  selectedDuration: { value: string }
  selectedRatio: { value: string }
  selectedStyles: { value: string[] }
  selectedMaterials: { value: any[] }
  creativeStoryboards: { value: any[] }
  getStoryboardItems: () => any[]
  timelineState: { value: any }
  modelPlanCandidates: { value: any }
  getWorkspaceIdOrNotify?: () => any
  showToast?: (...args: any[]) => any
}

export function useScriptPrompts(deps: ScriptPromptDeps) {
  const {
    // Reactive state (read directly via .value inside functions)
    description,
    generatedPrompt,
    selectedDuration,
    selectedRatio,
    selectedStyles,
    selectedMaterials,
    creativeStoryboards,
    getStoryboardItems,
    timelineState,
    modelPlanCandidates,
  } = deps

  const DEFAULT_GENERATING_PROMPT =
    '结合提供的素材图片，做一个买菜 APP 宣传视频，描述时请写清主体、动作、场景、镜头、光线、氛围和不要出现的元素'
  const MAX_SCRIPT_REFERENCE_IMAGES = 3

  function resolveStoryboardItems(): any[] {
    const items = typeof getStoryboardItems === 'function' ? getStoryboardItems() : []
    return Array.isArray(items) ? items : []
  }

  function isImageMaterial(material: any): boolean {
    const type = String(material?.type || '')
    const mimeType = String(material?.mimeType || material?.serverAsset?.mime_type || '')
    return type === 'image' || mimeType.startsWith('image/')
  }

  function getMaterialAssetId(material: any): number {
    const candidate = material?.assetId || material?.serverAsset?.id || material?.serverAsset?.asset_id || 0
    const id = Number(candidate || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }

  function buildCreativeScriptInputAssets() {
    const candidates = selectedMaterials.value.filter(isImageMaterial).slice(0, MAX_SCRIPT_REFERENCE_IMAGES)
    const assetIds = [...new Set(candidates.map((material) => getMaterialAssetId(material)).filter(Boolean))]
    return assetIds.map((assetId) => ({
      asset_id: assetId,
      role: 'image',
    }))
  }

  /** Build the composed creative prompt sent to the AI. */
  function buildCreativeScriptPrompt(basePrompt: string) {
    const materialNames = selectedMaterials.value.map((material) => material.name).filter(Boolean)
    const styleText = selectedStyles.value.join(' ')

    return [
      '你是一名短视频创意策划与分镜提示词专家。',
      `项目需求：${basePrompt || DEFAULT_GENERATING_PROMPT}`,
      `约束：时长 ${selectedDuration.value}，比例 ${selectedRatio.value}，风格 ${styleText}`,
      materialNames.length ? `参考素材：${materialNames.join('、')}` : '',
      '请优先围绕主体、动作、场景、构图、镜头角度、光线氛围、关键细节和限制项来理解需求，再生成后续脚本。',
    ]
      .filter(Boolean)
      .join('；')
  }

  /** Build a prompt for a single storyboard image generation. */
  function buildStoryboardPrompt(board: any, index: number, options: any = {}) {
    const { withReference = false, previousBoard = null, allPreviousBoards = [], nextBoard = null, afterBoards = [] } = options
    const styleText = selectedStyles.value.join(' ')
    const visual = board.prompt || board.title || `分镜 ${index + 1}`

    // 将用户上传的产品/素材名称注入 prompt，让 AI 知道画面主体
    const materialNames = selectedMaterials.value
      .map((m) => m.name || m.filename || m.originalName)
      .filter(Boolean)
    const productHint = materialNames.length ? `产品主体：${materialNames.join('、')}` : ''

    const contextLines: string[] = []
    if (nextBoard) {
      const nextVisual = nextBoard.prompt || nextBoard.title || ''
      const afterText = afterBoards.length > 0
        ? afterBoards.map((b: any, i: number) => `后续分镜${i + 1}：${b.prompt || b.title}`).join('；')
        : ''
      contextLines.push(
        `你是一张插入在分镜序列中的过渡画面，需要桥接前一张分镜和下一张分镜「${nextVisual}」${afterText ? `，后续整体流程：${afterText}` : ''}`,
        '保持与前后分镜相同的主体、场景、服装、配色、画风和镜头语言，确保视觉上自然过渡，不引入突变',
      )
    } else if (allPreviousBoards.length > 0) {
      const contextText = allPreviousBoards
        .map((b: any, i: number) => `分镜${i + 1}：${b.prompt || b.title}`)
        .join('；')
      contextLines.push(
        `你是续拍第${index + 1}张分镜，前面已有${allPreviousBoards.length}张：${contextText}`,
        '保持与前面分镜相同的主体、场景、服装、配色、画风和镜头语言，确保视觉连贯',
      )
    } else if (withReference && previousBoard) {
      const previousVisual = previousBoard.prompt || previousBoard.title || ''
      contextLines.push(
        `参考上一张分镜：${previousVisual}`,
        '保持主体、服装、构图关系、配色与画风一致，生成连续镜头感',
      )
    }

    return [
      '请把下面信息整理成适合 AI 生图的详细中文画面描述。',
      `核心画面：${visual}`,
      `约束：比例 ${selectedRatio.value}，风格 ${styleText}`,
      productHint,
      ...contextLines,
      '输出时优先写清：主体是什么、在做什么、场景在哪里、镜头景别与角度、前后景关系、光线与氛围、必须保留的关键元素、不要出现的元素。',
      '只输出一段可直接用于生图的中文描述，不要编号，不要解释。',
    ]
      .filter(Boolean)
      .join('；')
  }

  /** Build an edit prompt for modifying an existing storyboard image. */
  function buildStoryboardEditPrompt(item: any, editPrompt: string) {
    const styleText = selectedStyles.value.join(' ')

    return [
      editPrompt || '优化画面细节',
      item?.title ? `分镜：${item.title}` : '',
      `比例 ${selectedRatio.value}，风格 ${styleText}`,
    ]
      .filter(Boolean)
      .join('；')
  }

  /** Build a prompt for AI-powered storyboard idea insertion. */
  function buildStoryboardInsertIdeaPrompt(seedPrompt: string) {
    const basePrompt = generatedPrompt.value || description.value.trim() || DEFAULT_GENERATING_PROMPT
    const input = String(seedPrompt || '').trim() || '新增分镜画面'
    const styleText = selectedStyles.value.join(' ')
    const safeBasePrompt = basePrompt.length > 260 ? basePrompt.slice(0, 260) : basePrompt
    const safeInput = input.length > 120 ? input.slice(0, 120) : input

    return [
      '你是一名短视频分镜策划与画面提示词专家。',
      `项目主题：${safeBasePrompt}`,
      `新增分镜需求：${safeInput}`,
      `比例 ${selectedRatio.value}，风格 ${styleText}`,
      '请输出一段可直接用于AI生成图片的中文画面描述：1段即可，不要编号，不要引号，不要解释；尽量具体到主体、动作、场景、镜头景别、构图关系、光线氛围、关键细节和限制项。',
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** Build the Seedance video generation prompt from storyboards + timeline. */
  function buildSeedanceVideoPrompt() {
    const basePrompt = generatedPrompt.value || description.value.trim() || DEFAULT_GENERATING_PROMPT
    const styleText = selectedStyles.value.join(' ')
    const storyboardsForPrompt = resolveStoryboardItems().map((item, index) => ({
      title: item.title,
      prompt: creativeStoryboards.value[index]?.prompt || item.title,
    }))

    return buildVideoPromptFromTimeline({
      basePrompt,
      storyboards: storyboardsForPrompt,
      timeline: timelineState.value,
      ratio: normalizeSeedanceRatio(selectedRatio.value),
      styleText,
    })
  }

  /** Build the input assets list for video generation. */
  function getVideoInputAssets() {
    return getCandidateVideoAssets().slice(0, 1)
  }

  /**
   * 返回所有可用于视频生成的候选素材（脱敏版优先），按分镜顺序排列。
   * 调用方可以逐个尝试，遇内容审核拦截时换下一张自动重试。
   */
  function getCandidateVideoAssets() {
    const assets = resolveStoryboardItems()
      .filter((item) => item.assetId || item.blurredAssetId)
      .slice(0, MAX_STORYBOARDS)

    if (!assets.length) {
      const selectedImage = selectedMaterials.value.find((material) => {
        const type = material.type || ''
        const mimeType = material.mimeType || ''
        return material.assetId && (type === 'image' || mimeType.startsWith('image/'))
      })
      return selectedImage ? [{ asset_id: selectedImage.assetId, role: 'image' }] : []
    }

    // 脱敏版排前面，标记 isBlurred 供视频生成重试时优先保留
    return assets.map((item) => ({
      asset_id: item.blurredAssetId || item.assetId,
      role: 'image',
      isBlurred: !!item.blurredAssetId,
    }))
  }

  /** Determine whether an AI stream error should be retried as a non-streaming request. */
  function shouldFallbackToNonStreamResponse(error: any): boolean {
    const code = String(error?.code || '')
    const rawMessage = String(error?.message || '')
    const normalizedMessage = getBusinessErrorMessage(error, rawMessage)

    return (
      error?.status >= 500 ||
      code === 'INTERNAL_ERROR' ||
      code === '50008' ||
      /internal_error|服务内部错误|服务器内部错误|stream|event-stream|sse|响应流/i.test(normalizedMessage) ||
      /internal_error|服务内部错误|服务器内部错误|stream|event-stream|sse|响应流/i.test(rawMessage)
    )
  }

  /** Request AI creative script: try streaming first, fall back to non-streaming on 5xx/stream errors. */
  async function requestCreativeScriptWithFallback({ workspaceId, prompt, inputAssets, onDelta, signal }: any = {}) {
    const requestPayload = {
      workspaceId,
      operationCode: 'responses.multimodal',
      prompt,
      inputAssets,
      modelPlanCandidates: modelPlanCandidates.value,
      params: {
        temperature: 0.8,
        max_output_tokens: 8600,
      },
    }

    try {
      return await streamAiResponse({ ...requestPayload, onDelta, signal })
    } catch (error) {
      // 已被取消（重绘/卸载）：不要再走非流式兜底，避免残留请求覆盖已重置的状态。
      if (signal?.aborted) throw error
      if (!shouldFallbackToNonStreamResponse(error)) throw error
      return createAiResponse(requestPayload)
    }
  }

  /** Parse a storyboard record from AI text output. */
  function parseStoryboardFromAiText(text: string): any {
    const raw = String(text || '').trim()
    if (!raw) return null
    const extracted = extractStoryboardPayload(raw)
    if (Array.isArray(extracted?.storyboards) && extracted.storyboards.length) {
      return extracted.storyboards[0] || null
    }
    try {
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed)
        ? parsed
        : parsed?.storyboards || (parsed && typeof parsed === 'object' && (parsed.title || parsed.prompt) ? [parsed] : [])
      return Array.isArray(list) && list.length ? list[0] : null
    } catch {
      return null
    }
  }

  /** Serialize storyboard array to the canonical format embedded in the generated script. */
  function serializeStoryboardsForScript(storyboards: any[] = []) {
    return (Array.isArray(storyboards) ? storyboards : []).map((board, index) => ({
      title: String(board?.title || '').trim() || `分镜 ${index + 1}`,
      prompt: String(board?.prompt || '').trim(),
      duration: Number(board?.duration || 2) || 2,
      voiceover: String(board?.voiceover || '').trim(),
      subtitle: String(board?.subtitle || '').trim(),
      sfx: String(board?.sfx || '').trim(),
    }))
  }

  /** Build a prompt for chain-based single storyboard generation with context from previous boards. */
  function buildChainBoardPrompt({ boardIndex, totalBoards, allPreviousBoards, baseIdea }: any) {
    const styleText = selectedStyles.value.join(' ')
    const materialNames = selectedMaterials.value
      .map((m) => m.name || m.filename || m.originalName)
      .filter(Boolean)
    const productHint = materialNames.length ? `参考素材：${materialNames.join('、')}` : ''
    const isFirst = boardIndex === 0

    const lines = [
      '你是一名短视频创意策划与分镜提示词专家。',
      `项目需求：${baseIdea}`,
      `约束：总时长 ${selectedDuration.value}，比例 ${selectedRatio.value}，风格 ${styleText}`,
      productHint,
      `请为第${boardIndex + 1}张分镜（共${totalBoards}张）生成画面描述和脚本词。`,
    ]

    if (isFirst) {
      lines.push(
        '这是第一张分镜，请建立故事的开场视觉基调，确定主体、场景和整体视觉风格，为后续分镜树立一致的视觉参照。',
      )
    } else {
      const previousContext = allPreviousBoards
        .map((b: any, i: number) => `分镜${i + 1}：${b.prompt || b.title}${b.voiceover ? ` | 旁白：${b.voiceover}` : ''}`)
        .join('\n')
      lines.push(
        `前面已生成 ${allPreviousBoards.length} 张分镜，请延续视觉叙事但推进故事发展：`,
        previousContext,
        '要求：保持相同的主体、场景、服装、配色、画风和镜头语言；不要重复前面已出现的画面内容；镜头景别和角度要有变化，避免单调。',
      )
    }

    lines.push(
      '输出一段可直接用于AI生图的详细中文画面描述（prompt字段），以及对应的旁白（voiceover）、字幕（subtitle）、音效（sfx）。',
      '画面描述优先写清：主体是什么、在做什么、场景在哪里、镜头景别与角度、前后景关系、光线与氛围、必须保留的关键元素、不要出现的元素。',
      `输出格式：<<<STORYBOARD_JSON>>>[{"title":"分镜标题","prompt":"画面描述","duration":2,"voiceover":"旁白","subtitle":"字幕","sfx":"音效"}]<<<END_STORYBOARD_JSON>>>`,
      '只输出标记内的JSON，不要额外解释。',
    )

    return lines.filter(Boolean).join('\n')
  }

  return {
    buildCreativeScriptPrompt,
    buildStoryboardPrompt,
    buildStoryboardEditPrompt,
    buildStoryboardInsertIdeaPrompt,
    buildChainBoardPrompt,
    buildCreativeScriptInputAssets,
    buildSeedanceVideoPrompt,
    getVideoInputAssets,
    getCandidateVideoAssets,
    requestCreativeScriptWithFallback,
    parseStoryboardFromAiText,
    serializeStoryboardsForScript,
  }
}
