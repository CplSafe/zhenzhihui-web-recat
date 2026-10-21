import { useState } from 'react'
import { Button, Checkbox, Modal } from 'antd'
import AgreementModal from '@/components/auth/AgreementModal'
import './RealPersonNoticeModal.css'

const FACE_RULES_URL =
  'https://docs.volcengine.com/docs/ark/volcengine-face-information-processing-rules-for-real-person-and-lookalike-verification?lang=zh'

export default function RealPersonNoticeModal({ onAgree, onCancel }: { onAgree: () => void; onCancel: () => void }) {
  const [agreed, setAgreed] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)

  return (
    <>
      <Modal
        open
        title="人脸信息使用告知与授权"
        width={1100}
        className="real-person-notice"
        centered
        maskClosable={false}
        keyboard={!showPrivacy}
        onCancel={onCancel}
        footer={null}
      >
        <div className="real-person-notice-body" tabIndex={0} aria-label="阅读须知正文">
          <p>
            您即将通过调用Seedance模型使用【真人素材库】功能。为保障您依法合规的授权和使用相关肖像信息，避免您或任何其他肖像权人的合法权益遭受侵害，我们将通过火山引擎所提供的活体检测与同人认证技术服务完成身份核验，特此向您告知并请您特别同意以下内容：
          </p>
          <h3>1. 服务说明</h3>
          <ul>
            <li>
              本授权将仅用于活体检测（判断是否为真实自然人操作）与同人认证（比对是否为同一人），不涉及任何核验政府身份数据源、或进行实人认证等。
            </li>
          </ul>
          <h3>2. 信息收集与处理</h3>
          <ul>
            <li>
              火山引擎将收集您的人脸图像、视频及面部识别特征信息，仅用于本次核验；核验后将按约定留存基准图像，但仅用于后续同人认证比对。
            </li>
            <li>火山引擎作为受托技术方，仅按我们的指示处理您的人脸信息，不会用于委托外的任何用途。</li>
          </ul>
          <h3>3. 您的权利</h3>
          <ul>
            <li>
              您可以查阅、复制、更正、删除您的人脸信息，也可随时撤回同意；撤回后我们将立即停止处理并删除相关信息，不影响您使用其他无关功能。
            </li>
          </ul>
          <h3>4. 免责声明</h3>
          <ul>
            <li>
              4.1
              您承诺系自愿提供人脸信息并完成授权，因您主动授权、账号保管不当、设备被冒用等原因导致的任何风险与责任，均由您自行承担。
            </li>
            <li>
              4.2
              我们与火山引擎已履行技术安全与合规告知义务，非因我方或火山引擎故意/重大过失导致的人脸信息泄露、滥用等风险，我方与火山引擎不承担责任。
            </li>
            <li>
              4.3 您承诺提供的人脸信息为本人真实、合法信息，因信息虚假、冒用他人信息引发的全部法律责任，由您自行承担。
            </li>
          </ul>
        </div>
        <div className="real-person-notice-footer">
          <div className="real-person-notice-consent">
            <Checkbox
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              aria-label="我已阅读并同意人脸信息使用告知与授权"
            />
            <span>
              继续使用即代表您已同意并接受以上信息、
              <a href={FACE_RULES_URL} target="_blank" rel="noopener noreferrer">
                《火山引擎人脸信息处理规则》
              </a>
              及
              <button type="button" className="real-person-notice-link" onClick={() => setShowPrivacy(true)}>
                《帧智汇隐私政策》
              </button>
              。 请确保充分理解后再进行操作。
            </span>
          </div>
          <div className="real-person-notice-actions">
            <Button onClick={onCancel}>不同意</Button>
            <Button
              type="primary"
              disabled={!agreed}
              onClick={() => {
                if (agreed) onAgree()
              }}
            >
              同意并使用
            </Button>
          </div>
        </div>
      </Modal>
      {showPrivacy && (
        <div className="real-person-notice-privacy">
          <AgreementModal onCancel={() => setShowPrivacy(false)} onAgree={() => setShowPrivacy(false)} />
        </div>
      )}
    </>
  )
}
