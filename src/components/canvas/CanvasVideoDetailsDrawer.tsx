import { Button, Drawer, Empty } from 'antd'
import type { CanvasVideoPreviewInfo } from './CanvasVideoPreviewModal'
import styles from './CanvasVideoDetailsDrawer.module.css'

export default function CanvasVideoDetailsDrawer({
  info,
  onClose,
}: {
  info: CanvasVideoPreviewInfo
  onClose: () => void
}) {
  const rows = [
    ['模型', info.modelName],
    ['分辨率', info.mediaWidth && info.mediaHeight ? `${info.mediaWidth} × ${info.mediaHeight}` : ''],
    ['宽高比', info.ratio],
    ['时长', info.durationLabel],
    ['生成音频', typeof info.generateAudio === 'boolean' ? (info.generateAudio ? '开启' : '关闭') : ''],
    ['生成时间', info.createdAt],
    ['提示词', info.prompt],
  ].filter(([, value]) => value)
  return (
    <Drawer
      open
      title="视频详情信息"
      placement="right"
      width="min(380px, 100vw)"
      zIndex={3000}
      closable={false}
      onClose={onClose}
      extra={
        <Button autoInsertSpace={false} aria-label="收起" onClick={onClose}>
          收起
        </Button>
      }
    >
      {rows.length ? (
        <dl className={styles.list}>
          {rows.map(([label, value]) => (
            <div key={label} className={styles.row}>
              <dt className={styles.label}>{label}</dt>
              <dd className={styles.value}>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <Empty description="暂无视频详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Drawer>
  )
}
