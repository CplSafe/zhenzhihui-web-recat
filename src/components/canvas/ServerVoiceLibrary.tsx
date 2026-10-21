import { useEffect, useRef, useState } from 'react'
import { Select } from 'antd'
import {
  createVoice,
  deleteVoice,
  getVoice,
  isVoiceReady,
  isVoiceTraining,
  listVoices,
  retryVoice,
  syncVoice,
  updateVoice,
  type Voice,
  type VoiceMetadata,
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
  disabled,
  onSelect,
  onBusyChange,
}: Props) {
  const [items, setItems] = useState<Voice[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [source, setSource] = useState<'' | 'public' | 'cloned' | 'favorites'>('')
  const [search, setSearch] = useState('')
  const [compatibleOnly, setCompatibleOnly] = useState(true)
  const [language, setLanguage] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [languagesLoading, setLanguagesLoading] = useState(false)
  const [languagesError, setLanguagesError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<Voice | null>(null)
  const [form, setForm] = useState<{ mode: 'create' | 'edit' | 'retry'; voice?: Voice } | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const rows = useRef(items)
  rows.current = items
  const { requestConfirm } = useConfirmDialog()
  useEffect(() => {
    const controller = new AbortController()
    setLanguages([])
    setLanguage('')
    setLanguagesLoading(true)
    setLanguagesError(false)
    void (async () => {
      const values = new Set<string>()
      let nextOffset = 0
      while (!controller.signal.aborted) {
        const page = await listVoices({
          workspaceId,
          modelVersionId: compatibleOnly ? modelVersionId : undefined,
          source: publicOnly ? 'public' : source === 'public' || source === 'cloned' ? source : undefined,
          favorites: !publicOnly && source === 'favorites' ? true : undefined,
          limit: 100,
          offset: nextOffset,
          signal: controller.signal,
        })
        for (const voice of page.items) {
          if ((!publicOnly || voice.source === 'public') && voice.language?.trim()) values.add(voice.language)
        }
        nextOffset += page.items.length
        if (!page.items.length || nextOffset >= page.total) break
      }
      if (!controller.signal.aborted)
        setLanguages([...values].sort((a, b) => languageLabel(a).localeCompare(languageLabel(b), 'zh-CN')))
    })()
      .catch(() => {
        if (!controller.signal.aborted) setLanguagesError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLanguagesLoading(false)
      })
    return () => controller.abort()
  }, [workspaceId, modelVersionId, compatibleOnly, source, publicOnly, revision])
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
    const timer = window.setTimeout(() => {
      void listVoices({
        workspaceId,
        modelVersionId: compatibleOnly ? modelVersionId : undefined,
        q: search.trim() || undefined,
        language: language.trim() || undefined,
        source: publicOnly ? 'public' : source === 'public' || source === 'cloned' ? source : undefined,
        favorites: !publicOnly && source === 'favorites' ? true : undefined,
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
  }, [workspaceId, modelVersionId, compatibleOnly, search, language, source, offset, revision, publicOnly])
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
            const updated = await syncVoice({ workspaceId, signal: controller.signal }, voice.id)
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
  }, [workspaceId])
  const action = async (task: (signal: AbortSignal) => Promise<void>) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || busy || disabled) return
    setBusy(true)
    setError('')
    try {
      await task(controller.signal)
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e))
    } finally {
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
          setForm(null)
          setRevision((v) => v + 1)
        }}
      />
    )
  return (
    <section aria-label="公共音色库">
      <div className={styles.heading}>
        <div>
          <p>
            {!modelVersionId
              ? '可浏览公共音色；选用前请先选择支持音色库的配音模型。'
              : compatibleOnly
                ? '已按当前模型筛选兼容音色。'
                : publicOnly
                  ? '展示公共音色；开启模型兼容筛选后可选用。'
                  : '展示全部音色供管理；开启模型兼容筛选后可选用。'}
          </p>
        </div>
        {!publicOnly && (
          <button
            className={styles.primary}
            type="button"
            disabled={controlsDisabled || !canManage}
            title={!canManage ? '仅空间所有者或管理员可创建音色' : undefined}
            onClick={() => setForm({ mode: 'create' })}
          >
            创建音色
          </button>
        )}
      </div>
      <div className={styles.filters}>
        <input
          className={styles.search}
          aria-label="搜索公共音色"
          placeholder="搜索音色名称或描述"
          value={search}
          disabled={busy}
          onChange={(e) => {
            setSearch(e.target.value)
            setOffset(0)
          }}
        />
        {!publicOnly && (
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
            <option value="public">公共音色</option>
            <option value="cloned">自建音色</option>
            <option value="favorites">个人收藏</option>
          </select>
        )}
        <Select
          className={styles.languageFilter}
          classNames={{ popup: { root: `nodrag nopan nowheel ${styles.languagePopup}` } }}
          popupRender={(menu) => <div onWheel={(event) => event.stopPropagation()}>{menu}</div>}
          aria-label="音色语种"
          placeholder="全部语种"
          value={language || undefined}
          showSearch
          allowClear
          optionFilterProp="label"
          loading={languagesLoading}
          disabled={busy || languagesLoading}
          options={languages.map((value) => ({ value, label: `${languageLabel(value)}（${value}）` }))}
          notFoundContent={languagesError ? '语种加载失败，请重试' : '暂无匹配语种'}
          onChange={(value) => {
            setLanguage(value || '')
            setOffset(0)
          }}
        />
      </div>
      {languagesError && (
        <p role="status" className={styles.note}>
          语种选项加载失败。
          <button type="button" disabled={busy} onClick={() => setRevision((v) => v + 1)}>
            重试
          </button>
        </p>
      )}
      {!publicOnly && !canManage && (
        <p className={styles.note}>创建音色需要空间所有者或管理员权限，并使用预付费音色槽位。</p>
      )}
      <label>
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
          暂无符合条件的音色。
          {(search || language) && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setLanguage('')
                setOffset(0)
              }}
            >
              清除筛选
            </button>
          )}
        </p>
      )}
      <div className={styles.grid}>
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
                  setError(
                    voice.source === 'public'
                      ? '试听暂时不可用，请稍后重试'
                      : '试听暂时不可用，请点击该音色的“同步”获取最新地址',
                  )
                }
              />
            ) : (
              <p className={styles.note}>
                {voice.source === 'public' ? '暂无试听。' : '暂无试听，尝试同步获取最新地址。'}
              </p>
            )}
            {voice.last_error && <p className={styles.error}>{voice.last_error}</p>}
            <div className={styles.actions}>
              <button
                type="button"
                disabled={controlsDisabled || !modelVersionId || !compatibleOnly || !isVoiceReady(voice)}
                onClick={() => select(voice)}
              >
                选用
              </button>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() =>
                  void action(async (signal) => {
                    const value = await getVoice({ workspaceId, signal }, voice.id)
                    if (!signal.aborted) setDetail(value)
                  })
                }
              >
                详情
              </button>
              {voice.source !== 'public' && (
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
              {!publicOnly && canManage && voice.source === 'cloned' && (
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
        <aside className={styles.detail} aria-label="音色详情">
          <div className={styles.heading}>
            <strong>{detail.name}</strong>
            <button type="button" onClick={() => setDetail(null)}>
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
  const [file, setFile] = useState<File | null>(null)
  const [sample, setSample] = useState(0)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const [key] = useState(() => crypto.randomUUID())
  const uploaded = useRef<{ file: File; assetId: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
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
  const submit = async () => {
    if (busy) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError('')
    try {
      let assetId = sample
      if (mode !== 'edit' && file) {
        if (!/\.(wav|mp3|ogg|m4a|aac)$/i.test(file.name) || file.size > 10 * 1024 * 1024 || !file.size)
          throw new Error('请选择 10 MiB 以内的 WAV、MP3、OGG、M4A 或 AAC 录音')
        if (uploaded.current?.file === file) assetId = uploaded.current.assetId
        else {
          const result = await uploadAssetFile({ workspaceId, file, signal: abort.signal })
          assetId = Number(result?.asset?.id)
          if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('上传未返回有效素材 ID')
          uploaded.current = { file, assetId }
        }
      }
      if (abort.signal.aborted) return
      const context = { workspaceId, signal: abort.signal }
      if (mode === 'edit') await updateVoice(context, voice!.id, metadata)
      else if (mode === 'retry') {
        if ((file || sample) && !consent) throw new Error('请确认替换录音的授权')
        await retryVoice(context, voice!.id, assetId || undefined)
      } else {
        if (!assetId) throw new Error('请选择录音或声音样本')
        if (!consent) throw new Error('请确认声音授权')
        await createVoice(context, {
          ...metadata,
          sample_asset_id: assetId,
          consent_confirmed: true,
          idempotency_key: key,
        })
      }
      if (!abort.signal.aborted) onSaved()
    } catch (e) {
      if (!abort.signal.aborted) setError(message(e))
    } finally {
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  return (
    <div
      className={styles.detail}
      aria-label={mode === 'edit' ? '编辑音色' : mode === 'retry' ? '重试音色训练' : '创建音色表单'}
    >
      <strong>{mode === 'edit' ? '编辑音色' : mode === 'retry' ? '重试音色训练' : '创建专属音色'}</strong>
      {mode !== 'retry' && (
        <>
          <label>
            音色名称
            <input
              value={metadata.name}
              disabled={busy}
              onChange={(e) => setMetadata((v) => ({ ...v, name: e.target.value }))}
            />
          </label>
          <details open={mode === 'edit'}>
            <summary>更多信息（可选）</summary>
            <label>
              描述
              <textarea
                value={metadata.description}
                disabled={busy}
                onChange={(e) => setMetadata((v) => ({ ...v, description: e.target.value }))}
              />
            </label>
            <label>
              语种
              <input
                value={metadata.language}
                disabled={busy}
                onChange={(e) => setMetadata((v) => ({ ...v, language: e.target.value }))}
              />
            </label>
            <label>
              声音性别描述
              <input
                value={metadata.gender}
                disabled={busy}
                onChange={(e) => setMetadata((v) => ({ ...v, gender: e.target.value }))}
              />
            </label>
            <label>
              标签（逗号分隔）
              <input
                value={metadata.tags?.join(',')}
                disabled={busy}
                onChange={(e) => setMetadata((v) => ({ ...v, tags: e.target.value.split(/[,，]/) }))}
              />
            </label>
          </details>
        </>
      )}
      {mode !== 'edit' && (
        <>
          <p>
            {mode === 'retry' ? '不选择新录音时沿用原样本和槽位。' : '创建将使用当前空间预付费音色槽位。'}录音最大 10
            MiB。
          </p>
          <label>
            上传训练录音
            <input
              type="file"
              accept=".wav,.mp3,.ogg,.m4a,.aac"
              disabled={busy}
              onChange={(e) => {
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
                setSample(Number(e.target.value))
                setFile(null)
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
          {preview && <audio src={preview} controls preload="metadata" aria-label="试听训练录音" />}
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
          type="button"
          disabled={
            busy ||
            (mode !== 'retry' && !metadata.name.trim()) ||
            (mode === 'create' && (!consent || (!file && !sample))) ||
            (mode === 'retry' && Boolean(file || sample) && !consent)
          }
          onClick={() => void submit()}
        >
          {mode === 'edit' ? '保存修改' : mode === 'retry' ? '确认重试' : '提交复刻'}
        </button>
      </div>
    </div>
  )
}
