import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { RefineDuration } from '@/utils/refineDelivery'
import type { RefineDemoMedia } from '@/utils/refineDemoMedia'
import { getDemoDueAt } from '@/utils/refineDelivery'

export type RefineDemoStatus = '待精修' | '精修中' | '待验收' | '已交付' | '超时改期' | '积分已退回'
export interface RefineDemoTask {
  id: string
  ownerId: number
  workspaceId: number
  description: string
  script: string
  duration: RefineDuration
  ratio: string
  resolution: string
  credits: number
  materialCount: number
  materials?: RefineDemoMedia[]
  createdAt: number
  dueAt: number
  deliveredAt?: number
  status: RefineDemoStatus
  revision: number
  revisionNote?: string
}

interface RefineDemoState {
  tasks: RefineDemoTask[]
  openRequest: number
  openList: () => void
  add: (task: RefineDemoTask) => void
  update: (
    id: string,
    ownerId: number,
    workspaceId: number,
    patch: Partial<Pick<RefineDemoTask, 'status' | 'deliveredAt' | 'revision' | 'revisionNote' | 'dueAt'>>,
  ) => void
}

/** 本地演示数据不进入真实任务协调器，也不存储素材 URL。 */
export const useRefineDemoStore = create<RefineDemoState>()(
  persist(
    (set) => ({
      tasks: [],
      openRequest: 0,
      openList: () => set((state) => ({ openRequest: state.openRequest + 1 })),
      add: (task) => set((state) => ({ tasks: [task, ...state.tasks].slice(0, 100) })),
      update: (id, ownerId, workspaceId, patch) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id && task.ownerId === ownerId && task.workspaceId === workspaceId
              ? { ...task, ...patch }
              : task,
          ),
        })),
    }),
    {
      name: 'zzh_refine_demo_v1',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Partial<RefineDemoState> | undefined
        if (!state || version >= 2) return state as RefineDemoState
        return {
          ...state,
          tasks: (state.tasks || []).map((task) =>
            task.revision === 0 && task.createdAt ? { ...task, dueAt: getDemoDueAt(task.createdAt) } : task,
          ),
        } as RefineDemoState
      },
      partialize: (state) => ({ tasks: state.tasks }) as RefineDemoState,
    },
  ),
)
