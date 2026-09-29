import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CanvasShareView from '@/views/CanvasShareView'
import { fetchAllPublicCanvasElements, fetchPublicCanvas } from '@/api/canvasShare'

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: 'shared-token' }) }))
vi.mock('@/api/canvasShare', () => ({
  fetchPublicCanvas: vi.fn(),
  fetchAllPublicCanvasElements: vi.fn(),
}))
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges, nodeTypes }: any) => (
    <div aria-label="共享画布" data-edge-count={edges.length}>
      {nodes.map((node: any) => createElement(nodeTypes[node.type], { key: node.id, id: node.id, data: node.data }))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: ({ id }: { id: string }) => <span data-testid={`handle-${id}`} />,
  Position: { Left: 'left', Right: 'right' },
}))

const node = (id: string, data: Record<string, unknown>) => ({
  element_id: id,
  kind: 'node',
  payload: { id, type: String(data.kind || 'text'), position: { x: 0, y: 0 }, data },
})

describe('CanvasShareView', () => {
  beforeEach(() => {
    vi.mocked(fetchPublicCanvas).mockResolvedValue({ title: '共享测试', status: 'active' } as any)
    vi.mocked(fetchAllPublicCanvasElements).mockResolvedValue([
      node('source', { kind: 'image', resultUrl: '/api/v1/assets/1/download', publicResultUrl: '/shared/image.png' }),
      node('target', { kind: 'text', text: '画布文字' }),
      { element_id: 'edge-1', kind: 'edge', payload: { id: 'edge-1', source: 'source', target: 'target' } },
    ])
  })

  it('uses public media and preserves both endpoints of a saved connection', async () => {
    render(<CanvasShareView />)

    expect(await screen.findByRole('img', { name: '图片预览' })).toHaveAttribute('src', '/shared/image.png')
    expect(screen.getByText('画布文字')).toBeInTheDocument()
    expect(screen.getByLabelText('共享画布')).toHaveAttribute('data-edge-count', '1')
    expect(screen.getByTestId('handle-source-right-source')).toBeInTheDocument()
    expect(screen.getByTestId('handle-target-left-target')).toBeInTheDocument()
  })

  it('replaces a broken image with a readable error instead of a broken-image icon', async () => {
    render(<CanvasShareView />)

    fireEvent.error(await screen.findByRole('img', { name: '图片预览' }))
    expect(screen.getByText('素材暂时无法加载，请联系分享者检查访问权限')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '图片预览' })).not.toBeInTheDocument()
  })

  it('uses share-scoped video and poster URLs', async () => {
    vi.mocked(fetchAllPublicCanvasElements).mockResolvedValue([
      node('video', {
        kind: 'video',
        resultUrl: '/api/v1/assets/2/download?workspace_id=3',
        publicResultUrl: '/shared/video.mp4',
        publicPosterUrl: '/shared/poster.png',
      }),
    ])

    render(<CanvasShareView />)

    const video = await screen.findByLabelText('视频预览')
    expect(video).toHaveAttribute('src', '/shared/video.mp4')
    expect(video).toHaveAttribute('poster', '/shared/poster.png')
  })
})
