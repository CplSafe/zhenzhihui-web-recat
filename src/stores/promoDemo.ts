import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type PromoStatus = '待交接' | '制作中' | '返工中' | '已交付' | '逾期' | '已退款'
export interface PromoTask {
  id: string
  ownerId: number
  workspaceId: number
  org: string
  contact: string
  phone: string
  scene: string
  duration: number
  ratio: string
  resolution: string
  voice: string
  core: string
  reference: string
  files: string[]
  materialDelivery?: 'online' | 'offline'
  logo: string
  other: string[]
  createdAt: number
  dueAt: number
  deliveredAt?: number
  status: PromoStatus
  revisionUsed: boolean
  revisionNote?: string
}

export const PROMO_RATE = 25
export const PROMO_MULTIPLIER = 1.5
export const promoCredits = (seconds: number) => Math.round(seconds * PROMO_RATE * PROMO_MULTIPLIER)
export const addCalendarDays = (time: number, days: number) => {
  const date = new Date(time)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

interface State {
  tasks: PromoTask[]
  openRequest: number
  openList: () => void
  add: (task: PromoTask) => void
  update: (id: string, ownerId: number, workspaceId: number, patch: Partial<PromoTask>) => void
}

/** 只保存本机演示状态与文件名，不上传文件、不创建真实订单。 */
export const usePromoDemoStore = create<State>()(
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
              ? { ...task, ...patch, id: task.id, ownerId: task.ownerId, workspaceId: task.workspaceId }
              : task,
          ),
        })),
    }),
    {
      name: 'zzh_promo_demo_v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tasks: state.tasks }) as State,
    },
  ),
)
