import { Profiler, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VideoStage from '@/components/smart/VideoStage/VideoStage'
import { createEmptyVideoModificationDraft } from '@/utils/videoModificationDraft'

const historyVersions = [
  { url: 'https://cdn.example.com/history-v1.mp4', assetId: 101 },
  { url: 'https://cdn.example.com/history-v2.mp4', assetId: 202 },
]

function HistorySyncHarness({ onSwitch }: { onSwitch: (video: { url: string; assetId: number }) => void }) {
  const [currentVideo, setCurrentVideo] = useState({
    url: 'https://cdn.example.com/orphan.mp4',
    assetId: 999,
  })
  return (
    <VideoStage
      shots={[]}
      videoUrl={currentVideo.url}
      videoAssetId={currentVideo.assetId}
      videoVersions={historyVersions}
      onSwitchVideo={(video) => {
        onSwitch(video)
        setCurrentVideo(video)
      }}
      onRegenerateVideo={vi.fn()}
    />
  )
}

describe('VideoStage playback loading', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  })
  afterEach(() => vi.useRealTimers())

  it('streams the original media URL without fetching the complete Blob first', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const videoUrl = 'https://cdn.example.com/generated-video.mp4'
    const { container } = render(
      <VideoStage
        shots={[
          {
            id: 'shot-1',
            no: '镜头1',
            duration: '5s',
            desc: '产品展示',
            subjects: [],
          },
        ]}
        videoUrl={videoUrl}
        onRegenerateVideo={vi.fn()}
      />,
    )

    const player = container.querySelector('video[controls]') as HTMLVideoElement | null
    expect(player).not.toBeNull()
    expect(player?.getAttribute('src')).toBe(videoUrl)
    expect(player?.preload).toBe('metadata')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('releases the previous native player when its URL changes and when the stage unmounts', () => {
    const props = {
      shots: [],
      onRegenerateVideo: vi.fn(),
    }
    const { container, rerender, unmount } = render(
      <VideoStage {...props} videoUrl="https://cdn.example.com/workspace-a.mp4" />,
    )
    const firstPlayer = container.querySelector('video[controls]') as HTMLVideoElement

    rerender(<VideoStage {...props} videoUrl="https://cdn.example.com/workspace-b.mp4" />)

    const secondPlayer = container.querySelector('video[controls]') as HTMLVideoElement
    expect(secondPlayer).not.toBe(firstPlayer)
    expect(firstPlayer.hasAttribute('src')).toBe(false)
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1)

    unmount()

    expect(secondPlayer.hasAttribute('src')).toBe(false)
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2)
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(2)
  })

  it('selects the history card that matches the current main video by asset id', () => {
    const onSwitchVideo = vi.fn()
    render(
      <VideoStage
        shots={[]}
        videoUrl="https://cdn.example.com/history-v2-refreshed-signature.mp4"
        videoAssetId={202}
        videoVersions={historyVersions}
        onSwitchVideo={onSwitchVideo}
        onRegenerateVideo={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '版本1' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '版本2' })).toHaveAttribute('aria-pressed', 'true')
    expect(onSwitchVideo).not.toHaveBeenCalled()
  })

  it('switches the main player to the latest history video when the current video is not in history', async () => {
    const onSwitch = vi.fn()
    render(<HistorySyncHarness onSwitch={onSwitch} />)

    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith(historyVersions[1]))
    expect(screen.getByRole('button', { name: '版本2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '版本1' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('automatically reloads a failed media source twice, then shows an explicit retry action', async () => {
    vi.useFakeTimers()
    const originalUrl = 'https://cdn.example.com/flaky-video.mp4'
    const { container } = render(
      <VideoStage shots={[]} videoUrl={originalUrl} videoAssetId={303} onRegenerateVideo={vi.fn()} />,
    )

    let player = container.querySelector('video[controls]') as HTMLVideoElement
    fireEvent.error(player)
    fireEvent.error(player)
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => vi.advanceTimersByTimeAsync(399))
    expect(player.getAttribute('src')).toBe(originalUrl)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    player = container.querySelector('video[controls]') as HTMLVideoElement
    expect(player.getAttribute('src')).toContain('__vstage_retry=1-')

    fireEvent.error(player)
    fireEvent.error(player)
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => vi.advanceTimersByTimeAsync(1199))
    expect((container.querySelector('video[controls]') as HTMLVideoElement).getAttribute('src')).toContain(
      '__vstage_retry=1-',
    )
    await act(async () => vi.advanceTimersByTimeAsync(1))
    player = container.querySelector('video[controls]') as HTMLVideoElement
    expect(player.getAttribute('src')).toContain('__vstage_retry=2-')

    fireEvent.error(player)
    expect(screen.getByRole('alert')).toHaveTextContent('视频加载失败，请检查网络后重新加载')
    expect(container.querySelector('video[controls]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(container.querySelector('video[controls]')).not.toBeNull()
    fireEvent.canPlay(container.querySelector('video[controls]') as HTMLVideoElement)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not restore the automatic retry budget when metadata loads but playback still fails', async () => {
    vi.useFakeTimers()
    const { container } = render(
      <VideoStage
        shots={[]}
        videoUrl="https://cdn.example.com/metadata-only-video.mp4"
        videoAssetId={304}
        onRegenerateVideo={vi.fn()}
      />,
    )

    let player = container.querySelector('video[controls]') as HTMLVideoElement
    fireEvent.error(player)
    await act(async () => vi.advanceTimersByTimeAsync(400))
    player = container.querySelector('video[controls]') as HTMLVideoElement
    expect(player.getAttribute('src')).toContain('__vstage_retry=1-')
    fireEvent.loadedMetadata(player)

    fireEvent.error(player)
    await act(async () => vi.advanceTimersByTimeAsync(1200))
    player = container.querySelector('video[controls]') as HTMLVideoElement
    expect(player.getAttribute('src')).toContain('__vstage_retry=2-')
    fireEvent.loadedMetadata(player)

    fireEvent.error(player)
    expect(screen.getByRole('alert')).toHaveTextContent('视频加载失败，请检查网络后重新加载')
  })

  it('uses a refreshed asset URL before falling back to cache-busting the old URL', async () => {
    vi.useFakeTimers()
    const originalVideo = { url: 'https://cdn.example.com/expired-signature.mp4', assetId: 404 }
    const refreshedVideo = { url: 'https://cdn.example.com/fresh-signature.mp4', assetId: 404 }
    const onRefreshVideo = vi.fn().mockResolvedValue(refreshedVideo)
    const { container } = render(
      <VideoStage
        shots={[]}
        videoUrl={originalVideo.url}
        videoAssetId={originalVideo.assetId}
        onRefreshVideo={onRefreshVideo}
        onRegenerateVideo={vi.fn()}
      />,
    )

    fireEvent.error(container.querySelector('video[controls]') as HTMLVideoElement)
    expect(onRefreshVideo).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(400))
    expect(onRefreshVideo).toHaveBeenCalledWith(originalVideo)
    expect((container.querySelector('video[controls]') as HTMLVideoElement).getAttribute('src')).toBe(
      refreshedVideo.url,
    )
  })

  it('cancels a scheduled retry when the logical video source changes', async () => {
    vi.useFakeTimers()
    const onRefreshVideo = vi.fn()
    const props = { shots: [], onRefreshVideo, onRegenerateVideo: vi.fn() }
    const { container, rerender } = render(
      <VideoStage {...props} videoUrl="https://cdn.example.com/source-a.mp4" videoAssetId={501} />,
    )

    fireEvent.error(container.querySelector('video[controls]') as HTMLVideoElement)
    expect(vi.getTimerCount()).toBe(1)
    rerender(<VideoStage {...props} videoUrl="https://cdn.example.com/source-b.mp4" videoAssetId={502} />)
    expect(vi.getTimerCount()).toBe(0)

    await act(async () => vi.advanceTimersByTimeAsync(400))
    expect(onRefreshVideo).not.toHaveBeenCalled()
    expect((container.querySelector('video[controls]') as HTMLVideoElement).getAttribute('src')).toBe(
      'https://cdn.example.com/source-b.mp4',
    )
  })

  it('updates the playback indicator without committing a React render on timeupdate', async () => {
    const user = userEvent.setup()
    const onRender = vi.fn()
    const { container } = render(
      <Profiler id="video-stage" onRender={onRender}>
        <VideoStage
          shots={[
            {
              id: 'shot-1',
              no: '镜头1',
              duration: '5s',
              desc: '产品展示',
              subjects: [],
            },
          ]}
          videoUrl="https://cdn.example.com/generated-video.mp4"
          onRegenerateVideo={vi.fn()}
        />
      </Profiler>,
    )

    await user.click(screen.getAllByRole('button', { name: '框选这段' })[0])
    const player = container.querySelector('video[controls]') as HTMLVideoElement
    const commitsBeforeTimeUpdate = onRender.mock.calls.length
    Object.defineProperty(player, 'currentTime', { configurable: true, value: 3 })

    fireEvent.timeUpdate(player)

    expect(onRender).toHaveBeenCalledTimes(commitsBeforeTimeUpdate)
    expect(screen.getByText(/0:03 \/ 0:05/)).toBeInTheDocument()
  })

  it('restores unfinished modification fields and keys version notes by stable asset id', () => {
    const modificationDraft = {
      ...createEmptyVideoModificationDraft(),
      overallNote: '整体节奏加快',
      frameSlots: [
        { start: 1, end: 2, text: '这一秒突出产品' },
        { start: null, end: null, text: '' },
      ],
      noteByVersion: { 'asset:88': '上一轮已经增强产品特写' },
    }
    const props = {
      shots: [
        {
          id: 'shot-1',
          no: '镜头1',
          duration: '5s',
          desc: '产品展示',
          subjects: [],
        },
      ],
      videoAssetId: 88,
      modificationDraft,
      onModificationDraftChange: vi.fn(),
      onRegenerateVideo: vi.fn(),
    }
    const { rerender } = render(<VideoStage {...props} videoUrl="https://cdn.example.com/first-signature.mp4" />)

    expect(screen.getByDisplayValue('整体节奏加快')).toBeInTheDocument()
    expect(screen.getByDisplayValue('这一秒突出产品')).toBeInTheDocument()
    expect(screen.getByText('上一轮已经增强产品特写')).toBeInTheDocument()

    rerender(<VideoStage {...props} videoUrl="https://cdn.example.com/refreshed-signature.mp4" />)
    expect(screen.getByText('上一轮已经增强产品特写')).toBeInTheDocument()
  })

  it('uses the injected homepage-locked model callback for AI polishing', async () => {
    const user = userEvent.setup()
    const onPolishText = vi.fn().mockResolvedValue('润色后的整段修改意见')
    render(
      <VideoStage
        shots={[]}
        videoUrl="https://cdn.example.com/edit-source.mp4"
        videoAssetId={2550}
        onPolishText={onPolishText}
        onRegenerateVideo={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('输入对整段视频的修改描述...')
    await user.type(input, '提高整体亮度')
    await user.click(screen.getAllByRole('button', { name: 'AI一键润色' })[0])

    await waitFor(() => expect(onPolishText).toHaveBeenCalledWith('generic', '提高整体亮度'))
    expect(input).toHaveValue('润色后的整段修改意见')
  })

  it('确认视频修改前展示后端估价，估价完成前不允许提交', async () => {
    const onEstimateEditCost = vi.fn().mockResolvedValue({
      estimatedCost: 1500,
      balance: 297773,
      canAfford: true,
    })
    const onRegenerateVideo = vi.fn()
    render(
      <VideoStage
        shots={[]}
        videoUrl="https://cdn.example.com/edit-source.mp4"
        videoAssetId={2550}
        modificationDraft={{
          ...createEmptyVideoModificationDraft(),
          overallNote: '提高画面亮度',
        }}
        onEstimateEditCost={onEstimateEditCost}
        onRegenerateVideo={onRegenerateVideo}
      />,
    )

    const confirm = screen.getByRole('button', { name: '确认修改' })
    expect(confirm).toBeDisabled()
    expect(await screen.findByText(/后端预计消耗 1500 积分/)).toBeInTheDocument()
    expect(screen.getByText(/后端可能按最低计费时长结算/)).toBeInTheDocument()
    await waitFor(() => expect(confirm).toBeEnabled())

    fireEvent.click(confirm)
    expect(onEstimateEditCost).toHaveBeenCalledWith('【整段视频】提高画面亮度')
    expect(onRegenerateVideo).toHaveBeenCalledWith('【整段视频】提高画面亮度', { edit: true })
  })

  it('视频编辑估价失败时保持提交门禁并提供重试', async () => {
    const onEstimateEditCost = vi.fn().mockRejectedValue(new Error('估价服务暂时不可用'))
    render(
      <VideoStage
        shots={[]}
        videoUrl="https://cdn.example.com/edit-source.mp4"
        videoAssetId={2550}
        modificationDraft={{ ...createEmptyVideoModificationDraft(), overallNote: '提高画面亮度' }}
        onEstimateEditCost={onEstimateEditCost}
        onRegenerateVideo={vi.fn()}
      />,
    )

    expect(await screen.findByText('估价服务暂时不可用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认修改' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重新估价' })).toBeEnabled()
  })
})
