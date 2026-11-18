import { renderHook, act, waitFor } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { useCanvasLocalMediaImport } from '@/composables/useCanvasLocalMediaImport'
import { normalizeImageFileForAiInput } from '@/utils/imageFile'
import { readImageNaturalSize } from '@/utils/canvasLocalImage'
import { uploadAssetFile } from '@/api/business'
vi.mock('@/api/business', () => ({ uploadAssetFile: vi.fn() }))
vi.mock('@/utils/imageFile', () => ({ normalizeImageFileForAiInput: vi.fn() }))
vi.mock('@/utils/canvasLocalImage', async (original) => ({
  ...(await original<typeof import('@/utils/canvasLocalImage')>()),
  normalizeCanvasImageFile: vi.fn(async (file) => file),
  readImageNaturalSize: vi.fn(),
}))

it.each(['normalization', 'dimensions'])('does not create or upload nodes when locked during %s', async (stage) => {
  vi.clearAllMocks()
  const file = new File(['test'], 'frame.png', { type: 'image/png' })
  let resolve!: (value: any) => void
  const pending = new Promise((done) => {
    resolve = done
  })
  vi.mocked(normalizeImageFileForAiInput).mockReturnValue(
    stage === 'normalization' ? (pending as Promise<File>) : Promise.resolve(file),
  )
  vi.mocked(readImageNaturalSize).mockReturnValue(
    stage === 'dimensions'
      ? (pending as Promise<{ width: number; height: number }>)
      : Promise.resolve({ width: 400, height: 400 }),
  )
  let locked = false
  const appendNewNode = vi.fn(),
    commitHistory = vi.fn()
  const view = renderHook(() =>
    useCanvasLocalMediaImport({
      workspaceId: 1,
      isReadOnly: () => locked,
      appendNewNode,
      commitHistory,
      screenToFlowPosition: (p) => p,
      setNodes: vi.fn(),
      setSelectedNode: vi.fn(),
      setSaveStatus: vi.fn(),
      resolveUploadedRealPerson: vi.fn(),
      scheduleImportSync: vi.fn(),
    }),
  )
  const importPromise = view.result.current([file])
  await waitFor(() =>
    expect(stage === 'normalization' ? normalizeImageFileForAiInput : readImageNaturalSize).toHaveBeenCalledOnce(),
  )
  await act(async () => {
    locked = true
    resolve(stage === 'normalization' ? file : { width: 400, height: 400 })
    await importPromise
  })
  expect(commitHistory).not.toHaveBeenCalled()
  expect(appendNewNode).not.toHaveBeenCalled()
  expect(uploadAssetFile).not.toHaveBeenCalled()
})
