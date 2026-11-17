import { useEffect, useState } from 'react'
import { FileText, Settings2 } from 'lucide-react'
import { Dialog } from './StudioCards'
import type { StudioModel } from './studio'
import styles from './ScriptEpisodes.module.css'

interface Episode {
  id: string
  number: number
  title: string
  file_name: string
  characters: number
  start_excerpt?: string
  end_excerpt?: string
}
interface Preview {
  fingerprint: string
  episodes: Episode[]
  range_specified: boolean
  notice: string
  method?: 'rules' | 'model'
  analysis_pending?: boolean
  needs_assistance?: boolean
  can_advance?: boolean
  receipts?: Array<{ task_id: number; actual_cost?: number; estimated_cost?: number; status: string }>
}
interface Choice {
  selected: boolean
  image?: number
  video?: number
}
export type EpisodeDecision =
  | {
      episode_plan: {
        fingerprint: string
        boundaries_confirmed?: boolean
        episodes: Array<{ id: string; image?: number; video?: number }>
      }
    }
  | { discuss_script: true }
interface Props {
  request: <T>(path: string, data?: unknown, signal?: AbortSignal) => Promise<T>
  attachmentIds: string[]
  message: string
  models: StudioModel[]
  image?: number
  video?: number
  mode: 'manual' | 'auto'
  disabled: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
  onConfirm: (decision: EpisodeDecision) => void
}

/** Local configuration is only a proposal; the server re-reads and validates source + scope. */
export function ScriptEpisodes({
  request,
  attachmentIds,
  message,
  models,
  image,
  video,
  mode,
  disabled,
  open,
  onOpen,
  onClose,
  onConfirm,
}: Props) {
  const [loaded, setLoaded] = useState<{ key: string; preview: Preview }>()
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState<string>()
  const [verified, setVerified] = useState(false)
  const key = JSON.stringify([attachmentIds, message])
  const preview = loaded?.key === key ? loaded.preview : undefined
  useEffect(() => {
    const abort = new AbortController()
    setError('')
    setVerified(false)
    let timer: ReturnType<typeof window.setTimeout>
    const load = () => {
      const [ids, text] = JSON.parse(key) as [string[], string]
      request<Preview>('/api/episodes/preview', { attachments: ids, message: text }, abort.signal)
        .then((result) => {
          if (abort.signal.aborted) return
          setLoaded({ key, preview: result })
          if (result.analysis_pending) timer = window.setTimeout(load, 2000)
          setChoices((old) =>
            Object.fromEntries(
              result.episodes.map((episode) => [
                episode.id,
                {
                  ...old[episode.id],
                  selected: result.range_specified,
                },
              ]),
            ),
          )
        })
        .catch((e: unknown) => {
          if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '集数识别失败，请重试。')
        })
    }
    timer = window.setTimeout(load, 300)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [key, request, retry])
  const name = (kind: 'image' | 'video', value?: number) => {
    const model = models.find((m) => m.id === (value || (kind === 'image' ? image : video)))
    return model?.display_name || model?.model || '模型不可用'
  }
  const selected = preview?.episodes.filter((e) => choices[e.id]?.selected) || []
  const edit = preview?.episodes.find((e) => e.id === editing)
  function patch(id: string, value: Partial<Choice>) {
    setChoices((old) => ({ ...old, [id]: { ...old[id], ...value } }))
  }
  function confirm() {
    if (
      !preview ||
      !selected.length ||
      disabled ||
      error ||
      preview.needs_assistance ||
      preview.analysis_pending ||
      (preview.method === 'model' && !verified)
    )
      return
    onConfirm({
      episode_plan: {
        fingerprint: preview.fingerprint,
        ...(preview.method === 'model' ? { boundaries_confirmed: verified } : {}),
        episodes: selected.map((e) => ({
          id: e.id,
          ...(choices[e.id].image ? { image: choices[e.id].image } : {}),
          ...(choices[e.id].video ? { video: choices[e.id].video } : {}),
        })),
      },
    })
  }
  return (
    <section className={styles.intake} aria-label="剧本集数">
      <button type="button" disabled={disabled} className={styles.summary} onClick={onOpen}>
        <FileText size={18} />
        <span>
          剧本集数与模型
          <small>
            {error
              ? '识别失败 · 点击查看'
              : preview
                ? preview.analysis_pending
                  ? '正在辅助识别集数…'
                  : preview.episodes.length
                    ? `已识别 ${preview.episodes.length} 集 · 已选 ${selected.length} 集`
                    : '分集边界待核对 · 点击查看'
                : '正在识别集数…'}
          </small>
        </span>
        <Settings2 size={16} />
      </button>
      <span className={styles.hint}>确认前不会生成图片或视频</span>
      {open && !edit && (
        <Dialog title="剧本集数与模型" onClose={onClose} error={error}>
          <div className={styles.content}>
            {!preview && !error && <p role="status">正在识别剧本集数…</p>}
            {error && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setLoaded(undefined)
                  setRetry((n) => n + 1)
                }}
              >
                重新识别
              </button>
            )}
            {preview && (
              <>
                <p>{preview.notice || '未识别到独立集标题，可以先讨论剧本。'}</p>
                {!!preview.receipts?.length && (
                  <p>
                    分集识别已消耗{' '}
                    {preview.receipts.reduce((sum, item) => sum + (Number(item.actual_cost) || 0), 0).toFixed(3)}{' '}
                    积分，结果会复用。
                  </p>
                )}
                {preview.method === 'model' && !preview.needs_assistance && (
                  <label>
                    <input
                      type="checkbox"
                      checked={verified}
                      disabled={disabled}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    已核对分集标题及开头、结尾
                  </label>
                )}
                <div className={styles.toolbar}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={!!selected.length && selected.length === preview.episodes.length}
                      onChange={(e) =>
                        setChoices((old) =>
                          Object.fromEntries(
                            preview.episodes.map((item) => [item.id, { ...old[item.id], selected: e.target.checked }]),
                          ),
                        )
                      }
                    />
                    选择全部展示集数
                  </label>
                  <span>已选 {selected.length} 集</span>
                </div>
                <div className={styles.list}>
                  {preview.episodes.map((episode) => (
                    <div key={episode.id} className={styles.row}>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${episode.title}`}
                        checked={!!choices[episode.id]?.selected}
                        disabled={disabled}
                        onChange={(e) => patch(episode.id, { selected: e.target.checked })}
                      />
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setEditing(episode.id)}
                        aria-label={`${episode.title}，修改模型`}
                      >
                        <strong>{episode.title}</strong>
                        <span>{episode.file_name}</span>
                        <small>
                          生图：{name('image', choices[episode.id]?.image)}
                          <br />
                          视频：{name('video', choices[episode.id]?.video)}
                        </small>
                        {episode.start_excerpt && <small>开头：{episode.start_excerpt}</small>}
                        {episode.end_excerpt && <small>结尾：{episode.end_excerpt}</small>}
                        <Settings2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p>
              {mode === 'auto'
                ? '全自动：确认后按所选集数和模型制作，产生实际积分消耗。'
                : '手动：确认范围后先规划，每次生成仍由你确认。'}
            </p>
            <div className={styles.footer}>
              <button
                type="button"
                disabled={disabled || preview?.analysis_pending}
                onClick={() => onConfirm({ discuss_script: true })}
              >
                仅讨论剧本
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={
                  disabled ||
                  !selected.length ||
                  !preview ||
                  !!error ||
                  preview.needs_assistance ||
                  preview.analysis_pending ||
                  (preview.method === 'model' && !verified)
                }
                onClick={confirm}
              >
                确认并开始制作
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {open && edit && (
        <Dialog title={`${edit.title} · 模型`} onClose={() => setEditing(undefined)}>
          <div className={styles.content}>
            <p>默认沿用会话模型。已有成功素材会复用，不因选择不同模型重新生成。</p>
            {(['image', 'video'] as const).map((kind) => (
              <label className={styles.field} key={kind}>
                {kind === 'image' ? '生图模型' : '视频模型'}
                <select
                  aria-label={kind === 'image' ? '本集生图模型' : '本集视频模型'}
                  value={choices[edit.id]?.[kind] || ''}
                  disabled={disabled}
                  onChange={(e) => patch(edit.id, { [kind]: e.target.value ? Number(e.target.value) : undefined })}
                >
                  <option value="">沿用会话 · {name(kind)}</option>
                  {models
                    .filter((m) =>
                      m.operation_codes.includes(kind === 'image' ? 'image.text_to_image' : 'video.generate'),
                    )
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name || m.model}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <button type="button" className={styles.primary} onClick={() => setEditing(undefined)}>
              完成设置
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
