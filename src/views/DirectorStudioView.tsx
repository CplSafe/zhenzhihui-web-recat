import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import DeepAgentStudio from '@/components/director/DeepAgentStudio'
import styles from '@/components/director/DeepAgentStudio.module.css'

/** Independent Studio entry; embedded hosts pass their own workspace/canvas binding. */
export default function DirectorStudioView() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <span>帧</span>
        <strong>帧智汇</strong>
        <span>Studio</span>
      </div>
      <div className={styles.standaloneHost} hidden={collapsed}>
        <DeepAgentStudio onCollapse={() => setCollapsed(true)} />
      </div>
      {collapsed && (
        <button type="button" className={styles.restoreDirector} onClick={() => setCollapsed(false)}>
          <MessageCircle size={18} />
          打开 DoDo Agent
        </button>
      )}
    </main>
  )
}
