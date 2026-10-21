import { Modal } from 'antd'
import ImageViewport from './ImageViewport'

export default function ImageDetailModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <Modal
      open={Boolean(src)}
      title="图片详情"
      onCancel={onClose}
      footer={null}
      centered
      width="fit-content"
      zIndex={3200}
      destroyOnClose
    >
      {src ? <ImageViewport key={src} src={src} alt="素材图片详情" /> : null}
    </Modal>
  )
}
