export interface CanvasReference {
  id: string
  title: string
  kind: string
}

/** Only pass an identity/label to the composer. The server resolves current node data. */
export function canvasReferenceFromNode(
  node: { id: string; type?: string; data?: Record<string, unknown> },
): CanvasReference | undefined {
  const kind = String(node.data?.kind || '')
  if (!['text', 'image', 'video', 'audio'].includes(kind)) return
  return { id: node.id, title: String(node.data?.title || node.data?.label || '未命名节点').slice(0, 120), kind }
}
