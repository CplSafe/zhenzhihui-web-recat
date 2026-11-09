const templates = [
  { name: '创意模板', file: '创意提交模板.docx' },
  { name: '一卡模板', file: '一卡标准模板.docx' },
  { name: '剧本模板', file: '完整剧本标准模板.docx' },
]

export function ScriptTemplateDownloads({ stage }: { stage: 'creative' | 'card' | 'script' }) {
  const template = templates[stage === 'creative' ? 0 : stage === 'card' ? 1 : 2]
  return (
    <section className="si-card si-template-downloads" aria-labelledby="si-template-downloads-title">
      <div className="si-template-heading">
        <h2 id="si-template-downloads-title">模板下载</h2>
        <p>下载当前阶段的模板，按要求准备内容。</p>
      </div>
      <div className="si-template-list">
        <div className="si-template-item">
          <div>
            <strong>{template.name}</strong>
            <small>可下载</small>
          </div>
          <a href={`/script-idea-templates/${template.file}`} download aria-label={`下载${template.name}`}>
            下载模板
          </a>
        </div>
      </div>
    </section>
  )
}
