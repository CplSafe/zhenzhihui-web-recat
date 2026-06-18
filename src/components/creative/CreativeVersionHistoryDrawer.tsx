// CreativeVersionHistoryDrawer — 版本历史抽屉
// 展示创意项目的版本历史列表，支持保存新版本、恢复到历史版本、删除版本。
import { useEffect, useMemo, useState } from 'react'
import './CreativeVersionHistoryDrawer.css'

type VersionItem = Record<string, any>

interface CreativeVersionHistoryDrawerProps {
  open?: boolean
  versions?: VersionItem[]
  loading?: boolean
  saving?: boolean
  restoring?: boolean
  deleting?: boolean
  allowSave?: boolean
  selectedVersionId?: number
  detail?: Record<string, any> | null
  detailLoading?: boolean
  onClose?: () => void
  onSave?: (label: string) => void
  onRestore?: (item: VersionItem) => void
  onDelete?: (item: VersionItem) => void
  onSelect?: (item: VersionItem) => void
}

function formatTime(value: any): string {
  if (!value) return ''
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('zh-CN', { hour12: false })
    }
  }
  return String(value)
}

function resolveVersionId(item: VersionItem): any {
  return item?.vid || item?.version_id || item?.versionId || item?.id || item?.version_no || ''
}

function resolveVersionLabel(item: VersionItem, index: number): string {
  const text = String(item?.label || item?.name || item?.title || '').trim()
  if (text) return text
  const id = resolveVersionId(item)
  if (id) return `版本 ${id}`
  return `版本 ${String(index + 1).padStart(2, '0')}`
}

function resolveStepLabel(step: any): string {
  const map: Record<string, string> = {
    script: '创意脚本',
    storyboard: '分镜图片',
    timeline: '镜头编排',
    video: '视频生成',
  }
  return map[String(step || '').trim()] || '未记录阶段'
}

function pickFirstText(...values: any[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function extractReadableScriptText(value: any): string {
  const raw = pickFirstText(value)
  if (!raw) return ''
  const markerOpen = '<<<STORYBOARD_JSON>>>'
  const markerClose = '<<<END_STORYBOARD_JSON>>>'
  const openIndex = raw.indexOf(markerOpen)
  const closeIndex = raw.indexOf(markerClose)
  if (openIndex >= 0) {
    return raw.slice(0, openIndex).trim()
  }
  if (closeIndex >= 0) {
    return raw.slice(0, closeIndex).trim()
  }
  return raw.trim()
}

function splitReadableParagraphs(value: any): string[] {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((part) =>
      part
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean)
}

export default function CreativeVersionHistoryDrawer({
  open = false,
  versions = [],
  loading = false,
  saving = false,
  restoring = false,
  deleting = false,
  allowSave = true,
  selectedVersionId = 0,
  detail = null,
  detailLoading = false,
  onClose,
  onSave,
  onRestore,
  onDelete,
  onSelect,
}: CreativeVersionHistoryDrawerProps) {
  const [label, setLabel] = useState('')

  const canSubmit = Boolean(label.trim()) && !loading && !saving && !restoring && !deleting
  const busy = loading || saving || restoring || deleting

  // 打开时重置版本备注
  useEffect(() => {
    if (!open) return
    setLabel('')
  }, [open])

  // Esc 关闭
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose?.()
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
  }, [open, onClose])

  const selectedVersion = useMemo<VersionItem | null>(() => {
    const currentId = Number(selectedVersionId || 0)
    if (currentId > 0) {
      const matched = versions.find((item) => resolveVersionId(item) === currentId)
      if (matched) return matched
    }
    return detail?.version || null
  }, [selectedVersionId, versions, detail])

  const detailVersion = useMemo<VersionItem | null>(
    () => detail?.version || selectedVersion || null,
    [detail, selectedVersion],
  )

  const detailDraft = useMemo<Record<string, any> | null>(
    () => (detail?.draft && typeof detail.draft === 'object' ? detail.draft : null),
    [detail],
  )

  const detailSummary = useMemo(() => {
    const draft = detailDraft || {}
    const timeline = draft.timelineState && typeof draft.timelineState === 'object' ? draft.timelineState : {}
    const segments = Array.isArray(timeline.segments) ? timeline.segments : []
    const voiceover = Array.isArray(timeline.voiceover) ? timeline.voiceover : []
    const subtitle = Array.isArray(timeline.subtitle) ? timeline.subtitle : []
    const sfx = Array.isArray(timeline.sfx) ? timeline.sfx : []
    return {
      stepLabel: resolveStepLabel(draft.currentStep),
      description: pickFirstText(draft.description),
      generatedPrompt: pickFirstText(draft.generatedPrompt),
      generatedScript: pickFirstText(draft.generatedScript),
      storyboardCount: Array.isArray(draft.storyboardItems)
        ? draft.storyboardItems.length
        : Array.isArray(draft.creativeStoryboards)
          ? draft.creativeStoryboards.length
          : 0,
      segmentCount: segments.length,
      voiceCount: voiceover.length,
      subtitleCount: subtitle.length,
      sfxCount: sfx.length,
      hasVideo: Boolean(pickFirstText(draft.generatedVideoUrl)) || Number(draft.generatedVideoAssetId || 0) > 0,
      selectedRatio: pickFirstText(draft.selectedRatio),
      selectedDuration: pickFirstText(draft.selectedDuration),
      selectedPlatform: pickFirstText(draft.selectedPlatform),
      selectedStyles: Array.isArray(draft.selectedStyles) ? draft.selectedStyles.filter(Boolean) : [],
    }
  }, [detailDraft])

  const creativeScriptBlocks = useMemo(() => {
    const cleaned = extractReadableScriptText(detailSummary.generatedScript)
    return splitReadableParagraphs(cleaned).slice(0, 12)
  }, [detailSummary])

  const storyboardTextItems = useMemo(() => {
    const draft = detailDraft || {}
    const source =
      Array.isArray(draft.creativeStoryboards) && draft.creativeStoryboards.length
        ? draft.creativeStoryboards
        : Array.isArray(draft.storyboardItems)
          ? draft.storyboardItems
          : []
    return source
      .map((item: any, index: number) => ({
        id: String(item?.id || `storyboard-preview-${index + 1}`),
        title: pickFirstText(item?.title, item?.prompt, `分镜 ${index + 1}`),
        prompt: pickFirstText(item?.prompt),
        voiceover: pickFirstText(item?.voiceover),
        subtitle: pickFirstText(item?.subtitle),
        sfx: pickFirstText(item?.sfx),
      }))
      .filter(
        (item: any) => item.title || item.prompt || item.voiceover || item.subtitle || item.sfx,
      )
      .slice(0, 4)
  }, [detailDraft])

  if (!open) return null

  return (
    <div className="vh-scrim" onClick={() => onClose?.()}>
      <aside
        className="vh-panel"
        role="dialog"
        aria-modal="true"
        aria-label="历史记录"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vh-head">
          <strong className="vh-title">历史记录</strong>
          <button type="button" className="vh-close" aria-label="关闭" onClick={() => onClose?.()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {allowSave && (
          <section className="vh-save">
            <label className="vh-label">
              <span>版本备注</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                type="text"
                disabled={busy}
                placeholder="例如：修改了分镜与时间线"
              />
            </label>
            <button
              type="button"
              className="vh-primary"
              disabled={!canSubmit}
              onClick={() => onSave?.(label.trim())}
            >
              {saving ? '保存中…' : '保存当前版本'}
            </button>
          </section>
        )}

        <section className="vh-body">
          <div className="vh-content">
            <section className="vh-list-panel">
              {loading ? (
                <p className="vh-muted">加载中…</p>
              ) : !versions.length ? (
                <p className="vh-muted">暂无历史记录</p>
              ) : (
                <ul className="vh-list">
                  {versions.map((item, index) => (
                    <li
                      key={resolveVersionId(item) || index}
                      className={`vh-item${
                        resolveVersionId(item) === Number(selectedVersionId || 0) ? ' active' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="vh-item-main"
                        disabled={busy}
                        onClick={() => onSelect?.(item)}
                      >
                        <span className="vh-item-title">{resolveVersionLabel(item, index)}</span>
                        <span className="vh-item-meta">
                          {formatTime(
                            item?.created_at || item?.createdAt || item?.created_time || item?.createdTime,
                          )}
                        </span>
                      </button>
                      <div className="vh-actions">
                        <button type="button" className="vh-ghost" disabled={busy} onClick={() => onRestore?.(item)}>
                          {restoring ? '恢复中…' : '恢复'}
                        </button>
                        <button type="button" className="vh-danger" disabled={busy} onClick={() => onDelete?.(item)}>
                          删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="vh-detail-panel">
              {detailLoading ? (
                <p className="vh-muted">版本详情加载中…</p>
              ) : !detailVersion ? (
                <p className="vh-muted">请选择左侧一个历史版本查看详情</p>
              ) : (
                <div className="vh-detail">
                  <header className="vh-detail-head">
                    <div className="vh-detail-meta">
                      <strong>{resolveVersionLabel(detailVersion, 0)}</strong>
                      <span>
                        {formatTime(
                          detailVersion?.created_at ||
                            detailVersion?.createdAt ||
                            detailVersion?.created_time ||
                            detailVersion?.createdTime,
                        )}
                      </span>
                    </div>
                    <span className="vh-step-badge">{detailSummary.stepLabel}</span>
                  </header>

                  <div className="vh-summary-grid">
                    <div className="vh-summary-card">
                      <span>分镜数量</span>
                      <strong>{detailSummary.storyboardCount}</strong>
                    </div>
                    <div className="vh-summary-card">
                      <span>镜头段</span>
                      <strong>{detailSummary.segmentCount}</strong>
                    </div>
                    <div className="vh-summary-card">
                      <span>字幕条数</span>
                      <strong>{detailSummary.subtitleCount}</strong>
                    </div>
                    <div className="vh-summary-card">
                      <span>视频状态</span>
                      <strong>{detailSummary.hasVideo ? '已生成' : '未生成'}</strong>
                    </div>
                  </div>

                  {detailSummary.description && (
                    <section className="vh-detail-block">
                      <h4>创意描述</h4>
                      <p>{detailSummary.description}</p>
                    </section>
                  )}

                  {detailSummary.generatedPrompt && (
                    <section className="vh-detail-block">
                      <h4>提示词</h4>
                      <p>{detailSummary.generatedPrompt}</p>
                    </section>
                  )}

                  {creativeScriptBlocks.length > 0 && (
                    <section className="vh-detail-block">
                      <h4>创意脚本</h4>
                      <div className="vh-script-list">
                        {creativeScriptBlocks.map((block, index) => (
                          <article key={`script-block-${index + 1}`} className="vh-script-card">
                            <p className="vh-script-text">{block}</p>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  {storyboardTextItems.length > 0 && (
                    <section className="vh-detail-block">
                      <h4>分镜内容</h4>
                      <div className="vh-storyboard-text-list">
                        {storyboardTextItems.map((item: any) => (
                          <article key={item.id} className="vh-storyboard-text-card">
                            <strong>{item.title}</strong>
                            {item.prompt && <p className="vh-storyboard-text">{item.prompt}</p>}
                            {item.voiceover && (
                              <div className="vh-storyboard-line">
                                <span>旁白</span>
                                <em>{item.voiceover}</em>
                              </div>
                            )}
                            {item.subtitle && (
                              <div className="vh-storyboard-line">
                                <span>字幕</span>
                                <em>{item.subtitle}</em>
                              </div>
                            )}
                            {item.sfx && (
                              <div className="vh-storyboard-line">
                                <span>音效</span>
                                <em>{item.sfx}</em>
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="vh-detail-block">
                    <h4>创作参数</h4>
                    <div className="vh-tags">
                      {detailSummary.selectedPlatform && (
                        <span className="vh-tag">{detailSummary.selectedPlatform}</span>
                      )}
                      {detailSummary.selectedDuration && (
                        <span className="vh-tag">{detailSummary.selectedDuration}</span>
                      )}
                      {detailSummary.selectedRatio && <span className="vh-tag">{detailSummary.selectedRatio}</span>}
                      {detailSummary.selectedStyles.map((style: any) => (
                        <span key={style} className="vh-tag">
                          {style}
                        </span>
                      ))}
                    </div>
                  </section>

                  <section className="vh-detail-block">
                    <h4>时间线摘要</h4>
                    <div className="vh-metrics">
                      <span>配音 {detailSummary.voiceCount}</span>
                      <span>字幕 {detailSummary.subtitleCount}</span>
                      <span>音效 {detailSummary.sfxCount}</span>
                    </div>
                  </section>

                  <div className="vh-detail-actions">
                    <button
                      type="button"
                      className="vh-danger"
                      disabled={busy}
                      onClick={() => onDelete?.(detailVersion)}
                    >
                      删除版本
                    </button>
                    <button
                      type="button"
                      className="vh-primary"
                      disabled={busy}
                      onClick={() => onRestore?.(detailVersion)}
                    >
                      {restoring ? '恢复中…' : '恢复此版本'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </section>
      </aside>
    </div>
  )
}
