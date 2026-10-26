import styles from './CanvasGettingStarted.module.css'

export default function CanvasGettingStarted({
  onText,
  onMaterials,
  onImport,
  onHelp,
  onDismiss,
}: {
  onText: () => void
  onMaterials: () => void
  onImport: () => void
  onHelp: () => void
  onDismiss: () => void
}) {
  return (
    <section
      className={`${styles.starter} nodrag nopan nowheel`}
      aria-label="画布开始指南"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <h2>从一个想法开始</h2>
      <p>添加文字或素材，再连接节点，组织你的创作流程。</p>
      <div className={styles.actions}>
        <button type="button" onClick={onText}>
          输入想法
        </button>
        <button type="button" onClick={onMaterials}>
          添加本地素材
        </button>
        <button type="button" onClick={onImport}>
          导入文字或分镜
        </button>
      </div>
      <p className={styles.hint}>拖动节点边缘的连接点建立连线；按住空格拖动画布。</p>
      <div className={styles.footer}>
        <button type="button" onClick={onHelp}>
          查看快捷键
        </button>
        <button type="button" onClick={onDismiss}>
          先自行探索
        </button>
      </div>
    </section>
  )
}
