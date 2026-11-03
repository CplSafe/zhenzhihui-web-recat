import { useCallback, useRef, useState } from 'react'

/** 无限画布时间线面板与拖放反馈共用的短生命周期 UI 状态。 */
export function useCanvasTimelineUiState() {
  const [editorNodeId, setEditorNodeId] = useState('')
  const [composing, setComposing] = useState(false)
  const [composingNodeId, setComposingNodeId] = useState('')
  const [dropTargetId, setDropTargetId] = useState('')
  const dropTargetRef = useRef('')
  const [progress, setProgress] = useState('')

  const closeEditor = useCallback(() => setEditorNodeId(''), [setEditorNodeId])
  const resetComposition = useCallback(() => {
    setComposing(false)
    setComposingNodeId('')
    setProgress('')
  }, [setComposing, setComposingNodeId, setProgress])
  const resetDropTarget = useCallback(() => {
    dropTargetRef.current = ''
    setDropTargetId('')
  }, [setDropTargetId])

  return {
    editorNodeId,
    setEditorNodeId,
    closeEditor,
    composing,
    setComposing,
    composingNodeId,
    setComposingNodeId,
    progress,
    setProgress,
    resetComposition,
    dropTargetId,
    setDropTargetId,
    dropTargetRef,
    resetDropTarget,
  }
}
