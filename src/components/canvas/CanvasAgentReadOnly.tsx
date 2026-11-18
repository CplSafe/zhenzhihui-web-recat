import { Button, Modal } from 'antd'
import { useNavigate } from 'react-router-dom'

export default function CanvasAgentReadOnly({ owner }: { owner: string }) {
  const navigate = useNavigate()
  return (
    <Modal
      open
      centered
      closable={false}
      keyboard={false}
      maskClosable={false}
      zIndex={3000}
      title={`${owner} 的 Agent 正在运行`}
      footer={<Button onClick={() => navigate('/canvas?manage=1')}>返回画布列表</Button>}
    >
      <p>画布和会话已锁定。你可以等待本轮结束，解锁后继续创作。</p>
    </Modal>
  )
}
