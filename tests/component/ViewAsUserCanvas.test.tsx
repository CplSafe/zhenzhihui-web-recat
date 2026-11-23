import { createElement } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import ViewAsUserCanvas from '@/views/ViewAsUserCanvas'
import type { readAsUser } from '@/api/viewAsUser'

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, nodeTypes, children, nodesConnectable, elementsSelectable }: any) => (
    <div data-connectable={nodesConnectable} data-selectable={elementsSelectable} aria-label="画布图">
      {nodes.map((node: any) => (
        <div data-testid={`node-${node.id}`} key={node.id} style={node.style}>
          {createElement(nodeTypes[node.type], { id: node.id, data: node.data })}
        </div>
      ))}
      {children}
    </div>
  ),
  Background: () => null,
  Handle: () => null,
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
  Position: { Left: 'left', Right: 'right' },
  useReactFlow: () => ({ fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn() }),
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}))

function node(id: string, data: Record<string, unknown>, preview_media?: Record<string, unknown>) {
  return {
    element_id: id,
    kind: 'node',
    payload: {
      position: { x: 0, y: 0 },
      style: { width: 260, height: 210, backgroundImage: "url('/api/v1/assets/999/download')" },
      data,
    },
    preview_media,
  }
}

const preview = (asset: string, mime_type: string, expires_in = 120) => ({
  url: `https://object-store.example/${asset}`,
  mime_type,
  expires_in,
})

function mountCanvas(read: (...args: any[]) => Promise<unknown>) {
  const onClose = vi.fn()
  const view = render(
    <ViewAsUserCanvas
      workspaceId={12}
      canvasId={4}
      title="审查画布"
      read={read as typeof readAsUser}
      onClose={onClose}
    />,
  )
  return { ...view, onClose }
}

it('renders paginated readonly nodes and authorizes only media in the server projection on demand', async () => {
  const read = vi.fn(async (path: string) => {
    if (path.endsWith('/assets/23/preview?workspace_id=12')) return preview('preview.png', 'image/png')
    if (path.includes('after_revision=10')) {
      return {
        items: [
          node('script', { kind: 'text', body: '新分镜正文', groupId: 'group-1', groupName: '制作组' }),
          { element_id: 'obsolete', kind: 'node', deleted: true },
        ],
        sync_revision: 12,
      }
    }
    if (path.includes('cursor=page-2')) {
      return {
        items: [node('script', { kind: 'text', body: '旧分镜正文', groupId: 'group-1', groupName: '制作组' })],
        sync_revision: 12,
      }
    }
    if (path.includes('/elements?')) {
      return {
        items: [
          node(
            'image',
            {
              kind: 'image',
              title: '预览样例',
              groupId: 'group-1',
              groupName: '制作组',
              assetId: 999,
              resultUrl: 'https://untrusted.example/old',
              shareMediaUrl: '/private',
            },
            { asset_id: 23 },
          ),
          node('obsolete', { kind: 'text', text: '已删除正文' }),
        ],
        sync_revision: 10,
        has_more: true,
        next_cursor: 'page-2',
      }
    }
    throw new Error(`Unexpected API ${path}`)
  })
  const { onClose } = mountCanvas(read)
  expect(await screen.findByText('新分镜正文')).toBeVisible()
  expect(screen.getByText('制作组')).toBeVisible()
  expect(screen.queryByText('已删除正文')).not.toBeInTheDocument()
  expect(screen.getByLabelText('画布图')).toHaveAttribute('data-connectable', 'false')
  expect(screen.getByLabelText('画布图')).toHaveAttribute('data-selectable', 'false')
  expect(screen.getByTestId('node-image')).toHaveStyle({ width: '260px' })
  expect(screen.getByTestId('node-image').getAttribute('style')).not.toContain('background')
  expect(read.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/canvases/4/elements?workspace_id=12&after_revision=0&limit=1000',
    '/api/v1/canvases/4/elements?workspace_id=12&after_revision=0&limit=1000&cursor=page-2',
    '/api/v1/canvases/4/elements?workspace_id=12&after_revision=10&limit=1000',
  ])
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '查看图片' }))
  expect(await screen.findByRole('img', { name: '预览样例预览' })).toHaveAttribute(
    'src',
    'https://object-store.example/preview.png',
  )
  expect(screen.getByRole('img', { name: '预览样例预览' })).toHaveAttribute('crossorigin', 'anonymous')
  expect(read).toHaveBeenLastCalledWith('/api/v1/canvases/4/assets/23/preview?workspace_id=12', {
    signal: expect.any(AbortSignal),
  })
  fireEvent.click(screen.getByRole('button', { name: '返回画布列表' }))
  expect(onClose).toHaveBeenCalledOnce()
})

it('rejects API or insecure media URLs, supports retry, and never uses a raw node URL', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({
      items: [
        node('audio', { kind: 'audio', assetId: 999, resultUrl: '/api/v1/assets/999/download' }, { asset_id: 6 }),
      ],
    })
    .mockResolvedValueOnce({ ...preview('audio.wav', 'audio/wav'), url: 'http://object-store.example/bad.wav' })
    .mockResolvedValueOnce(preview('audio.wav', 'audio/wav'))

  mountCanvas(read)
  fireEvent.click(await screen.findByRole('button', { name: '载入音频' }))
  const retry = await screen.findByRole('button', { name: '重新载入素材' })
  expect(screen.queryByLabelText('音频预览')).not.toBeInTheDocument()
  fireEvent.click(retry)
  expect(await screen.findByLabelText('音频预览')).toHaveAttribute('src', 'https://object-store.example/audio.wav')
  expect(screen.getByLabelText('音频预览')).toHaveAttribute('crossorigin', 'anonymous')
  expect(read.mock.calls.slice(1).map(([path]) => path)).toEqual([
    '/api/v1/canvases/4/assets/6/preview?workspace_id=12',
    '/api/v1/canvases/4/assets/6/preview?workspace_id=12',
  ])
})

it('asks for a fresh video ticket after an expanded signed playback error without the generic media fallback', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ items: [node('video', { kind: 'video' }, { asset_id: 6 })] })
    .mockResolvedValueOnce(preview('video.mp4?old', 'video/mp4'))
    .mockResolvedValueOnce(preview('video.mp4?new', 'video/mp4'))
  const fallbackFetch = vi.spyOn(globalThis, 'fetch')
  try {
    mountCanvas(read)
    fireEvent.click(await screen.findByRole('button', { name: '载入视频' }))
    expect(await screen.findByLabelText('视频预览')).toHaveAttribute('crossorigin', 'anonymous')
    fireEvent.click(screen.getByRole('button', { name: '放大视频' }))
    const dialog = await screen.findByRole('dialog', { name: '视频预览' })
    const player = within(dialog).getByLabelText('视频播放器')
    expect(player).toHaveAttribute('crossorigin', 'anonymous')
    Object.defineProperty(player, 'error', { value: { code: 2 } })
    fireEvent.error(player)
    fireEvent.click(await within(dialog).findByRole('button', { name: '重新载入素材' }))
    expect(await screen.findByLabelText('视频预览')).toHaveAttribute(
      'src',
      'https://object-store.example/video.mp4?new',
    )
    expect(fallbackFetch).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(3)
  } finally {
    fallbackFetch.mockRestore()
  }
})

it('renews an expired video ticket before playing the media', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(0)
  const read = vi
    .fn()
    .mockResolvedValueOnce({
      items: [node('video', { kind: 'video' }, { asset_id: 6, poster_asset_id: 7 })],
    })
    .mockResolvedValueOnce(preview('video.mp4?old', 'video/mp4'))
    .mockResolvedValueOnce(preview('poster.png?old', 'image/png'))
    .mockResolvedValueOnce(preview('video.mp4?new', 'video/mp4'))
    .mockResolvedValueOnce(preview('poster.png?new', 'image/png'))
  try {
    mountCanvas(read)
    fireEvent.click(await screen.findByRole('button', { name: '载入视频' }))
    const video = await screen.findByLabelText('视频预览')
    expect(video).toHaveAttribute('poster', 'https://object-store.example/poster.png?old')
    now.mockReturnValue(125_000)
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }))
    expect(await screen.findByLabelText('视频预览')).toHaveAttribute(
      'src',
      'https://object-store.example/video.mp4?new',
    )
    expect(read).toHaveBeenCalledTimes(5)
  } finally {
    now.mockRestore()
  }
})
