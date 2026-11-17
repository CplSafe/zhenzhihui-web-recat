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
  image_params?: Record<string, string>
  video_params?: Record<string, string>
}
export type EpisodeDecision =
  | {
      episode_plan: {
        fingerprint: string
        boundaries_confirmed?: boolean
        episodes: Array<Omit<Choice, 'selected'> & { id: string }>
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

const visualNames: Record<string, string> = {
  resolution: '清晰度',
  ratio: '画面比例',
  aspect_ratio: '画面比例',
  size: '尺寸',
  quality: '画质',
}
function visualFields(
  model?: StudioModel,
): Array<{ name: string; options: string[]; default: string; required: boolean }> {
  return (model?.params_schema?.fields || [])
    .filter(
      (field) =>
        Object.prototype.hasOwnProperty.call(visualNames, field.name) &&
        Array.isArray(field.options) &&
        field.options.length &&
        field.options.every((value: unknown) => typeof value === 'string'),
    )
    .map((field) => ({
      name: field.name,
      options: field.options,
      default: typeof field.default === 'string' ? field.default : '',
      required: field.required === true,
    }))
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
  const modelFor = (kind: 'image' | 'video', choice?: Choice) =>
    models.find((m) => m.id === (choice?.[kind] || (kind === 'image' ? image : video)))
  const parameterValue = (
    kind: 'image' | 'video',
    choice: Choice | undefined,
    field: ReturnType<typeof visualFields>[number],
  ) => choice?.[`${kind}_params`]?.[field.name] ?? field.default
  const valid = (choice?: Choice) =>
    (['image', 'video'] as const).every((kind) => {
      const fields = visualFields(modelFor(kind, choice))
      return (
        Object.keys(choice?.[`${kind}_params`] || {}).every((key) => fields.some((f) => f.name === key)) &&
        fields.every((field) => {
          const value = parameterValue(kind, choice, field)
          return value ? field.options?.includes(value) : !field.required
        })
      )
    })
  const parameterSummary = (kind: 'image' | 'video', choice?: Choice) =>
    visualFields(modelFor(kind, choice))
      .map((f) => parameterValue(kind, choice, f))
      .filter(Boolean)
      .join(' · ')
  const selected = preview?.episodes.filter((e) => choices[e.id]?.selected) || []
  const invalidSelected = selected.some((e) => !valid(choices[e.id]))
  const edit = preview?.episodes.find((e) => e.id === editing)
  function patch(id: string, value: Partial<Choice>) {
    setChoices((old) => ({ ...old, [id]: { ...old[id], ...value } }))
  }
  function confirm() {
    if (
      !preview ||
      !selected.length ||
      invalidSelected ||
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
          ...(choices[e.id].image_params ? { image_params: choices[e.id].image_params } : {}),
          ...(choices[e.id].video_params ? { video_params: choices[e.id].video_params } : {}),
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
                          生图：{name('image', choices[episode.id]?.image)} ·{' '}
                          {parameterSummary('image', choices[episode.id])}
                          <br />
                          视频：{name('video', choices[episode.id]?.video)} ·{' '}
                          {parameterSummary('video', choices[episode.id])}
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
            {invalidSelected && <p role="alert">请打开所选集数，补全或调整模型支持的画面参数。</p>}
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
                  invalidSelected ||
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
        <Dialog title={`${edit.title} · 模型与画面参数`} onClose={() => setEditing(undefined)}>
          <div className={styles.content}>
            <p>默认沿用会话模型。已有成功素材会复用，不因选择不同模型重新生成。</p>
            {(['image', 'video'] as const).map((kind) => (
              <div className={styles.content} key={kind}>
                <label className={styles.field}>
                  {kind === 'image' ? '生图模型' : '视频模型'}
                  <select
                    aria-label={kind === 'image' ? '本集生图模型' : '本集视频模型'}
                    value={choices[edit.id]?.[kind] || ''}
                    disabled={disabled}
                    onChange={(e) =>
                      patch(edit.id, {
                        [kind]: e.target.value ? Number(e.target.value) : undefined,
                        [`${kind}_params`]: undefined,
                      })
                    }
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
                {visualFields(modelFor(kind, choices[edit.id])).map((field) => (
                  <label className={styles.field} key={field.name}>
                    {visualNames[field.name]}
                    <select
                      aria-label={`本集${kind === 'image' ? '生图' : '视频'}${visualNames[field.name]}`}
                      value={parameterValue(kind, choices[edit.id], field)}
                      disabled={disabled}
                      onChange={(e) =>
                        patch(edit.id, {
                          [`${kind}_params`]: { ...choices[edit.id]?.[`${kind}_params`], [field.name]: e.target.value },
                        })
                      }
                    >
                      <option value="">{field.required ? '请选择' : '由 Agent 按剧本选择'}</option>
                      {field.options.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ))}
            <p>清晰度、比例和画质会按本集设置执行，选项来自模型支持范围；调整可能影响积分费用。</p>
            <button
              type="button"
              className={styles.primary}
              disabled={disabled || !valid(choices[edit.id])}
              onClick={() => setEditing(undefined)}
            >
              完成设置
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
