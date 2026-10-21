import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import VoiceSamplePanel from '@/components/canvas/VoiceSamplePanel'
import { saveVoiceSample, readVoiceLibrary } from '@/utils/voiceLibrary'

const decode = vi.hoisted(() => vi.fn())
vi.mock('@/utils/voiceSample', async (original) => ({
  ...(await original<typeof import('@/utils/voiceSample')>()),
  decodeVoiceVideo: decode,
}))
beforeEach(() => {
  localStorage.clear()
  decode.mockReset()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:sample'), revokeObjectURL: vi.fn() }))
})
it('收藏可搜索、引用、重命名与移除，不删除素材', async () => {
  saveVoiceSample('u', 21, 9, '旁白')
  const reference = vi.fn(async () => true)
  render(
    <VoiceSamplePanel
      userId="u"
      workspaceId={21}
      disabled={false}
      onUpload={vi.fn()}
      onReference={reference}
      onClose={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '引用' }))
  await waitFor(() => expect(reference).toHaveBeenCalledWith(9, '旁白'))
  await waitFor(() => expect(screen.getByLabelText('重命名样本 9')).toBeEnabled())
  fireEvent.change(screen.getByLabelText('重命名样本 9'), { target: { value: '角色甲' } })
  fireEvent.blur(screen.getByLabelText('重命名样本 9'))
  expect(readVoiceLibrary('u', 21)[0].title).toBe('角色甲')
  fireEvent.click(screen.getByRole('button', { name: '移除收藏' }))
  expect(readVoiceLibrary('u', 21)).toEqual([])
})
it('视频样本必须确认授权且满足时长，上传成功再清空', async () => {
  decode.mockResolvedValue({
    duration: 8,
    sampleRate: 10,
    length: 80,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(80),
  })
  const upload = vi.fn(async (_file: File) => true)
  render(
    <VoiceSamplePanel
      userId="u"
      workspaceId={21}
      disabled={false}
      onUpload={upload}
      onReference={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('上传视频提取声音'), { target: { files: [new File(['video'], 'a.mp4')] } })
  const button = await screen.findByRole('button', { name: '提取并上传为参考音频' })
  expect(button).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByLabelText('样本终点'), { target: { value: '4' } })
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('样本终点'), { target: { value: '8' } })
  fireEvent.click(button)
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
  expect(upload.mock.calls[0][0]).toMatchObject({ name: 'a.wav', type: 'audio/wav' })
})
it('上传失败明确提示并保留选区，可再次提交', async () => {
  decode.mockResolvedValue({
    duration: 8,
    sampleRate: 10,
    length: 80,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(80),
  })
  const upload = vi.fn(async (_file: File) => false)
  render(
    <VoiceSamplePanel
      userId="u"
      workspaceId={21}
      disabled={false}
      onUpload={upload}
      onReference={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('上传视频提取声音'), { target: { files: [new File(['video'], 'a.mp4')] } })
  const button = await screen.findByRole('button', { name: '提取并上传为参考音频' })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('已保留当前选区')
  expect(screen.getByLabelText('样本终点')).toHaveValue(8)
  expect(button).toBeEnabled()
})
