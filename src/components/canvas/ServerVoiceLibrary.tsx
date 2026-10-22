import { useEffect, useMemo, useRef, useState } from 'react'
import { Select } from 'antd'
import {
  createVoice,
  deleteVoice,
  getVoice,
  getVoiceFilters,
  VOICE_FILTER_FIELDS,
  isVoiceReady,
  isVoiceTraining,
  listVoices,
  setVoiceFavorite,
  retryVoice,
  syncVoice,
  updateVoice,
  type Voice,
  type VoiceMetadata,
  type VoiceFilterOptions,
  type VoiceFilterValues,
} from '@/api/voices'
import { uploadAssetFile } from '@/api/business'
import VoiceRecorder from './VoiceRecorder'
import { voiceDurationError } from '@/utils/voiceRecording'
import { useLatestCallback } from '@/composables/useLatestCallback'
import { useConfirmDialog } from '@/composables/useToast'
import { sanitizeMediaUrl } from '@/utils/urlSafety'
import { readVoiceLibrary } from '@/utils/voiceLibrary'
import { assetStreamUrl } from '@/utils/assetUrl'
import styles from './CanvasVoiceLibrary.module.css'

interface Props {
  onBeforeCloseChange?: (guard: (() => Promise<boolean>) | null) => void
  userId: string
  workspaceId: number
  modelVersionId?: number
  canManage: boolean
  publicOnly?: boolean
  /** 画布选用入口：允许分类、收藏和添加音色，不开放编辑、删除等管理操作。 */
  browseOnly?: boolean
  disabled: boolean
  onSelect: (voice: Voice) => void
  onBusyChange: (busy: boolean) => void
}
const statusLabel = (voice: Voice) =>
  isVoiceReady(voice)
    ? '可用'
    : isVoiceTraining(voice)
      ? '训练中'
      : voice.status === 'failed'
        ? '训练失败'
        : voice.status || '状态待确认'
const message = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请稍后重试')
const languageNames = new Intl.DisplayNames(['zh-CN'], { type: 'language' })
const languageLabel = (value: string) => {
  try {
    return languageNames.of(value.replace(/_/g, '-')) || value
  } catch {
    return value
  }
}

export default function ServerVoiceLibrary({
  onBeforeCloseChange,
  userId,
  workspaceId,
  modelVersionId,
  canManage,
  publicOnly = false,
  browseOnly = false,
  disabled,
  onSelect,
  onBusyChange,
}: Props) {
  const [items, setItems] = useState<Voice[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [source, setSource] = useState<'' | 'public' | 'cloned' | 'favorites'>(browseOnly ? 'public' : '')
  const [search, setSearch] = useState('')
  const [compatibleOnly, setCompatibleOnly] = useState(true)
  const [filters, setFilters] = useState<VoiceFilterValues>({})
  const [expandedFilters, setExpandedFilters] = useState(false)
  const [filterOptions, setFilterOptions] = useState<VoiceFilterOptions | null>(null)
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [filtersError, setFiltersError] = useState('')
  const [filterRevision, setFilterRevision] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [previewErrors, setPreviewErrors] = useState<Record<number, string>>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<Voice | null>(null)
  const [form, setForm] = useState<{ mode: 'create' | 'edit' | 'retry'; voice?: Voice } | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const actionPending = useRef(false)
  const detailElement = useRef<HTMLElement | null>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const rows = useRef(items)
  rows.current = items
  useEffect(() => {
    if (detail) detailElement.current?.focus()
  }, [detail])
  const { requestConfirm } = useConfirmDialog()
  const query = useMemo(
    () => ({
      ...filters,
      workspaceId,
      modelVersionId: compatibleOnly ? modelVersionId : undefined,
      source: publicOnly ? ('public' as const) : source === 'public' || source === 'cloned' ? source : undefined,
      favorites: !publicOnly && source === 'favorites' ? true : undefined,
      q: search.trim() || undefined,
    }),
    [filters, workspaceId, modelVersionId, compatibleOnly, source, publicOnly, search],
  )
  useEffect(() => {
    const controller = new AbortController()
    setFiltersLoading(true)
    setFiltersError('')
    const timer = window.setTimeout(() => {
      void getVoiceFilters({ ...query, signal: controller.signal })
        .then((options) => {
          if (!controller.signal.aborted) setFilterOptions(options)
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setFilterOptions(null)
            setFiltersError(message(e))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setFiltersLoading(false)
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, revision, filterRevision])
  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [workspaceId, userId])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setItems([])
    setDetail(null)
    setPreviewErrors({})
    const timer = window.setTimeout(() => {
      void listVoices({
        ...query,
        limit: 20,
        offset,
        signal: controller.signal,
      })
        .then((page) => {
          if (!controller.signal.aborted) {
            setItems(publicOnly ? page.items.filter((voice) => voice.source === 'public') : page.items)
            setTotal(page.total)
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(message(e))
            setTotal(0)
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, offset, revision, publicOnly])
  const replace = (voice: Voice) => {
    setItems((previous) => previous.map((item) => (item.id === voice.id ? voice : item)))
    setDetail((previous) => (previous?.id === voice.id ? voice : previous))
  }
  useEffect(() => {
    const controller = new AbortController()
    let timer = 0
    const poll = async () => {
      if (!document.hidden) {
        for (const voice of rows.current.filter(isVoiceTraining).slice(0, 5)) {
          try {
            const updated = await (browseOnly ? getVoice : syncVoice)(
              { workspaceId, signal: controller.signal },
              voice.id,
            )
            if (!controller.signal.aborted) replace(updated)
          } catch {
            /* 暂时失败保留原状态，用户仍可手动同步。 */
          }
          if (controller.signal.aborted) return
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 10000)
    }
    timer = window.setTimeout(() => void poll(), 10000)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [workspaceId, browseOnly])
  const action = async (task: (signal: AbortSignal) => Promise<void>) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || actionPending.current || disabled) return
    actionPending.current = true
    setBusy(true)
    setError('')
    try {
      await task(controller.signal)
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e))
    } finally {
      actionPending.current = false
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const select = (voice: Voice) =>
    void action(async (signal) => {
      if (!modelVersionId) throw new Error('请先选择配音模型')
      const current = await getVoice({ workspaceId, signal }, voice.id)
      if (!isVoiceReady(current)) {
        replace(current)
        throw new Error('该音色尚不可用，请稍后重试或选择其他音色')
      }
      if (!signal.aborted) onSelect(current)
    })
  const controlsDisabled = disabled || busy
  const showCreate = !publicOnly && (!browseOnly || source === 'cloned')
  if (form)
    return (
      <VoiceForm
        key={`${form.mode}:${form.voice?.id || 0}`}
        {...form}
        onBeforeCloseChange={onBeforeCloseChange}
        userId={userId}
        workspaceId={workspaceId}
        onBusyChange={onBusyChange}
        onClose={() => setForm(null)}
        onSaved={() => {
          if (form.mode === 'create') {
            setSearch('')
            setFilters({})
            setOffset(0)
            setCompatibleOnly(false)
            if (browseOnly) setSource('cloned')
            setNotice('音色创建请求已提交，请查看训练状态；训练完成后可选用。')
          }
          setForm(null)
          setRevision((v) => v + 1)
        }}
      />
    )
  return (
    <section className={styles.serverLibrary} aria-label={browseOnly ? '音色列表' : '公共音色库'}>
      {browseOnly && (
        <div className={styles.tabs} role="group" aria-label="音色分类">
          {(
            [
              ['public', '系统音色'],
              ['cloned', '我的音色'],
              ['favorites', '收藏'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={source === value}
              disabled={busy}
              onClick={() => {
                setSource(value)
                setSearch('')
                setFilters({})
                setExpandedFilters(false)
                setOffset(0)
                setNotice('')
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className={styles.toolbar}>
        <div>
          <p>
            {!modelVersionId
              ? '可浏览音色；选用前请先选择支持音色库的配音模型。'
              : browseOnly && source === 'cloned'
                ? '当前空间的自建音色，可按模型兼容性筛选。'
                : compatibleOnly
                  ? '已按当前模型筛选兼容音色。'
                  : publicOnly
                    ? '展示公共音色；开启模型兼容筛选后可选用。'
                    : '展示全部音色供管理；开启模型兼容筛选后可选用。'}
          </p>
        </div>
        {showCreate && (
          <button
            className={styles.primary}
            type="button"
            disabled={controlsDisabled || !canManage}
            title={!canManage ? '仅空间所有者或管理员可创建音色' : undefined}
            onClick={() => {
              setNotice('')
              setForm({ mode: 'create' })
            }}
          >
            {browseOnly ? '添加音色' : '创建音色'}
          </button>
        )}
      </div>
      {showCreate && (
        <p className={styles.note}>
          {canManage
            ? '上传本人或已获授权的录音，使用 MiniMax 复刻；费用规则以供应商说明为准。'
            : '添加音色需要空间所有者或管理员权限，请联系空间管理员。'}
        </p>
      )}
      <div
        className={`${styles.filters} ${browseOnly && !expandedFilters ? styles.compactFilters : ''}`}
        aria-label="音色筛选"
      >
        <input
          className={styles.search}
          aria-label={browseOnly ? '搜索音色' : '搜索公共音色'}
          placeholder="搜索音色名称或描述"
          value={search}
          disabled={busy}
          onChange={(e) => {
            setSearch(e.target.value)
            setOffset(0)
          }}
        />
        {!publicOnly && !browseOnly && (
          <select
            aria-label="音色来源"
            value={source}
            disabled={busy}
            onChange={(e) => {
              setSource(e.target.value as typeof source)
              setOffset(0)
            }}
          >
            <option value="">全部音色</option>
            {filterOptions?.sources.includes('public') && <option value="public">公共音色</option>}
            {filterOptions?.sources.includes('cloned') && <option value="cloned">自建音色</option>}
            <option value="favorites">个人收藏</option>
          </select>
        )}
        {VOICE_FILTER_FIELDS.map((field) => {
          const values = filterOptions?.[field.options] || []
          const selected = filters[field.key]
          const primaryFilter = source === 'cloned' ? 'provider' : 'language'
          if (browseOnly && !expandedFilters && field.key !== primaryFilter && !selected?.length) return null
          if (!values.length && !selected?.length) return null
          return (
            <Select
              key={field.key}
              className={styles.languageFilter}
              classNames={{ popup: { root: `nodrag nopan nowheel ${styles.languagePopup}` } }}
              popupRender={(menu) => <div onWheel={(event) => event.stopPropagation()}>{menu}</div>}
              aria-label={`音色${field.label}`}
              placeholder={`全部${field.label}`}
              mode={'multiple' in field ? 'multiple' : undefined}
              maxTagCount="responsive"
              value={selected}
              showSearch
              allowClear
              optionFilterProp="label"
              loading={filtersLoading}
              disabled={busy || (filtersLoading && !filterOptions)}
              options={values.map((value) => ({
                value,
                label: field.key === 'language' ? `${languageLabel(value)}（${value}）` : value,
              }))}
              notFoundContent={filtersError ? '筛选选项加载失败，请重试' : '暂无匹配选项'}
              onChange={(value: string | string[] | undefined) => {
                setFilters((previous) => ({ ...previous, [field.key]: value?.length ? value : undefined }))
                setOffset(0)
              }}
            />
          )
        })}
      </div>
      {filtersLoading && !filterOptions && (
        <p className={styles.note} role="status">
          正在加载筛选选项…
        </p>
      )}
      {filtersError && (
        <p role="alert" className={styles.note}>
          筛选选项加载失败：{filtersError}
          <button type="button" disabled={busy} onClick={() => setFilterRevision((v) => v + 1)}>
            重试筛选
          </button>
        </p>
      )}
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}
      <div className={styles.resultTools}>
        <label className={styles.compatibility}>
          <input
            type="checkbox"
            checked={compatibleOnly}
            disabled={busy || !modelVersionId}
            onChange={(event) => {
              setCompatibleOnly(event.target.checked)
              setOffset(0)
            }}
          />
          只看当前模型兼容音色
        </label>
        {browseOnly && (
          <button
            type="button"
            disabled={busy}
            aria-expanded={expandedFilters}
            onClick={() => setExpandedFilters((value) => !value)}
          >
            {expandedFilters ? '收起筛选' : '更多筛选'}
          </button>
        )}
        {(search || Object.values(filters).some((value) => value?.length)) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSearch('')
              setFilters({})
              setOffset(0)
            }}
          >
            清除筛选
          </button>
        )}
      </div>
      {!compatibleOnly && modelVersionId && (
        <p className={styles.note}>当前展示全部音色；开启“只看当前模型兼容音色”后可选用。</p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}{' '}
          <button type="button" disabled={controlsDisabled} onClick={() => setRevision((v) => v + 1)}>
            重新加载
          </button>
        </p>
      )}
      {loading && <p role="status">正在加载音色…</p>}
      {!loading && !error && !items.length && (
        <p className={styles.empty} role="status">
          {browseOnly && source === 'favorites' && !search && !Object.values(filters).some((value) => value?.length)
            ? '暂无符合条件的收藏，可在系统音色或我的音色中添加收藏，或调整兼容筛选。'
            : '暂无符合条件的音色。'}
        </p>
      )}
      <div className={styles.grid} aria-busy={loading}>
        {items.map((voice) => (
          <article className={styles.serverCard} key={voice.id}>
            <div className={styles.heading}>
              <strong>{voice.name}</strong>
              <span className={styles.tag}>{statusLabel(voice)}</span>
            </div>
            <p>{voice.description || (voice.source === 'public' ? '公共音色' : '自建音色')}</p>
            {(voice.language || voice.gender || voice.tags?.some(Boolean)) && (
              <small>
                {[voice.language ? languageLabel(voice.language) : '', voice.gender, ...(voice.tags || [])]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            )}
            {sanitizeMediaUrl(voice.preview_url) && (
              <audio
                controls
                preload="none"
                src={sanitizeMediaUrl(voice.preview_url)}
                aria-label={`试听 ${voice.name}`}
                onError={() =>
                  setPreviewErrors((previous) => ({
                    ...previous,
                    [voice.id]:
                      voice.source === 'public' || browseOnly
                        ? '试听暂时不可用，请稍后重试'
                        : '试听暂时不可用，请点击该音色的“同步”获取最新地址',
                  }))
                }
              />
            )}
            {previewErrors[voice.id] && (
              <p role="alert" className={styles.error}>
                {previewErrors[voice.id]}
              </p>
            )}
            {voice.last_error && <p className={styles.error}>{voice.last_error}</p>}
            <div className={styles.actions}>
              {browseOnly && (
                <button
                  type="button"
                  aria-label={`${voice.is_favorite ? '取消收藏' : '收藏'} ${voice.name}`}
                  aria-pressed={Boolean(voice.is_favorite)}
                  disabled={controlsDisabled}
                  onClick={() =>
                    void action(async (signal) => {
                      await setVoiceFavorite({ workspaceId, signal }, voice.id, !voice.is_favorite)
                      if (!signal.aborted) {
                        replace({ ...voice, is_favorite: !voice.is_favorite })
                        setRevision((value) => value + 1)
                      }
                    })
                  }
                >
                  {voice.is_favorite ? '已收藏' : '收藏'}
                </button>
              )}
              <button
                type="button"
                className={styles.useVoice}
                title={
                  !modelVersionId
                    ? '请先选择配音模型'
                    : !compatibleOnly
                      ? '请先开启模型兼容筛选'
                      : !isVoiceReady(voice)
                        ? '音色尚未就绪，请等待训练完成'
                        : undefined
                }
                disabled={controlsDisabled || !modelVersionId || !compatibleOnly || !isVoiceReady(voice)}
                onClick={() => select(voice)}
              >
                选用
              </button>
              <button
                type="button"
                aria-expanded={detail?.id === voice.id}
                disabled={controlsDisabled}
                onClick={(event) => {
                  detailTrigger.current = event.currentTarget
                  void action(async (signal) => {
                    if (detail?.id === voice.id) {
                      setDetail(null)
                      return
                    }
                    const value = await getVoice({ workspaceId, signal }, voice.id)
                    if (!signal.aborted) setDetail(value)
                  })
                }}
              >
                详情
              </button>
              {!browseOnly && voice.source !== 'public' && (
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() =>
                    void action(async (signal) => {
                      const value = await syncVoice({ workspaceId, signal }, voice.id)
                      if (!signal.aborted) replace(value)
                    })
                  }
                >
                  同步
                </button>
              )}
              {!publicOnly && !browseOnly && canManage && voice.source === 'cloned' && (
                <>
                  <button type="button" disabled={controlsDisabled} onClick={() => setForm({ mode: 'edit', voice })}>
                    编辑
                  </button>
                  {voice.status === 'failed' && (
                    <button
                      type="button"
                      disabled={controlsDisabled || voice.remaining_training_times === 0}
                      onClick={() => setForm({ mode: 'retry', voice })}
                    >
                      重试训练
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={controlsDisabled}
                    onClick={() =>
                      void action(async (signal) => {
                        if (
                          !(await requestConfirm(
                            '删除后不会回收预付费槽位，也不会删除供应商记录或历史配音素材。确定删除？',
                            { title: '删除音色' },
                          ))
                        )
                          return
                        if (signal.aborted) return
                        await deleteVoice({ workspaceId, signal }, voice.id)
                        if (!signal.aborted) setRevision((v) => v + 1)
                      })
                    }
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {detail && (
        <aside ref={detailElement} tabIndex={-1} className={styles.detail} aria-label="音色详情">
          <div className={styles.heading}>
            <strong>{detail.name}</strong>
            <button
              type="button"
              onClick={() => {
                setDetail(null)
                detailTrigger.current?.focus()
              }}
            >
              收起详情
            </button>
          </div>
          <p>{detail.description || '暂无描述'}</p>
          <p>
            状态：{statusLabel(detail)} · 剩余训练次数：{detail.remaining_training_times ?? '未知'}
          </p>
          <p>支持版本：{detail.supported_versions?.join('、') || '由服务端验证'}</p>
          {detail.preview_expires_at && <p>试听地址有效期：{detail.preview_expires_at}</p>}
        </aside>
      )}
      <div className={styles.footer}>
        <span>
          共 {total} 个音色 · 第 {Math.floor(offset / 20) + 1} 页
        </span>
        <button
          type="button"
          disabled={controlsDisabled || loading || offset === 0}
          onClick={() => setOffset((v) => Math.max(0, v - 20))}
        >
          上一页
        </button>
        <button
          type="button"
          disabled={controlsDisabled || loading || offset + 20 >= total}
          onClick={() => setOffset((v) => v + 20)}
        >
          下一页
        </button>
      </div>
    </section>
  )
}

function VoiceForm({
  onBeforeCloseChange,
  mode,
  voice,
  userId,
  workspaceId,
  onClose,
  onSaved,
  onBusyChange,
}: {
  onBeforeCloseChange?: (guard: (() => Promise<boolean>) | null) => void
  mode: 'create' | 'edit' | 'retry'
  voice?: Voice
  userId: string
  workspaceId: number
  onClose: () => void
  onSaved: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const [metadata, setMetadata] = useState<VoiceMetadata>({
    name: voice?.name || '',
    description: voice?.description || '',
    language: voice?.language || '',
    gender: voice?.gender || '',
    tags: voice?.tags || [],
  })
  const provider = voice ? voice.provider || 'volcengine-speech' : 'minimax'
  const [nameTouched, setNameTouched] = useState(false)
  const [dragOverUpload, setDragOverUpload] = useState(false)
  const [dropError, setDropError] = useState('')
  const [inputOrigin, setInputOrigin] = useState<'recording' | 'upload' | 'sample'>('upload')
  const [duration, setDuration] = useState<number | null>(null)
  const [mediaFailed, setMediaFailed] = useState(false)
  const minimax = provider === 'minimax'
  const [file, setFile] = useState<File | null>(null)
  const [sample, setSample] = useState(0)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recordingActive, setRecordingActive] = useState(false)
  const [recordingDraft, setRecordingDraft] = useState(false)
  const [recordingReset, setRecordingReset] = useState(0)
  const { requestConfirm } = useConfirmDialog()
  const canClose = useLatestCallback(async () => {
    if (busy || recordingActive) return false
    return (
      !(file || recordingDraft) ||
      Boolean(await requestConfirm('退出将丢弃本次未提交的录音，确定退出吗？', { title: '丢弃录音', zIndex: 2300 }))
    )
  })
  useEffect(() => {
    onBeforeCloseChange?.(canClose)
    return () => onBeforeCloseChange?.(null)
  }, [canClose, onBeforeCloseChange])
  useEffect(() => {
    if (!file && !recordingDraft && !recordingActive) return
    const preventLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventLeave)
    return () => window.removeEventListener('beforeunload', preventLeave)
  }, [file, recordingDraft, recordingActive])
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const [key, setKey] = useState(() => crypto.randomUUID())
  const submitted = useRef(false)
  const uploaded = useRef<{ file: File; assetId: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const submitting = useRef(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    onBusyChange(busy || recordingActive)
    return () => onBusyChange(false)
  }, [busy, recordingActive, onBusyChange])
  const samples = readVoiceLibrary(userId, workspaceId)
  useEffect(() => {
    if (!file) {
      setPreview(sample > 0 ? assetStreamUrl(sample, workspaceId) : '')
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file, sample, workspaceId])
  useEffect(() => {
    if (!preview || duration !== null || mediaFailed) return
    const timer = window.setTimeout(() => setMediaFailed(true), 15000)
    return () => window.clearTimeout(timer)
  }, [preview, duration, mediaFailed])
  const fileError = file
    ? !(minimax ? /\.(wav|mp3|m4a)$/i : /\.(wav|mp3|ogg|m4a|aac)$/i).test(file.name) ||
      file.size > (minimax ? 20 : 10) * 1024 * 1024 ||
      !file.size
      ? minimax
        ? '请选择 20 MiB 以内的 MP3、M4A 或 WAV 录音'
        : '请选择 10 MiB 以内的 WAV、MP3、OGG、M4A 或 AAC 录音'
      : ''
    : ''
  const recordingError =
    mode !== 'edit' && (file || sample)
      ? fileError || (mediaFailed ? '无法读取录音，请重新选择可播放的音频' : voiceDurationError(duration, minimax))
      : ''
  const changeInput = () => {
    setError('')
    if (submitted.current) {
      setKey(crypto.randomUUID())
      submitted.current = false
    }
  }
  const selectTrainingFile = (nextFile: File | null): void => {
    changeInput()
    setDropError('')
    setInputOrigin('upload')
    setRecordingDraft(false)
    setRecordingReset((value) => value + 1)
    setDuration(null)
    setMediaFailed(false)
    setFile(nextFile)
    setSample(0)
    setConsent(false)
    if (fileInput.current) fileInput.current.value = ''
  }
  const submit = async () => {
    if (submitting.current || recordingActive || recordingDraft) return
    submitting.current = true
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError('')
    let stage = '录音检查'
    try {
      if (mode !== 'retry' && !metadata.name.trim()) throw new Error('请输入音色名称')
      if (mode === 'create' && !file && !sample) throw new Error('请选择录音或声音样本')
      if (mode !== 'edit' && (mode === 'create' || file || sample) && !consent) throw new Error('请确认声音授权')
      if (recordingError) throw new Error(recordingError)
      let assetId = sample
      if (mode !== 'edit' && file) {
        if (fileError) throw new Error(fileError)
        if (uploaded.current?.file === file) assetId = uploaded.current.assetId
        else {
          stage = '录音上传'
          const result = await uploadAssetFile({ workspaceId, file, signal: abort.signal })
          assetId = Number(result?.asset?.id)
          if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('上传未返回有效素材 ID')
          uploaded.current = { file, assetId }
        }
      }
      if (abort.signal.aborted) return
      const context = { workspaceId, signal: abort.signal }
      stage = mode === 'edit' ? '音色保存' : mode === 'retry' ? '训练重试' : '音色创建'
      if (mode === 'edit') await updateVoice(context, voice!.id, metadata)
      else if (mode === 'retry') {
        if ((file || sample) && !consent) throw new Error('请确认替换录音的授权')
        await retryVoice(context, voice!.id, assetId || undefined)
      } else {
        if (!assetId) throw new Error('请选择录音或声音样本')
        if (!consent) throw new Error('请确认声音授权')
        submitted.current = true
        await createVoice(context, {
          ...metadata,
          provider: 'minimax',
          sample_asset_id: assetId,
          consent_confirmed: true,
          idempotency_key: key,
        })
      }
      if (!abort.signal.aborted) onSaved()
    } catch (e) {
      if (!abort.signal.aborted) {
        const failure = e as {
          status?: number
          code?: string | number
          requestId?: string
          response?: { code_string?: string }
        }
        const unauthorized =
          failure?.status === 401 ||
          String(failure?.code) === '10101' ||
          failure?.code === 'UNAUTHORIZED' ||
          failure?.response?.code_string === 'UNAUTHORIZED'
        const details = [
          failure?.status ? `HTTP ${failure.status}` : '',
          failure?.code != null ? `错误码 ${failure.response?.code_string || failure.code}` : '',
          failure?.requestId ? `请求编号 ${failure.requestId}` : '',
        ]
          .filter(Boolean)
          .join('；')
        setError(
          `${stage}失败：${unauthorized ? '登录状态已失效，请重新登录后再提交' : message(e)}${details ? `（${details}）` : ''}`,
        )
      }
    } finally {
      submitting.current = false
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  return (
    <form
      className={`${styles.detail} ${styles.cloneForm}`}
      aria-label={mode === 'edit' ? '编辑音色' : mode === 'retry' ? '重试音色训练' : '创建音色表单'}
      onSubmit={(event) => {
        event.preventDefault()
        if (
          !busy &&
          !recordingActive &&
          !recordingDraft &&
          !recordingError &&
          (mode === 'retry' || metadata.name.trim())
        )
          void submit()
      }}
    >
      <div className={styles.heading}>
        <strong>{mode === 'edit' ? '编辑音色' : mode === 'retry' ? '重试音色训练' : '创建专属音色'}</strong>
        <button
          type="button"
          disabled={busy || recordingActive}
          onClick={async () => {
            if (await canClose()) onClose()
          }}
        >
          返回音色列表
        </button>
      </div>
      {mode !== 'retry' && (
        <section className={styles.basicSection} aria-label="基础信息">
          <h3>基础信息</h3>
          <div className={styles.basicFields}>
            <label>
              音色名称
              <input
                value={metadata.name}
                required
                placeholder="例如：品牌旁白、我的声音"
                aria-invalid={nameTouched && !metadata.name.trim()}
                onBlur={() => setNameTouched(true)}
                disabled={busy}
                onChange={(e) => {
                  changeInput()
                  setMetadata((v) => ({ ...v, name: e.target.value }))
                }}
              />
            </label>
            {mode === 'create' && (
              <label>
                复刻供应商
                <select defaultValue="minimax" disabled={busy}>
                  <option value="minimax">MiniMax</option>
                </select>
              </label>
            )}
          </div>
          {nameTouched && !metadata.name.trim() && (
            <p role="alert" className={styles.error}>
              请输入音色名称
            </p>
          )}
          <details className={styles.optionalDetails} open={mode === 'edit'}>
            <summary>更多信息（可选）</summary>
            <div className={styles.optionalFields}>
              <p className={styles.optionalHint}>补充声音特点，方便之后查找和选用。</p>
              <label className={styles.wideField}>
                描述
                <textarea
                  rows={2}
                  placeholder="例如：温柔自然的旁白，适合生活分享类视频"
                  value={metadata.description}
                  disabled={busy}
                  onChange={(e) => {
                    changeInput()
                    setMetadata((v) => ({ ...v, description: e.target.value }))
                  }}
                />
              </label>
              <label>
                语种
                <input
                  placeholder="例如：中文、英语"
                  value={metadata.language}
                  disabled={busy}
                  onChange={(e) => {
                    changeInput()
                    setMetadata((v) => ({ ...v, language: e.target.value }))
                  }}
                />
              </label>
              <label>
                声音性别描述
                <input
                  placeholder="例如：女声、男声、中性"
                  value={metadata.gender}
                  disabled={busy}
                  onChange={(e) => {
                    changeInput()
                    setMetadata((v) => ({ ...v, gender: e.target.value }))
                  }}
                />
              </label>
              <label className={styles.wideField}>
                标签（逗号分隔）
                <input
                  placeholder="例如：温柔，清晰，旁白"
                  value={metadata.tags?.join(',')}
                  disabled={busy}
                  onChange={(e) => {
                    changeInput()
                    setMetadata((v) => ({ ...v, tags: e.target.value.split(/[,，]/) }))
                  }}
                />
              </label>
            </div>
          </details>
        </section>
      )}
      {mode !== 'edit' && (
        <>
          <p className={styles.formHint}>选择一种音频来源即可：现场录制，或上传已有录音。</p>
          <div className={styles.audioSources}>
            <VoiceRecorder
              key={recordingReset}
              disabled={busy}
              onActiveChange={setRecordingActive}
              onDraftChange={setRecordingDraft}
              onRecorded={(recordedFile, recordedDuration) => {
                changeInput()
                setInputOrigin('recording')
                setFile(recordedFile)
                setSample(0)
                setDuration(recordedDuration)
                setMediaFailed(false)
                setConsent(false)
                if (fileInput.current) fileInput.current.value = ''
              }}
            />
            <section className={styles.uploadSection} aria-label="上传音频">
              <h3>上传音频</h3>
              <p className={styles.formHint}>选择一段清晰、无背景音乐的单人人声。</p>
              <input
                ref={fileInput}
                className={styles.uploadInput}
                type="file"
                aria-label="上传训练录音"
                accept={minimax ? '.mp3,.m4a,.wav' : '.wav,.mp3,.ogg,.m4a,.aac'}
                disabled={busy || recordingActive}
                aria-describedby="voice-upload-hint"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0]
                  if (nextFile) selectTrainingFile(nextFile)
                }}
              />
              <button
                type="button"
                className={`${styles.uploadDropzone} ${dragOverUpload ? styles.uploadDragging : ''}`}
                disabled={busy || recordingActive}
                aria-describedby="voice-upload-hint"
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  if (!busy && !recordingActive) setDragOverUpload(true)
                }}
                onDragLeave={() => setDragOverUpload(false)}
                onDrop={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  setDragOverUpload(false)
                  if (busy || recordingActive) return
                  const files = event.dataTransfer.files
                  if (files.length > 1) {
                    setDropError('每次仅支持一个音频文件，请重新选择')
                    return
                  }
                  if (files[0]) selectTrainingFile(files[0])
                }}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <strong>{file || sample > 0 ? '更换音频' : '选择音频文件'}</strong>
                <span>{dragOverUpload ? '松开即可选择文件' : '或将音频拖到此处'}</span>
              </button>
              {dropError && (
                <p role="alert" className={styles.error}>
                  {dropError}
                </p>
              )}
              <p id="voice-upload-hint">
                {minimax
                  ? 'MP3 / M4A / WAV · 最大 20 MiB · 10～300 秒'
                  : 'WAV / MP3 / OGG / M4A / AAC · 最大 10 MiB · 至少 10 秒'}
                <br />
                请上传至少 10 秒的清晰人声音频，建议 20～30 秒。
              </p>
              {samples.length > 0 && (
                <>
                  <label>
                    选择本机声音样本
                    <select
                      value={sample}
                      disabled={busy || recordingActive}
                      onChange={(e) => {
                        changeInput()
                        setRecordingDraft(false)
                        setRecordingReset((value) => value + 1)
                        setDuration(null)
                        setMediaFailed(false)
                        setInputOrigin('sample')
                        setSample(Number(e.target.value))
                        setFile(null)
                        if (fileInput.current) fileInput.current.value = ''
                        setConsent(false)
                      }}
                    >
                      <option value={0}>请选择声音样本</option>
                      {samples.map((item) => (
                        <option key={item.assetId} value={item.assetId}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>已有声音样本也需至少 10 秒；采用新录音或样本后，请重新确认声音授权。</p>
                </>
              )}
              {(file || sample > 0) && (
                <p className={styles.selectedAudio} role="status">
                  当前采用：
                  {inputOrigin === 'recording' ? '现场录音' : inputOrigin === 'sample' ? '声音样本' : '上传音频'}
                  {file && ` · ${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MiB`}
                  {duration !== null && Number.isFinite(duration) && ` · ${duration.toFixed(1)} 秒`}
                </p>
              )}
              {(file || sample > 0) && (
                <button
                  type="button"
                  className={styles.removeAudio}
                  disabled={busy || recordingActive}
                  onClick={() => selectTrainingFile(null)}
                >
                  移除音频
                </button>
              )}
              {preview && !fileError && (
                <audio
                  key={preview}
                  src={preview}
                  controls
                  preload="metadata"
                  aria-label="试听训练录音"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                  onError={() => {
                    setDuration(null)
                    setMediaFailed(true)
                  }}
                />
              )}
              {recordingError && (
                <p role={duration === null && !mediaFailed && !fileError ? 'status' : 'alert'} className={styles.error}>
                  {recordingError}
                </p>
              )}
            </section>
          </div>
          <div className={styles.consentSection}>
            <label>
              <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
              我确认声音属于本人或已获得音色复刻授权
            </label>
            <p className={styles.formHint}>仅提交时上传至当前空间，音色按空间权限使用。</p>
            <details className={styles.providerNote}>
              <summary>供应商计费与激活说明</summary>
              <p>
                {minimax
                  ? 'MiniMax 无需预付费槽位；请在 7 天内首次合成激活，首次合成会产生音色费用。'
                  : '使用当前空间预付费音色槽位。'}
                {mode === 'retry' && '不选择新录音时沿用原样本；MiniMax 重试会创建新的供应商音色 ID。'}
              </p>
            </details>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {busy && <p role="status">正在提交，请勿重复操作…</p>}
      <div className={`${styles.actions} ${styles.formActions}`}>
        <button
          type="button"
          disabled={busy || recordingActive}
          onClick={async () => {
            if (await canClose()) onClose()
          }}
        >
          取消
        </button>
        <button
          type="submit"
          className={styles.primary}
          disabled={
            busy ||
            recordingActive ||
            recordingDraft ||
            Boolean(recordingError) ||
            (mode !== 'retry' && !metadata.name.trim()) ||
            (mode === 'create' && (!consent || (!file && !sample))) ||
            (mode === 'retry' && Boolean(file || sample) && !consent)
          }
        >
          {mode === 'edit' ? '保存修改' : mode === 'retry' ? '确认重试' : '提交复刻'}
        </button>
      </div>
    </form>
  )
}
