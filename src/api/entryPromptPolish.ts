import { listAiModels } from './business'
import { polishText, type PolishOptions } from './aiPolish'
import {
  getBackendGenerationModelOperationCodes,
  hasBackendGenerationModelOperationDeclaration,
  normalizeGenerationModels,
  unwrapGenerationModelCatalogResponse,
  type BackendGenerationModel,
} from '@/utils/generationModelCatalog'

/** 入口与画布共享生成提示词的润色约束。 */
export function generationPolishContext(kind: string, hasImages: boolean): string {
  const target = kind === 'video' ? '视频' : '图片'
  const details = kind === 'video' ? '镜头运动、光线、节奏和画面风格' : '构图、视角、光线、材质和画面风格'
  return hasImages
    ? `目标是 AI ${target}生成提示词，且已连接参考图。请保持参考图中的主体不变，只补充${details}，不要替换主体或增加无关主体。`
    : `目标是 AI ${target}生成提示词。请补充场景、${kind === 'video' ? '构图、镜头运动、主体动作、光线、节奏和画面风格' : details}，不要增加无关主体。`
}

export async function polishEntryPrompt(
  text: string,
  workspaceId: number,
  kind: string,
  options: Pick<PolishOptions, 'images' | 'imageAssetIds' | 'signal'>,
): Promise<string> {
  if (!workspaceId) throw new Error('请先选择工作空间')
  const response = await listAiModels({ workspaceId, operationCode: 'responses.multimodal', signal: options.signal })
  const models = unwrapGenerationModelCatalogResponse(response)
    .filter((value): value is BackendGenerationModel => Boolean(value && typeof value === 'object'))
    .filter(
      (model) =>
        !hasBackendGenerationModelOperationDeclaration(model) ||
        getBackendGenerationModelOperationCodes(model).includes('responses.multimodal'),
    )
    .map((model) => ({
      ...model,
      operation_codes: ['responses.multimodal'],
      operationCodes: undefined,
      operation_code: undefined,
      operationCode: undefined,
      operations: undefined,
    }))
  const model = normalizeGenerationModels(models).find((candidate) => !candidate.unavailableReason)
  if (!model) throw new Error('暂无可用的 AI 润色模型，请稍后重试')
  return polishText(text, {
    ...options,
    kind: 'generic',
    context: `${generationPolishContext(kind, Boolean(options.images?.length || options.imageAssetIds?.length))}保留原文中所有 @素材引用及其编号，不得修改或新增引用。`,
    maxTokens: 2000,
    modelVersionId: model.modelVersionId,
    requestContext: { workspaceId, modelVersionId: model.modelVersionId, modelVersion: model.source },
  })
}
