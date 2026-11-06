import agreement from '@/content/creator-agreement-2026-11-06.md?raw'
import originality from '@/content/originality-statement-2026-11-06.md?raw'
import './ScriptLegalDocumentView.css'

export default function ScriptLegalDocumentView({ document }: { document: 'agreement' | 'originality' }) {
  const content = document === 'agreement' ? agreement : originality
  const title = document === 'agreement' ? '创作者入驻协议' : '原创说明'
  return (
    <main className="script-legal-page">
      <article className="script-legal-document" aria-label={title}>
        <h1>{title}</h1>
        <div className="script-legal-content">{content.replace(/^[^\r\n]+(?:\r?\n)+/, '')}</div>
      </article>
    </main>
  )
}
