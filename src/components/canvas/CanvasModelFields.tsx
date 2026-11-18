import { CanvasMultiSelect } from './CanvasMultiSelect'
import { useGenerationModelCatalog } from '@/composables/useGenerationModelCatalog'
import { isCanvasToolOnlyImageModel } from '@/utils/canvasImageModelVisibility'
import { buildCanvasModelBuckets } from '@/utils/canvasModelBuckets'
export default function CanvasModelFields({
  workspaceId,
  disabled,
  imageModelVersionIds,
  videoModelVersionIds,
  setImage,
  setVideo,
}: {
  workspaceId: number
  disabled: boolean
  imageModelVersionIds: number[]
  videoModelVersionIds: number[]
  setImage: (ids: number[]) => void
  setVideo: (ids: number[]) => void
}) {
  const { groups, loading, operationStates, reload } = useGenerationModelCatalog(workspaceId)
  const catalog = buildCanvasModelBuckets(groups)
  const selectors = [
    {
      label: '生图模型',
      operation: 'image.text_to_image' as const,
      models: catalog.image.filter((model) => !isCanvasToolOnlyImageModel(model)),
      value: imageModelVersionIds,
      change: setImage,
    },
    {
      label: '生视频模型',
      operation: 'video.generate' as const,
      models: catalog.video,
      value: videoModelVersionIds,
      change: setVideo,
    },
  ]
  return (
    <>
      {selectors.map(({ label, operation, models, value, change }) => {
        const state = operationStates[operation]
        return (
          <div key={operation}>
            <div className="cl-brief-name">
              <span>{label}</span>
              <CanvasMultiSelect
                aria-label={label}
                placeholder="不限模型"
                value={value}
                onChange={change}
                loading={loading}
                disabled={disabled}
                size="large"
                options={models
                  .filter((model) => model.operationCodes.includes(operation))
                  .map((model) => ({
                    value: model.modelVersionId,
                    label: model.displayName + (model.unavailableReason ? '（暂不可用）' : ''),
                    disabled: !!model.unavailableReason,
                  }))}
              />
            </div>
            {loading && <small>正在加载模型…</small>}
            {!loading && state?.status === 'error' && (
              <small role="alert">
                {state.message}{' '}
                <button type="button" onClick={reload}>
                  重试
                </button>
              </small>
            )}
          </div>
        )
      })}
    </>
  )
}
