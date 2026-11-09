import { useId } from 'react'

const templates = {
  creative: ['创意提交模板', '创意提交模板.docx'],
  card: ['一卡标准模板', '一卡标准模板.docx'],
  script: ['完整剧本标准模板', '完整剧本标准模板.docx'],
  final: ['终稿提交模板', '终稿提交模板.docx'],
} as const

export function ScriptAttachmentPicker({
  label,
  stage,
  disabled,
  count,
  onFiles,
}: {
  label: string
  stage: keyof typeof templates
  disabled: boolean
  count: number
  onFiles: (files: File[]) => void
}) {
  const id = useId()
  const [name] = templates[stage]
  const atLimit = count >= 30
  const unavailable = disabled || atLimit
  return (
    <div className="si-upload">
      <div className="si-upload-title">{label}（选填）</div>
      <div
        className={`si-upload-drop${unavailable ? ' is-disabled' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = unavailable ? 'none' : 'copy'
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (!unavailable) onFiles(Array.from(event.dataTransfer.files))
        }}
      >
        <span className="si-upload-icon" aria-hidden="true">
          ↑
        </span>
        <div>
          <div>
            <strong>把文档拖到这里，或</strong>
            <label className="si-upload-select" htmlFor={id}>
              点击选择文件
            </label>
          </div>
          <span role="status">{atLimit ? '文件数量已到上限' : count ? '请继续上传文件' : '未选择文件'}</span>
          <input
            id={id}
            className="si-upload-input"
            aria-label={label}
            type="file"
            multiple
            accept=".doc,.docx,.pdf,.txt,.md,.ppt,.pptx"
            disabled={unavailable}
            onChange={(event) => {
              onFiles(Array.from(event.target.files || []))
              event.target.value = ''
            }}
          />
          <p>按《{name}》准备文档，Word 或 PDF 均可</p>
          <small>支持 doc、docx、pdf、txt、md、ppt、pptx · 单个不超过 500 MiB · 最多 30 个</small>
        </div>
      </div>
    </div>
  )
}
