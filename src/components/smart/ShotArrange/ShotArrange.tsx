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
import styles from './ShotArrange.module.less'

interface ShotArrangeProps {
  shots: Shot[]
  /** 正在生成分镜图的镜头(键为 shot.id) */
  generating?: Record<string | number, boolean>
  onShotsChange: (shots: Shot[]) => void
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
}

let insUid = 1
const newShotId = () => `new_${Date.now()}_${insUid++}`
const renumber = (list: Shot[]): Shot[] => list.map((s, i) => ({ ...s, no: `镜头${i + 1}` }))
const blankShot = (): Shot => ({ id: newShotId(), no: '镜头', duration: '5s', desc: '', subjects: [], isNew: true })

export default function ShotArrange({
  shots,
  generating = {},
  onShotsChange,
  onUploadRef,
  onGenerateShot,
  onPolishPrompt,
  onPolishText,
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
    insertCommittedRef.current = false
    setDlg({ open: true, mode: 'insert', shotId: s.id })
  }
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
    const ok = await onGenerateShot(sh, { mode: dlg.mode, intent: text, uploadRefUrls })
    if (ok && dlg.mode === 'insert') insertCommittedRef.current = true
    return ok
  }

  return (
    <div className={styles.shotarr}>
      <ShotList
        shots={shots}
        selectedId={selectedId}
        onSelect={setSelectedId}
        generating={generating}
        onShotsChange={onShotsChange}
        onEditShot={openEditShot}
        onInsertShot={openInsertShot}
        onPreview={setBigImg}
      />
      {selected ? (
        <ShotEditPanel
          shot={selected}
          regenerating={!!generating[selected.id]}
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
