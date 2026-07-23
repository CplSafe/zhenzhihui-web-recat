import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import VideoPreviewModal from '@/components/common/VideoPreviewModal'
import AssetPreviewModal from '@/components/resource/AssetPreviewModal'
import { useWorkspaceSessionStore } from '@/stores/workspaceSession'

describe('preview modal keyboard behavior', () => {
  it('focuses the video dialog, closes with Escape, and restores trigger focus', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = '打开视频'
    document.body.appendChild(trigger)
    trigger.focus()

    const onClose = vi.fn()
    function VideoHarness() {
      const [src, setSrc] = useState('/video.mp4')
      return (
        <VideoPreviewModal
          src={src}
          onClose={() => {
            onClose()
            setSrc('')
          }}
        />
      )
    }
    render(<VideoHarness />)

    expect(screen.getByRole('dialog', { name: '视频预览' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭视频预览' })).toHaveFocus())

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(trigger).toHaveFocus())
    trigger.remove()
  })

  it('exposes the asset preview as a modal dialog and closes it with Escape', async () => {
    useWorkspaceSessionStore.setState({
      authSession: {
        user: { id: 7 },
        workspaces: [{ id: 9, type: 'personal', name: '个人空间' }],
        workspace: { id: 9 },
      },
      userWorkspaces: [{ id: 9, type: 'personal', name: '个人空间' }],
      activeWorkspaceOverrideId: 9,
    })
    const onClose = vi.fn()
    render(
      <AssetPreviewModal
        state={{
          visible: true,
          activeIndex: 0,
          items: [
            {
              id: 11,
              assetId: 11,
              workspaceId: 9,
              title: '示例图片',
              mediaKind: 'image',
              mediaUrl: '/image.png',
            },
          ],
        }}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('dialog', { name: '素材预览' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭预览' })).toHaveFocus())

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
