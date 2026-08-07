import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAssetDownloadUrl, getBusinessErrorMessage } from '@/api/business'
import { listRealPeople, type RealPerson } from '@/api/realPeople'
import {
  createSmartRealPersonReference,
  isReadyRealPersonAsset,
  isVerifiedRealPerson,
  type SmartRealPersonReference,
} from '@/utils/smartRealPerson'
import styles from './RealPersonMaterialPicker.module.less'

interface Props {
  open: boolean
  workspaceId: number
  onClose: () => void
  onSelect: (url: string, reference: SmartRealPersonReference) => void
}

function AssetImage({ workspaceId, assetId, alt }: { workspaceId: number; assetId: number; alt: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    void getAssetDownloadUrl({ workspaceId, assetId })
      .then((url) => active && setSrc(url))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [assetId, workspaceId])
  return src ? <img src={src} alt={alt} /> : <span className={styles.imageLoading}>图片加载中…</span>
}

export default function RealPersonMaterialPicker({ open, workspaceId, onClose, onSelect }: Props) {
  const [people, setPeople] = useState<RealPerson[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectingId, setSelectingId] = useState(0)

  useEffect(() => {
    if (!open || !workspaceId) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void listRealPeople({ workspaceId, signal: controller.signal })
      .then((items) => setPeople(items.filter(isVerifiedRealPerson)))
      .catch((reason) => {
        if (!controller.signal.aborted) setError(getBusinessErrorMessage(reason, '真人素材加载失败'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [open, workspaceId])

  if (!open) return null
  const available = people.flatMap((person) =>
    (person.assets || [])
      .filter((asset) => isReadyRealPersonAsset(asset) && !/video/i.test(asset.asset_type || ''))
      .map((asset) => ({ person, asset })),
  )

  return createPortal(
    <div
      className={styles.mask}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="选择真人素材">
        <header>
          <div>
            <span>VERIFIED PERSON LIBRARY</span>
            <h2>选择真人素材</h2>
            <p>仅展示已完成人脸认证并同步成功的真人图片。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭真人素材库">
            ×
          </button>
        </header>
        <div className={styles.content}>
          {loading && <div className={styles.state}>真人素材加载中…</div>}
          {error && <div className={`${styles.state} ${styles.error}`}>{error}</div>}
          {!loading && !error && !available.length && (
            <div className={styles.state}>暂无已认证且可用的真人图片，请先前往“我的素材 → 真人素材库”添加。</div>
          )}
          <div className={styles.grid}>
            {available.map(({ person, asset }) => {
              const assetId = Number(asset.local_asset_id || 0)
              return (
                <button
                  type="button"
                  key={`${person.id}-${asset.id}`}
                  className={styles.item}
                  disabled={selectingId === asset.id}
                  onClick={async () => {
                    setSelectingId(asset.id)
                    try {
                      const url = await getAssetDownloadUrl({ workspaceId, assetId })
                      onSelect(url, createSmartRealPersonReference(person, asset))
                      onClose()
                    } catch (reason) {
                      setError(getBusinessErrorMessage(reason, '真人素材读取失败'))
                    } finally {
                      setSelectingId(0)
                    }
                  }}
                >
                  <AssetImage workspaceId={workspaceId} assetId={assetId} alt={person.name || '真人素材'} />
                  <span className={styles.verified}>已认证</span>
                  <strong>{person.name || '已认证真人'}</strong>
                  <small>{selectingId === asset.id ? '正在选择…' : '选择此人物'}</small>
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}
