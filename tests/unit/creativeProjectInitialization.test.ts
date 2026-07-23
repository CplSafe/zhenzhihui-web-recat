import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCreativeProject: vi.fn(),
  deleteCreativeProject: vi.fn(),
  getCreativeProject: vi.fn(),
  updateCreativeProjectDraft: vi.fn(),
}))

vi.mock('@/api/business', () => ({
  createCreativeProject: mocks.createCreativeProject,
  deleteCreativeProject: mocks.deleteCreativeProject,
  getCreativeProject: mocks.getCreativeProject,
  updateCreativeProjectDraft: mocks.updateCreativeProjectDraft,
}))

import {
  CreativeProjectInitializationError,
  createEmptyProjectFolderDraft,
  createInitializedProjectFolder,
} from '@/utils/creativeProjectInitialization'

describe('creative project initialization', () => {
  beforeEach(() => {
    mocks.createCreativeProject.mockReset()
    mocks.deleteCreativeProject.mockReset()
    mocks.getCreativeProject.mockReset()
    mocks.updateCreativeProjectDraft.mockReset()
  })

  it('creates the project and persists a neutral draft before returning it', async () => {
    mocks.createCreativeProject.mockResolvedValue({
      id: 41,
      title: '新项目',
      draft_revision: 0,
    })
    mocks.updateCreativeProjectDraft.mockResolvedValue({
      id: 41,
      title: '新项目',
      draft_revision: 1,
    })

    const project = await createInitializedProjectFolder({
      workspaceId: 21,
      title: '  新项目  ',
    })

    expect(mocks.createCreativeProject).toHaveBeenCalledWith({
      workspace_id: 21,
      title: '新项目',
    })
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledWith({
      projectId: 41,
      workspaceId: 21,
      draft: {
        projectVideoStore: {
          records: [],
          overrides: {},
        },
      },
      draftRevision: 0,
    })
    expect(createEmptyProjectFolderDraft()).not.toHaveProperty('flow')
    expect(mocks.getCreativeProject).not.toHaveBeenCalled()
    expect(mocks.deleteCreativeProject).not.toHaveBeenCalled()
    expect(project).toMatchObject({ id: 41, title: '新项目', draft_revision: 1 })
  })

  it('re-reads the latest revision and retries after a 409 conflict', async () => {
    mocks.createCreativeProject.mockResolvedValue({
      id: 42,
      title: '冲突项目',
      draft_revision: 0,
    })
    mocks.updateCreativeProjectDraft
      .mockRejectedValueOnce({ status: 409, code: 'DRAFT_CONFLICT' })
      .mockResolvedValueOnce({ id: 42, draft_revision: 4 })
    mocks.getCreativeProject.mockResolvedValue({
      id: 42,
      draft_revision: 3,
    })

    await expect(createInitializedProjectFolder({ workspaceId: 22, title: '冲突项目' })).resolves.toMatchObject({
      id: 42,
      draft_revision: 4,
    })

    expect(mocks.getCreativeProject).toHaveBeenCalledOnce()
    expect(mocks.getCreativeProject).toHaveBeenCalledWith({ projectId: 42, workspaceId: 22 })
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledTimes(2)
    expect(mocks.updateCreativeProjectDraft.mock.calls.map(([args]) => args.draftRevision)).toEqual([0, 3])
    expect(mocks.deleteCreativeProject).not.toHaveBeenCalled()
  })

  it('best-effort deletes the invisible project when initialization cannot recover', async () => {
    const initializationFailure = { status: 400, message: 'invalid draft' }
    mocks.createCreativeProject.mockResolvedValue({
      id: 43,
      title: '失败项目',
      draft_revision: 0,
    })
    mocks.updateCreativeProjectDraft.mockRejectedValue(initializationFailure)
    mocks.deleteCreativeProject.mockRejectedValue(new Error('rollback failed'))

    let thrown: unknown
    try {
      await createInitializedProjectFolder({ workspaceId: 23, title: '失败项目' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CreativeProjectInitializationError)
    expect(thrown).toMatchObject({
      name: 'CreativeProjectInitializationError',
      message: '项目初始化失败，请重试',
      cause: initializationFailure,
    })
    expect(mocks.updateCreativeProjectDraft).toHaveBeenCalledOnce()
    expect(mocks.getCreativeProject).not.toHaveBeenCalled()
    expect(mocks.deleteCreativeProject).toHaveBeenCalledOnce()
    expect(mocks.deleteCreativeProject).toHaveBeenCalledWith({ projectId: 43, workspaceId: 23 })
  })

  it('rolls back when a retryable save cannot reload the latest revision', async () => {
    const refreshFailure = { status: 503, message: 'detail unavailable' }
    mocks.createCreativeProject.mockResolvedValue({ id: 44, draft_revision: 0 })
    mocks.updateCreativeProjectDraft.mockRejectedValue({ status: 409, code: 'DRAFT_CONFLICT' })
    mocks.getCreativeProject.mockRejectedValue(refreshFailure)
    mocks.deleteCreativeProject.mockResolvedValue(undefined)

    await expect(createInitializedProjectFolder({ workspaceId: 24, title: '重载失败项目' })).rejects.toMatchObject({
      name: 'CreativeProjectInitializationError',
      cause: refreshFailure,
    })
    expect(mocks.deleteCreativeProject).toHaveBeenCalledWith({ projectId: 44, workspaceId: 24 })
  })
})
