/**
 * Composable: 创意脚本「素材管理」功能簇。
 * 从 CreativeScriptView 原样抽出，行为保持完全一致（上传校验、CORS/重定向错误文案、
 * 对象 URL 创建与回收、素材去重/合并、hydrate 刷新、库抽屉开关、预览均不变）。
 *
 * 沿用项目的 deps 注入模式（同 useScriptPrompts / useCreativeVersions）：
 * hook 接收一个 deps 对象，内部持有自己的素材/上传/库 state，return state+handlers 供组件与
 * renderBody（素材库抽屉 / 已选素材 / 预览弹窗）使用。
 *
 * 交叉依赖（与生成主管道 / 草稿 / 分镜共用的东西）一律由组件通过 deps 传入，hook 内不重复实现：
 * getWorkspaceId（workspaceIdRef）、getWorkspaceIdOrNotify、showToast、createdObjectUrlsRef
 * （对象 URL 回收集合，组件 onMounted cleanup 负责回收）、libraryContextRef（同时被
 * buildDraftSnapshot/handleRedraw 使用）、setLibraryTab、selectedMaterials store 读写、
 * storyboardPreviewMaterials（同时被分镜编辑流程使用，留在组件经 deps 传入值+setter+ref）、
 * previewMaterial（同时被 storyboard/redraw 使用，留在组件经 deps 传入 setter+ref+closePreview）。
 */
import { useRef, useState } from 'react'
import { useStateRef } from '@/composables/useStateRef'
import library1 from '@/assets/creative/library-1.png'
import library2 from '@/assets/creative/library-2.png'
import library3 from '@/assets/creative/library-3.png'
import library4 from '@/assets/creative/library-4.png'
import library5 from '@/assets/creative/library-5.png'
import {
  extractAssetPageItems,
  getAssetDownloadUrl,
  getBusinessErrorMessage,
  deleteAsset,
  listAssets,
  uploadAssetFile,
} from '@/api/business'
import { createMaterialFromAsset, isSupportedMaterialFile, mergeMaterials } from '@/utils/materials'

const MAX_SELECTED_MATERIALS = 4

interface CreativeMaterialsDeps {
  /** workspaceId 的 RefLike（始终读最新值） */
  workspaceIdRef: { current: number }
  /** 取 workspaceId，缺失时弹 toast 并返回 0 */
  getWorkspaceIdOrNotify: () => number
  showToast: (...args: any[]) => any
  /** 对象 URL 回收集合（组件维护，onMounted cleanup 负责回收） */
  createdObjectUrlsRef: { current: string[] }
  /** 素材库抽屉上下文（default / storyboard-editor），组件也用于 buildDraftSnapshot/handleRedraw */
  libraryContextRef: { current: string }
  /** 打开库抽屉时切回「我的」标签 */
  setLibraryTab: (v: string) => void
  /** 描述文本 RefLike（上传时作为 prompt 传入） */
  descriptionRef: { current: string }
  // ── selectedMaterials（来自全局 materialLibrary store，组件读写）──
  selectedMaterialsRef: { current: any[] }
  setSelectedMaterialsAction: (materials: any[]) => void
  addSelectedMaterialsAction: (materials: any[], opts?: { prepend?: boolean }) => void
  removeSelectedMaterialAction: (id: any) => void
  // ── 库抽屉开关（store action）──
  openLibraryAction: () => void
  closeLibraryAction: () => void
  setActiveMenu: (v: string) => void
  // ── storyboardPreviewMaterials（留在组件，分镜编辑流程共用）──
  storyboardPreviewMaterialsRef: { current: any[] }
  setStoryboardPreviewMaterials: (materials: any[]) => void
  // ── previewMaterial（留在组件，storyboard/redraw 共用）──
  setPreviewMaterial: (material: any) => void
  previewMaterialRef: { current: any }
  closePreview: () => void
}

export function useCreativeMaterials(deps: CreativeMaterialsDeps) {
  const {
    workspaceIdRef,
    getWorkspaceIdOrNotify,
    showToast,
    createdObjectUrlsRef,
    libraryContextRef,
    setLibraryTab,
    descriptionRef,
    selectedMaterialsRef,
    setSelectedMaterialsAction,
    addSelectedMaterialsAction,
    removeSelectedMaterialAction,
    openLibraryAction,
    closeLibraryAction,
    setActiveMenu,
    storyboardPreviewMaterialsRef,
    setStoryboardPreviewMaterials,
    setPreviewMaterial,
    previewMaterialRef,
    closePreview,
  } = deps

  // showToast 引用恒定，存入 ref 供回调使用
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast

  // ── 上传 / 素材库 state（仅素材功能簇及其抽屉/预览 UI 使用）──
  const [isUploadingSelected, setIsUploadingSelected, isUploadingSelectedRef] = useStateRef(false)
  const [isUploadingLibrary, setIsUploadingLibrary, isUploadingLibraryRef] = useStateRef(false)
  const [isLoadingLibrary, setIsLoadingLibrary, isLoadingLibraryRef] = useStateRef(false)
  const assetsLoadedRef = useRef(false)
  const [, forceAssetsLoaded] = useState(0)
  const setAssetsLoaded = (v: boolean) => {
    assetsLoadedRef.current = v
    forceAssetsLoaded((n) => n + 1)
  }

  const [libraryMaterials, setLibraryMaterials, libraryMaterialsRef] = useStateRef<any[]>([
    { id: 'library-1', src: library1, name: '蔬菜主图' },
    { id: 'library-2', src: library2, name: '促销场景' },
    { id: 'library-3', src: library3, name: '人物素材' },
    { id: 'library-4', src: library4, name: '生鲜组合' },
    { id: 'library-5', src: library5, name: '海报素材' },
  ])

  async function uploadFiles(files: any, { addToSelected = false }: { addToSelected?: boolean } = {}) {
    const id = getWorkspaceIdOrNotify()

    if (!id) {
      return { materials: [], failedCount: 0 }
    }

    const supportedFiles = Array.from(files || []).filter(isSupportedMaterialFile) as File[]

    if (!supportedFiles.length) {
      showToastRef.current('请选择图片或视频文件', 'error')
      return { materials: [], failedCount: 0 }
    }

    let filesToUpload = supportedFiles
    if (addToSelected) {
      const remaining = Math.max(0, MAX_SELECTED_MATERIALS - selectedMaterialsRef.current.length)
      if (remaining <= 0) {
        showToastRef.current(`最多只能添加 ${MAX_SELECTED_MATERIALS} 个素材`, 'error')
        return { materials: [], failedCount: 0 }
      }
      if (supportedFiles.length > remaining) {
        filesToUpload = supportedFiles.slice(0, remaining)
        showToastRef.current(
          `最多只能添加 ${MAX_SELECTED_MATERIALS} 个素材，本次仅上传前 ${remaining} 个`,
          'error',
        )
      }
    }

    const uploadedMaterials: any[] = []
    const failedFiles: string[] = []

    for (const file of filesToUpload) {
      const localSrc = URL.createObjectURL(file)

      try {
        const { asset } = await uploadAssetFile({
          workspaceId: id,
          file,
          prompt: descriptionRef.current.trim(),
        })

        createdObjectUrlsRef.current.push(localSrc)
        uploadedMaterials.push(createMaterialFromAsset(asset, localSrc))
      } catch (error: any) {
        URL.revokeObjectURL(localSrc)
        const name = file.name || '未命名文件'
        const reason = getBusinessErrorMessage(error, error?.message || '上传失败')
        failedFiles.push(`${name}（${reason}）`)
      }
    }

    if (!uploadedMaterials.length && failedFiles.length) {
      throw new Error(
        failedFiles.length === 1
          ? `${failedFiles[0]}`
          : `${failedFiles.length} 个文件上传失败（示例：${failedFiles[0]}）`,
      )
    }

    setLibraryMaterials(mergeMaterials(uploadedMaterials, libraryMaterialsRef.current))
    setAssetsLoaded(true)

    if (addToSelected) {
      addSelectedMaterialsAction(uploadedMaterials, { prepend: true })
    }

    return {
      materials: uploadedMaterials,
      failedCount: failedFiles.length,
    }
  }

  async function handleSelectedFiles(files: any) {
    if (isUploadingSelectedRef.current) {
      return
    }

    setIsUploadingSelected(true)

    try {
      const { materials, failedCount } = await uploadFiles(files, { addToSelected: true })

      if (materials.length) {
        showToastRef.current(
          failedCount ? `已上传 ${materials.length} 个文件，${failedCount} 个失败` : `已上传 ${materials.length} 个文件`,
          failedCount ? 'error' : 'success',
        )
      }
    } catch (error: any) {
      showToastRef.current(getBusinessErrorMessage(error, error.message || '素材上传失败'), 'error')
    } finally {
      setIsUploadingSelected(false)
    }
  }

  async function handleLibraryFiles(files: any) {
    if (isUploadingLibraryRef.current) {
      return
    }

    setIsUploadingLibrary(true)

    try {
      const shouldAddToSelected = libraryContextRef.current !== 'storyboard-editor'
      const { materials, failedCount } = await uploadFiles(files, { addToSelected: shouldAddToSelected })

      if (materials.length) {
        if (libraryContextRef.current === 'storyboard-editor') {
          const existing = new Set(storyboardPreviewMaterialsRef.current.map((item: any) => item.id))
          const appended = [...storyboardPreviewMaterialsRef.current]
          materials.forEach((item: any) => {
            if (item?.id && !existing.has(item.id)) {
              existing.add(item.id)
              appended.push(item)
            }
          })
          setStoryboardPreviewMaterials(appended.slice(-3))
          showToastRef.current(
            failedCount
              ? `已上传并添加 ${materials.length} 个素材，${failedCount} 个失败`
              : `已上传并添加 ${materials.length} 个素材`,
            failedCount ? 'error' : 'success',
          )
          closeLibrary()
          libraryContextRef.current = 'default'
        } else {
          showToastRef.current(
            failedCount
              ? `已上传并添加 ${materials.length} 个素材，${failedCount} 个失败`
              : `已上传并添加 ${materials.length} 个素材`,
            failedCount ? 'error' : 'success',
          )
        }
      }
    } catch (error: any) {
      showToastRef.current(getBusinessErrorMessage(error, error.message || '素材上传失败'), 'error')
    } finally {
      setIsUploadingLibrary(false)
    }
  }

  async function materialFromRemoteAsset(asset: any) {
    let src = ''

    try {
      src = await getAssetDownloadUrl({ workspaceId: workspaceIdRef.current, assetId: asset.id })
    } catch {
      src = ''
    }

    if (!src) {
      src = asset?.thumbnail_url || asset?.preview_url || asset?.cover_url || asset?.url || ''
    }

    return createMaterialFromAsset(asset, src)
  }

  function getMaterialAssetId(material: any): number {
    const candidate = material?.assetId || material?.serverAsset?.id || material?.serverAsset?.asset_id || 0
    const id = Number(candidate || 0)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0
  }

  function shouldRefreshMaterialSrc(material: any): boolean {
    const src = String(material?.src || '')
    if (!src) return true
    if (src.startsWith('blob:')) return true
    return false
  }

  async function hydrateSelectedMaterialUrls({ silent = true }: { silent?: boolean } = {}) {
    const wsId = workspaceIdRef.current
    if (!wsId) return

    const hydrateList = async (list: any[]) => {
      const items = Array.isArray(list) ? list : []
      if (!items.length) return items

      const settled = await Promise.allSettled(
        items.map(async (material: any) => {
          const assetId = getMaterialAssetId(material)
          if (!assetId) return material
          if (!shouldRefreshMaterialSrc(material)) return material

          let src = ''
          try {
            src = await getAssetDownloadUrl({ workspaceId: wsId, assetId })
          } catch {
            src = ''
          }

          if (!src) {
            const asset = material?.serverAsset || null
            src = asset?.thumbnail_url || asset?.preview_url || asset?.cover_url || asset?.url || ''
          }

          return { ...material, src }
        }),
      )

      return settled.map((result, index) => (result.status === 'fulfilled' ? result.value : items[index]))
    }

    try {
      const nextSelected = await hydrateList(selectedMaterialsRef.current)
      setSelectedMaterialsAction(nextSelected)
      setStoryboardPreviewMaterials(await hydrateList(storyboardPreviewMaterialsRef.current))
    } catch (error) {
      if (!silent) {
        showToastRef.current(getBusinessErrorMessage(error, '素材预览地址刷新失败'), 'error')
      }
    }
  }

  function hydrateMaterialsFromLibrary(materials: any[]) {
    const index = new Map((materials || []).map((material: any) => [material?.id, material]))
    const hydrateList = (list: any[]) =>
      (list || []).map((material: any) => {
        if (!material?.id) return material
        const next = index.get(material.id)
        if (next?.src) return next
        if (String(material.src || '').startsWith('blob:')) {
          return { ...material, src: '' }
        }
        return material
      })

    setSelectedMaterialsAction(hydrateList(selectedMaterialsRef.current))
    setStoryboardPreviewMaterials(hydrateList(storyboardPreviewMaterialsRef.current))
  }

  async function loadWorkspaceAssets({ silent = false }: { silent?: boolean } = {}) {
    const id = workspaceIdRef.current

    if (!id || isLoadingLibraryRef.current) {
      return
    }

    setIsLoadingLibrary(true)

    try {
      const payload = await listAssets({ workspaceId: id, limit: 100 })
      const remoteAssets = extractAssetPageItems(payload).filter(
        (asset: any) => asset?.id && ['image', 'video'].includes(asset.type),
      )
      const remoteMaterials = await Promise.all(remoteAssets.map(materialFromRemoteAsset))
      const visibleRemoteMaterials = remoteMaterials.filter((material: any) => material.src)

      const nextLibraryMaterials = mergeMaterials(visibleRemoteMaterials, libraryMaterialsRef.current)
      setLibraryMaterials(nextLibraryMaterials)
      hydrateMaterialsFromLibrary(nextLibraryMaterials)
      setAssetsLoaded(true)
    } catch (error) {
      if (!silent) {
        showToastRef.current(getBusinessErrorMessage(error, '素材库加载失败'), 'error')
      }
    } finally {
      setIsLoadingLibrary(false)
    }
  }

  function previewSelectedMaterial(material: any) {
    setPreviewMaterial(material)
  }

  function removeSelectedMaterial(materialId: any) {
    removeSelectedMaterialAction(materialId)

    if (previewMaterialRef.current?.id === materialId) {
      closePreview()
    }

    showToastRef.current('素材已移除', 'success')
  }

  function openLibrary() {
    libraryContextRef.current = 'default'
    openLibraryAction()
    setActiveMenu('')
    setLibraryTab('mine')

    if (!assetsLoadedRef.current) {
      loadWorkspaceAssets()
    }
  }

  function openLibraryForStoryboardEditor() {
    libraryContextRef.current = 'storyboard-editor'
    openLibraryAction()
    setActiveMenu('')
    setLibraryTab('mine')
    if (!assetsLoadedRef.current) {
      loadWorkspaceAssets()
    }
  }

  function closeLibrary() {
    closeLibraryAction()
    setActiveMenu('')
  }

  function addMaterialsFromLibrary(materials: any) {
    const list = Array.isArray(materials) ? materials : []

    if (libraryContextRef.current === 'storyboard-editor') {
      const existing = new Set(storyboardPreviewMaterialsRef.current.map((item: any) => item.id))
      const appended = [...storyboardPreviewMaterialsRef.current]
      list.forEach((item: any) => {
        if (item?.id && !existing.has(item.id)) {
          existing.add(item.id)
          appended.push(item)
        }
      })
      const nextPreview = appended.slice(-3)
      setStoryboardPreviewMaterials(nextPreview)
      showToastRef.current(`已添加 ${nextPreview.length} 个素材`, 'success')
      closeLibrary()
      libraryContextRef.current = 'default'
      return
    }

    const existing = new Set(selectedMaterialsRef.current.map((item: any) => item?.id).filter(Boolean))
    const remaining = Math.max(0, MAX_SELECTED_MATERIALS - existing.size)
    if (remaining <= 0) {
      showToastRef.current(`最多只能添加 ${MAX_SELECTED_MATERIALS} 个素材`, 'error')
      return
    }

    const picked: any[] = []
    list.forEach((item: any) => {
      if (picked.length >= remaining) return
      if (item?.id && !existing.has(item.id)) {
        existing.add(item.id)
        picked.push(item)
      }
    })

    addSelectedMaterialsAction(picked)
    if (picked.length) {
      const overflow = list.length > picked.length
      showToastRef.current(
        overflow
          ? `最多只能添加 ${MAX_SELECTED_MATERIALS} 个素材，本次添加 ${picked.length} 个`
          : `已添加 ${picked.length} 个素材`,
        overflow ? 'error' : 'success',
      )
    }
  }

  async function removeMaterialsFromLibrary(ids: any) {
    const list = Array.isArray(ids) ? ids : []
    if (!list.length) return

    const wsId = Number(workspaceIdRef.current || 0)
    if (!wsId) {
      showToastRef.current('workspace_id 缺失，无法删除素材', 'error')
      return
    }

    const removeIdSet = new Set(list)
    const materialIndex = new Map((libraryMaterialsRef.current || []).map((item: any) => [item?.id, item]))

    const targets = list
      .map((id: any) => {
        const material = materialIndex.get(id)
        if (!material) return null
        const assetId = getMaterialAssetId(material)
        return assetId ? { id, assetId } : null
      })
      .filter(Boolean) as any[]

    const failed: any[] = []

    await Promise.all(
      targets.map(async (row: any) => {
        try {
          await deleteAsset({ workspaceId: wsId, assetId: row.assetId })
        } catch (error) {
          failed.push(row.id)
          if (import.meta.env.DEV) {
            console.warn('[delete asset failed]', row, error)
          }
        }
      }),
    )

    setLibraryMaterials((libraryMaterialsRef.current || []).filter((item: any) => !removeIdSet.has(item.id)))
    list.forEach((id: any) => removeSelectedMaterialAction(id))
    setStoryboardPreviewMaterials(
      storyboardPreviewMaterialsRef.current.filter((item: any) => !removeIdSet.has(item.id)),
    )

    const okCount = list.length - failed.length
    if (!failed.length) {
      showToastRef.current(`已删除 ${okCount} 个素材`, 'success')
      return
    }
    if (!okCount) {
      showToastRef.current('素材删除失败，请稍后重试', 'error')
      return
    }
    showToastRef.current(`已删除 ${okCount} 个，失败 ${failed.length} 个`, 'error')
  }

  function removeStoryboardPreviewMaterial(id: any) {
    if (!id) return
    const next = storyboardPreviewMaterialsRef.current.filter((item: any) => item.id !== id)
    if (next.length === storyboardPreviewMaterialsRef.current.length) return
    setStoryboardPreviewMaterials(next)
    showToastRef.current(`已添加 ${next.length} 个素材`, 'success')
  }

  return {
    // ── state ──
    isUploadingSelected,
    isUploadingLibrary,
    isLoadingLibrary,
    libraryMaterials,
    libraryMaterialsRef,
    assetsLoadedRef,
    // ── state setters（供组件 handleRedraw / workspaceId watch 复用，语义不变）──
    setIsUploadingSelected,
    setIsUploadingLibrary,
    setIsLoadingLibrary,
    setAssetsLoaded,
    // ── handlers ──
    uploadFiles,
    handleSelectedFiles,
    handleLibraryFiles,
    materialFromRemoteAsset,
    getMaterialAssetId,
    shouldRefreshMaterialSrc,
    hydrateSelectedMaterialUrls,
    hydrateMaterialsFromLibrary,
    loadWorkspaceAssets,
    previewSelectedMaterial,
    removeSelectedMaterial,
    openLibrary,
    openLibraryForStoryboardEditor,
    closeLibrary,
    addMaterialsFromLibrary,
    removeMaterialsFromLibrary,
    removeStoryboardPreviewMaterial,
  }
}
