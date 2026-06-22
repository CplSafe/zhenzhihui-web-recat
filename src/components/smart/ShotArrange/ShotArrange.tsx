/**
 * ShotArrange — 镜头编排(2.1)。
 * 左:分镜列表(ShotList);右:素材修改面板(ShotEditPanel)。
 * 视频未生成时本页无中间区;底部「生成视频」由父级 footer 提供。
 * 受控:shots + onShotsChange;分镜图重组生成 / 元素管理 由父级处理。
 */
import { useEffect, useState } from 'react'
import type { Shot } from '../ScriptStoryboardTable'
import ShotList from '../ShotList'
import ShotEditPanel from '../ShotEditPanel'
import styles from './ShotArrange.module.less'

interface ShotArrangeProps {
  shots: Shot[]
  /** 正在生成分镜图的镜头(键为 shot.id) */
  generating?: Record<string | number, boolean>
  onShotsChange: (shots: Shot[]) => void
  /** 点元素 → 打开版本管理 */
  onOpenElement?: (name: string) => void
  /** 当前项目所有图(供"从项目素材添加") */
  projectImages?: { url: string; source: 'ai' | 'upload'; assetId?: number }[]
  /** 上传额外参考图 → 直传后端成 asset(http url + asset_id) */
  onUploadRef?: (file: File) => Promise<{ url: string; assetId?: number }>
  /** 重新生成分镜图(统一:提示词 + 选中素材 + 是否携带当前图) */
  onRegenerateImage: (shot: Shot, opts: { feedback?: string; editPrompt?: string; extraRefUrls?: string[] }) => void
  /** 优化该镜生成提示词(据画面描述+大纲+选中素材),返回 {prompt, debug} */
  onOptimizePrompt?: (
    shot: Shot,
    materials: { name?: string; kind?: string; url?: string }[],
  ) => Promise<{ prompt: string; debug?: any }>
}

export default function ShotArrange({
  shots,
  generating = {},
  onShotsChange,
  onOpenElement,
  projectImages,
  onUploadRef,
  onRegenerateImage,
  onOptimizePrompt,
}: ShotArrangeProps) {
  const [selectedId, setSelectedId] = useState<string | number | null>(shots[0]?.id ?? null)
  useEffect(() => {
    if (!shots.some((s) => s.id === selectedId)) setSelectedId(shots[0]?.id ?? null)
  }, [shots, selectedId])

  const selected = shots.find((s) => s.id === selectedId) || null
  const patchSel = (patch: Partial<Shot>) => {
    if (!selected) return
    onShotsChange(shots.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)))
  }

  return (
    <div className={styles.shotarr}>
      <ShotList
        shots={shots}
        selectedId={selectedId}
        onSelect={setSelectedId}
        generating={generating}
        onShotsChange={onShotsChange}
      />
      {selected ? (
        <ShotEditPanel
          shot={selected}
          regenerating={!!generating[selected.id]}
          projectImages={projectImages}
          onUploadRef={onUploadRef}
          onOpenElement={onOpenElement}
          onPatch={patchSel}
          onRegenerateImage={onRegenerateImage}
          onOptimizePrompt={onOptimizePrompt}
        />
      ) : (
        <div className={styles.empty}>请选择左侧分镜进行编辑</div>
      )}
    </div>
  )
}
