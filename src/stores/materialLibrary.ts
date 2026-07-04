/**
 * Zustand Store: 素材库 UI 状态
 * 管理素材库抽屉/弹窗的开关状态和已选素材列表。
 */
import { create } from 'zustand'

export interface MaterialItem {
  id: string | number
  [key: string]: any
}

export interface MaterialLibraryState {
  libraryOpen: boolean
  selectedMaterials: MaterialItem[]

  openLibrary: () => void
  closeLibrary: () => void
  setSelectedMaterials: (materials: MaterialItem[]) => void
  addSelectedMaterials: (materials: MaterialItem[], opts?: { prepend?: boolean }) => void
  removeSelectedMaterial: (materialId: string | number) => void
}

export const useMaterialLibraryStore = create<MaterialLibraryState>((set, get) => ({
  libraryOpen: false,
  selectedMaterials: [],

  openLibrary: () => set({ libraryOpen: true }),
  closeLibrary: () => set({ libraryOpen: false }),

  setSelectedMaterials: (materials) =>
    set({ selectedMaterials: Array.isArray(materials) ? materials : [] }),

  addSelectedMaterials: (materials, { prepend = false } = {}) => {
    const list = Array.isArray(materials) ? materials : []
    const current = Array.isArray(get().selectedMaterials) ? get().selectedMaterials : []
    const existing = new Set(current.map((item) => item.id))
    const picked: MaterialItem[] = []

    list.forEach((item) => {
      if (item?.id && !existing.has(item.id)) {
        existing.add(item.id)
        picked.push(item)
      }
    })

    if (!picked.length) return
    set({ selectedMaterials: prepend ? [...picked, ...current] : [...current, ...picked] })
  },

  removeSelectedMaterial: (materialId) =>
    set({ selectedMaterials: get().selectedMaterials.filter((item) => item.id !== materialId) }),
}))
