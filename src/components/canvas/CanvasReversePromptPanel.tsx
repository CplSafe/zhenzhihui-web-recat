import { useEffect } from 'react'
import { reverseImagePrompt } from '@/api/aiResponses'

/** Runs reverse prompting for a newly created canvas text node. */
export interface CanvasReversePromptTarget {
  nodeId: string
  outputNodeId: string
  assetId: number
  workspaceId: number
  kind: 'image' | 'video'
  title: string
}

interface Props {
  target: CanvasReversePromptTarget
  onComplete: (text: string) => void
  onError: (error: string) => void
}

/** Headless request runner; the result is written into the output node. */
export default function CanvasReversePromptPanel({ target, onComplete, onError }: Props) {
  useEffect(() => {
    const controller = new AbortController()
    void reverseImagePrompt({
      imageAssetId: target.assetId,
      workspaceId: target.workspaceId,
      detail: 'balanced',
      signal: controller.signal,
    })
      .then((text) => {
        if (!controller.signal.aborted) onComplete(text)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) onError(String((reason as Error)?.message || '反推失败，请重试'))
      })
    return () => controller.abort()
  }, [target.assetId, target.workspaceId, onComplete, onError])

  return null
}
