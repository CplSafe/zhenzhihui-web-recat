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
import { useConfirmDialog } from '@/composables/useToast'
import { sanitizeMediaUrl } from '@/utils/urlSafety'
import { readVoiceLibrary } from '@/utils/voiceLibrary'
import { assetStreamUrl } from '@/utils/assetUrl'
import styles from './CanvasVoiceLibrary.module.css'

interface Props {
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
            ? '上传本人或已获授权的录音，选择 MiniMax 或火山引擎复刻；费用规则以所选供应商说明为准。'
            : '添加音色需要空间所有者或管理员权限，请联系空间管理员。'}
        </p>
      )}
      <div
        className={`${styles.filters} ${source === 'cloned' && !expandedFilters ? styles.myFilters : ''}`}
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
          if (browseOnly && source === 'cloned' && !expandedFilters && field.key !== 'provider' && !selected?.length)
            return null
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
        {browseOnly && source === 'cloned' && (
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
            <small>
              {[voice.language ? languageLabel(voice.language) : '语种未标注', voice.gender, ...(voice.tags || [])]
                .filter(Boolean)
                .join(' · ')}
            </small>
            {sanitizeMediaUrl(voice.preview_url) ? (
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
            ) : (
              <p className={styles.note}>
                {voice.source === 'public' || browseOnly ? '暂无试听。' : '暂无试听，尝试同步获取最新地址。'}
              </p>
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
  mode,
  voice,
  userId,
  workspaceId,
  onClose,
  onSaved,
  onBusyChange,
}: {
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
  const [provider, setProvider] = useState(voice ? voice.provider || 'volcengine-speech' : 'minimax')
  const [duration, setDuration] = useState<number | null>(null)
  const [mediaFailed, setMediaFailed] = useState(false)
  const minimax = provider === 'minimax'
  const [file, setFile] = useState<File | null>(null)
  const [sample, setSample] = useState(0)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
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
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])
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
  const recordingError =
    mode !== 'edit' && (file || sample) && minimax
      ? mediaFailed
        ? '无法读取录音，请重新选择可播放的 MP3、M4A 或 WAV 录音'
        : duration === null
          ? '正在读取录音时长，请稍候'
          : !Number.isFinite(duration) || duration < 10 || duration > 300
            ? `MiniMax 录音需为 10～300 秒，当前为 ${Number.isFinite(duration) ? duration.toFixed(1) : '未知'} 秒，请更换录音`
            : ''
      : ''
  const changeInput = () => {
    setError('')
    if (submitted.current) {
      setKey(crypto.randomUUID())
      submitted.current = false
    }
  }
  const submit = async () => {
    if (submitting.current) return
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
        const formats = minimax ? /\.(wav|mp3|m4a)$/i : /\.(wav|mp3|ogg|m4a|aac)$/i
        if (!formats.test(file.name) || file.size > (minimax ? 20 : 10) * 1024 * 1024 || !file.size)
          throw new Error(
            minimax
              ? '请选择 20 MiB 以内的 MP3、M4A 或 WAV 录音'
              : '请选择 10 MiB 以内的 WAV、MP3、OGG、M4A 或 AAC 录音',
          )
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
          provider: minimax ? 'minimax' : 'volcengine-speech',
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
      className={styles.detail}
      aria-label={mode === 'edit' ? '编辑音色' : mode === 'retry' ? '重试音色训练' : '创建音色表单'}
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && !recordingError && (mode === 'retry' || metadata.name.trim())) void submit()
      }}
    >
      <strong>{mode === 'edit' ? '编辑音色' : mode === 'retry' ? '重试音色训练' : '创建专属音色'}</strong>
      {mode !== 'retry' && (
        <>
          <label>
            音色名称
            <input
              value={metadata.name}
              disabled={busy}
              onChange={(e) => {
                changeInput()
                setMetadata((v) => ({ ...v, name: e.target.value }))
              }}
            />
          </label>
          <details open={mode === 'edit'}>
            <summary>更多信息（可选）</summary>
            <label>
              描述
              <textarea
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
                value={metadata.gender}
                disabled={busy}
                onChange={(e) => {
                  changeInput()
                  setMetadata((v) => ({ ...v, gender: e.target.value }))
                }}
              />
            </label>
            <label>
              标签（逗号分隔）
              <input
                value={metadata.tags?.join(',')}
                disabled={busy}
                onChange={(e) => {
                  changeInput()
                  setMetadata((v) => ({ ...v, tags: e.target.value.split(/[,，]/) }))
                }}
              />
            </label>
          </details>
        </>
      )}
      {mode !== 'edit' && (
        <>
          {mode === 'create' && (
            <label>
              复刻供应商
              <select
                value={provider}
                disabled={busy}
                onChange={(e) => {
                  changeInput()
                  setProvider(e.target.value)
                  setConsent(false)
                }}
              >
                <option value="minimax">MiniMax</option>
                <option value="volcengine-speech">火山引擎</option>
              </select>
            </label>
          )}
          <p>
            {minimax
              ? 'MiniMax：支持 MP3、M4A、WAV，10～300 秒，最大 20 MiB。无需预付费槽位；需在 7 天内首次合成激活，首次合成会产生音色费用。'
              : '火山引擎：支持 WAV、MP3、OGG、M4A、AAC，最大 10 MiB，使用当前空间预付费音色槽位。'}
            {mode === 'retry' && '不选择新录音时沿用原样本；MiniMax 重试会创建新的供应商音色 ID。'}
          </p>
          <label>
            上传训练录音
            <input
              ref={fileInput}
              type="file"
              accept={minimax ? '.mp3,.m4a,.wav' : '.wav,.mp3,.ogg,.m4a,.aac'}
              disabled={busy}
              onChange={(e) => {
                changeInput()
                setDuration(null)
                setMediaFailed(false)
                setFile(e.target.files?.[0] || null)
                setSample(0)
                setConsent(false)
              }}
            />
          </label>
          <label>
            选择本机声音样本
            <select
              value={sample}
              disabled={busy}
              onChange={(e) => {
                changeInput()
                setDuration(null)
                setMediaFailed(false)
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
          {preview && (
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
            <p role={duration === null && !mediaFailed ? 'status' : 'alert'} className={styles.error}>
              {recordingError}
            </p>
          )}
          <label>
            <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
            我确认声音属于本人或已获得音色复刻授权
          </label>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {busy && <p role="status">正在提交，请勿重复操作…</p>}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          type="submit"
          disabled={
            busy ||
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
