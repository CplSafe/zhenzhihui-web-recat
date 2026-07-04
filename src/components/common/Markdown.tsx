/**
 * 轻量 Markdown 渲染器。
 * 取代原先的 streamdown —— 后者为渲染 Markdown 把 shiki(几十种语言代码高亮)+ mermaid(图表)
 * 全打包进来,产生数 MB 的 chunk;而本项目只渲染营销文案/脚本等纯文本 Markdown,用不到这些。
 * 改用 react-markdown + remark-gfm(GFM:表格/删除线/任务列表等),体积仅几十 KB。
 * 默认不渲染原始 HTML,安全。
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function Markdown({ children }: { children?: string | null }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ''}</ReactMarkdown>
}
