/**
 * ShotArrange — 镜头编排(2.1)。
 * 左:分镜列表(ShotList);右:素材修改面板(ShotEditPanel,分镜描述只读)。
 * 「编辑该分镜 / 向上插入 / 向下插入 / 卡间 +」统一走 ShotEditDialog 弹框:
 *   描述 + 上传素材 → 后端只更新当前(被编辑/新建)的分镜,生成成功后才关闭弹框。
 * 受控:shots + onShotsChange;分镜图生成由父级处理(onGenerateShot 可等待,返回是否成功)。
 */
import { useEffect, useRef, useState } from 'react'
import type { Shot } from '../ScriptStoryboardTable'
import ShotList from '../ShotList'
import ShotEditPanel from '../ShotEditPanel'
import ShotEditDialog from '../ShotEditDialog'
import ShotTrashBin, { type ShotTrashItem } from '../ShotTrashBin/ShotTrashBin'
import styles from './ShotArrange.module.less'

/** 镜头编排受控数据及单镜生成、润色、上传、删除和回收站能力。 */
interface ShotArrangeProps {
  shots: Shot[]
  /** 正在生成分镜图的镜头(键为 shot.id) */
  generating?: Record<string | number, boolean>
  /** 整页分镜图正在批量生成中 */
  generatingAll?: boolean
  onShotsChange: (shots: Shot[]) => void
  /** 分镜缩略图加载失败/成功回调(用于「图未加载成功不能生成视频」) */
  onShotImgError?: (id: string | number) => void
  onShotImgLoad?: (id: string | number) => void
  onShotImgRetrying?: (id: string | number) => void
  imageRetryTokens?: Record<string | number, number>
  /** 上传素材 → 直传后端成 asset(http url + asset_id) */
  onUploadRef?: (file: File) => Promise<{ url: string; assetId?: number }>
  /**
   * 编辑/新增弹框「生成分镜」:为单个分镜生成(可等待),返回 true=成功。
   * 父级会带【全部分镜信息】+ 描述(intent)+ 上传素材(uploadRefUrls)产出该镜完整内容(含台词/字幕/音效)并出图。
   */
  onGenerateShot?: (
    shot: Shot,
    opts: { mode: 'edit' | 'insert'; intent: string; uploadRefUrls: string[] },
  ) => Promise<boolean>
  /** 弹框「AI一键润色」:润色描述文本(带本次上传素材 → VL 读图理解诉求) */
  onPolishPrompt?: (text: string, uploadRefUrls: string[]) => Promise<string>
  /** 台词/字幕/音效 的「AI一键润色」 */
  onPolishText?: (kind: 'line' | 'subtitle' | 'sound', text: string) => Promise<string>
  onDeleteShot?: (shot: Shot, index: number) => Promise<void> | void
  trashItems?: ShotTrashItem[]
  trashLoading?: boolean
  onLoadTrash?: () => Promise<void> | void
  onRestoreTrash?: (item: ShotTrashItem) => Promise<void> | void
  onDeleteTrash?: (item: ShotTrashItem) => Promise<void> | void
  onRestoreAllTrash?: (items: ShotTrashItem[]) => Promise<void> | void
  onClearTrash?: (items: ShotTrashItem[]) => Promise<void> | void
}

/** 为尚未持久化的新镜头生成会话内唯一 ID。 */
let insUid = 1
/** 结合时间戳和自增值生成未持久化镜头 ID。 */
const newShotId = () => `new_${Date.now()}_${insUid++}`

/** 按当前数组顺序重新生成镜头编号。 */
const renumber = (list: Shot[]): Shot[] => list.map((s, i) => ({ ...s, no: `镜头${i + 1}` }))

/** 创建等待用户描述或后台生成的空镜头占位。 */
const blankShot = (): Shot => ({ id: newShotId(), no: '镜头', duration: '5s', desc: '', subjects: [], isNew: true })

/** 协调分镜列表选择、插入占位、编辑弹窗和右侧素材编辑面板。 */
export default function ShotArrange({
  shots,
  generating = {},
  generatingAll = false,
  onShotsChange,
  onShotImgError,
  onShotImgLoad,
  onShotImgRetrying,
  imageRetryTokens = {},
  onUploadRef,
  onGenerateShot,
  onPolishPrompt,
  onPolishText,
  onDeleteShot,
  trashItems = [],
  trashLoading = false,
  onLoadTrash,
  onRestoreTrash,
  onDeleteTrash,
  onRestoreAllTrash,
  onClearTrash,
}: ShotArrangeProps) {
  const [selectedId, setSelectedId] = useState<string | number | null>(shots[0]?.id ?? null)
  const [bigImg, setBigImg] = useState('') // 点击分镜缩略图 → 放大查看
  useEffect(() => {
    if (!shots.some((s) => s.id === selectedId)) setSelectedId(shots[0]?.id ?? null)
  }, [shots, selectedId])

  const selected = shots.find((s) => s.id === selectedId) || null
  const patchSel = (patch: Partial<Shot>) => {
    if (!selected) return
    onShotsChange(shots.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)))
  }

  // ── 编辑/新增/插入 弹框 ──
  const [dlg, setDlg] = useState<{ open: boolean; mode: 'edit' | 'insert'; shotId: string | number | null }>({
    open: false,
    mode: 'edit',
    shotId: null,
  })
  const [pendingAutoGenerateId, setPendingAutoGenerateId] = useState<Shot['id'] | null>(null)
  const autoGenerateStartedRef = useRef(new Set<Shot['id']>())
  // 插入态:是否已成功生成(用于取消时清理「占位空分镜」,避免误删已出图的)
  const insertCommittedRef = useRef(false)

  const openEditShot = (shot: Shot) => {
    setSelectedId(shot.id)
    setDlg({ open: true, mode: 'edit', shotId: shot.id })
  }
  const openInsertShot = (index: number) => {
    const s = blankShot()
    const list = shots.slice()
    list.splice(index, 0, s)
    onShotsChange(renumber(list))
    setSelectedId(s.id)
    if (onGenerateShot) {
      setPendingAutoGenerateId(s.id)
    } else {
      insertCommittedRef.current = false
      setDlg({ open: true, mode: 'insert', shotId: s.id })
    }
  }

  // 等父级接收新增分镜后再生成，确保父级能拿到正确插入位置及完整前后文。
  useEffect(() => {
    if (pendingAutoGenerateId == null || !onGenerateShot) return
    const sh = shots.find((s) => s.id === pendingAutoGenerateId)
    if (!sh || autoGenerateStartedRef.current.has(sh.id)) return

    autoGenerateStartedRef.current.add(sh.id)
    setPendingAutoGenerateId(null)
    void Promise.resolve()
      .then(() => onGenerateShot(sh, { mode: 'insert', intent: '', uploadRefUrls: [] }))
      // 业务层负责提示具体生成错误；协调层必须消费拒绝态，避免产生全局未处理 Promise。
      .catch(() => false)
      .finally(() => {
        autoGenerateStartedRef.current.delete(sh.id)
      })
  }, [onGenerateShot, pendingAutoGenerateId, shots])
  const closeDlg = () => {
    // 取消新增:移除未出图的占位空分镜(已成功生成则保留)
    if (dlg.mode === 'insert' && !insertCommittedRef.current && dlg.shotId != null) {
      onShotsChange(renumber(shots.filter((s) => s.id !== dlg.shotId)))
    }
    setDlg((d) => ({ ...d, open: false }))
  }

  // 弹框「生成分镜」:把 模式 + 描述 + 上传素材 交给父级(父级带全部分镜信息生成),成功后置 committed
  const handleDialogGenerate = async (text: string, uploadRefUrls: string[]): Promise<boolean> => {
    if (!onGenerateShot || dlg.shotId == null) return false
    const sh = shots.find((s) => s.id === dlg.shotId)
    if (!sh) return false
    // 弹框点生成后立即关闭(后台生成)。插入模式须在 await 前【同步】提交占位,
    // 否则关闭(closeDlg)时占位空分镜会被当作「未提交」删掉,导致后台生成无处回填。
    if (dlg.mode === 'insert') insertCommittedRef.current = true
    const ok = await onGenerateShot(sh, { mode: dlg.mode, intent: text, uploadRefUrls })
    return ok
  }

  return (
    <div className={styles.shotarr}>
      <ShotList
        shots={shots}
        selectedId={selectedId}
        onSelect={setSelectedId}
        generating={generating}
        globalGenerating={generatingAll}
        onShotsChange={onShotsChange}
        onEditShot={openEditShot}
        onInsertShot={openInsertShot}
        onPreview={setBigImg}
        onImgError={onShotImgError}
        onImgLoad={onShotImgLoad}
        onImgRetrying={onShotImgRetrying}
        imageRetryTokens={imageRetryTokens}
        onDeleteShot={onDeleteShot}
        showMoreMenu={false}
        deleteButtonPlacement="thumbOverlay"
      />
      {selected ? (
        <ShotEditPanel
          shot={selected}
          regenerating={!!generating[selected.id] || (!!generatingAll && !selected.image)}
          onPatch={patchSel}
          onPolishText={onPolishText}
        />
      ) : (
        <div className={styles.empty}>请选择左侧分镜进行编辑</div>
      )}

      <ShotEditDialog
        open={dlg.open}
        mode={dlg.mode}
        onUpload={onUploadRef}
        onPolish={onPolishPrompt}
        onGenerate={handleDialogGenerate}
        onClose={closeDlg}
      />

      <ShotTrashBin
        items={trashItems}
        loading={trashLoading}
        onLoad={onLoadTrash}
        onRestore={onRestoreTrash}
        onDelete={onDeleteTrash}
        onRestoreAll={onRestoreAllTrash}
        onClearAll={onClearTrash}
        buttonClassName={styles.trashFabDock}
        dataGuide="smart-arrange-trash"
        dragStorageKey="smart-arrange-trash-fab"
        dragBoundarySelector=".smart__main"
        dragTopObstacleSelector=".smart__progress"
      />

      {/* 分镜缩略图放大查看灯箱 */}
      {bigImg && (
        <div className={styles.lightbox} onClick={() => setBigImg('')} role="dialog" aria-label="分镜图放大">
          <img src={bigImg} alt="" onClick={(e) => e.stopPropagation()} />
          <button type="button" className={styles.lightboxClose} onClick={() => setBigImg('')} aria-label="关闭">
            ×
          </button>
        </div>
      )}
    </div>
  )
}
