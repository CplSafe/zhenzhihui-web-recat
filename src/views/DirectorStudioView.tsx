import DeepAgentStudio from '@/components/director/DeepAgentStudio'
import styles from '@/components/director/DeepAgentStudio.module.css'

/** Independent Studio entry; embedded hosts pass their own workspace/canvas binding. */
export default function DirectorStudioView() {
  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <span>帧</span>
        <strong>帧智汇</strong>
        <span>Studio</span>
      </div>
      <DeepAgentStudio />
    </main>
  )
}
