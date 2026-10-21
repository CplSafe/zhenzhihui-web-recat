import { Modal } from 'antd'

/** 正式政策尚未接入时，明确提示缺项，不能用服务协议替代。 */
export default function PrivacyPolicyModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      open
      centered
      title="帧智汇隐私政策"
      onCancel={onClose}
      onOk={onClose}
      okText="关闭"
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      <p role="status">暂未提供正式隐私政策正文，请联系平台获取后阅读。</p>
    </Modal>
  )
}
