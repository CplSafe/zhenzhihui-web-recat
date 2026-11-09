import { isDefiniteSubmissionRejection } from '@/utils/submissionRecovery'
import { useEffect, useRef, useState } from 'react'
import { Modal } from 'antd'
import { useSearchParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import TaskCenterDrawer from '@/components/task/TaskCenterDrawer'
import StepProgress from '@/components/smart/StepProgress'
import PromoOrders from '@/components/task/PromoOrders'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useCurrentUser, useWorkspaceId, useWorkspaceSessionStore } from '@/stores/workspaceSession'
import {
  completePromoUpload,
  createPromoIntake,
  createPromoOrder,
  createPromoUpload,
  deletePromoMaterial,
  getPromoConfig,
  getPromoIntake,
  quotePromo,
  registerPromoOffline,
  retryPromoUpload,
  uploadPromoFile,
  type PromoConfig,
  type PromoMaterial,
  type PromoOrderInput,
  type PromoQuote,
} from '@/api/promo'
import styles from './PromoRealView.module.css'

type Form = Pick<
  PromoOrderInput,
  | 'company'
  | 'contact'
  | 'phone'
  | 'scenario'
  | 'duration_seconds'
  | 'ratio'
  | 'resolution'
  | 'narration'
  | 'brief'
  | 'reference_url'
>
const initial: Form = {
  company: '',
  contact: '',
  phone: '',
  scenario: 'government_corporate',
  duration_seconds: 0,
  ratio: '',
  resolution: '',
  narration: 'both',
  brief: '',
  reference_url: '',
}
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请重试')

export default function PromoRealView() {
  const navigate = useSidebarNavigate()
  const [query, setQuery] = useSearchParams()
  const currentUser = useCurrentUser() as { id?: number; user_id?: number } | null
  const owner = Number(currentUser?.id || currentUser?.user_id || 0)
  const workspace = Number(useWorkspaceId() || 0)
  const scope = `${owner}.${workspace}`
  const refreshWallet = useWorkspaceSessionStore((state) => state.loadSubscriptionLabel)
  const [sidebar, setSidebar] = useState(false)
  const [config, setConfig] = useState<PromoConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configAttempt, setConfigAttempt] = useState(0)
  const [orders, setOrders] = useState(false)
  const orderId = Number(query.get('order') || 0)
  const [started, setStarted] = useState(false)
  const [stage, setStage] = useState<'intro' | 'form' | 'materials' | 'order'>('intro')
  const [token, setToken] = useState('')
  const [restoreToken, setRestoreToken] = useState('')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [materials, setMaterials] = useState<PromoMaterial[]>([])
  const [offline, setOffline] = useState(false)
  const [form, setForm] = useState<Form>(initial)
  const [formValidated, setFormValidated] = useState(false)
  const [draftScope, setDraftScope] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [quote, setQuote] = useState<PromoQuote | null>(null)
  const [pending, setPending] = useState<PromoOrderInput | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [uploadStage, setUploadStage] = useState<Record<number, 'uploading' | 'uploaded' | 'failed'>>({})
  const [uploadingName, setUploadingName] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setConfigLoading(true)
    setError('')
    void getPromoConfig(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        if (value?.enabled === false) {
          setConfig(value)
          return
        }
        if (
          !Array.isArray(value.duration_options_seconds) ||
          !value.duration_options_seconds.length ||
          !Array.isArray(value.ratio_options) ||
          !value.ratio_options.length ||
          !Array.isArray(value.resolution_options) ||
          !value.resolution_options.length ||
          !Array.isArray(value.allowed_mime) ||
          !Number.isFinite(value.footage_min_count) ||
          !value.authorization_text ||
          !value.acknowledgement_text ||
          !value.authorization_version ||
          !value.max_files ||
          !value.max_file_bytes ||
          !value.max_total_bytes
        )
          throw new Error('宣传片配置不完整，请联系客服')
        setConfig(value)
        setForm((old) => ({
          ...old,
          duration_seconds: value.duration_options_seconds.includes(old.duration_seconds)
            ? old.duration_seconds
            : value.duration_options_seconds[0] || 0,
          ratio: value.ratio_options.includes(old.ratio) ? old.ratio : value.ratio_options[0] || '',
          resolution: value.resolution_options.includes(old.resolution)
            ? old.resolution
            : value.resolution_options[0] || '',
        }))
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorMessage(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setConfigLoading(false)
      })
    return () => controller.abort()
  }, [configAttempt])

  useEffect(() => {
    if (!owner || !workspace) return
    setToken('')
    setMaterials([])
    setOffline(false)
    setStarted(false)
    setQuote(null)
    setPending(null)
    setRestoreToken('')
    setRestoreError('')
    setRestoreLoading(false)
    setForm(initial)
    setFormValidated(false)
    setDraftScope('')
    try {
      const savedForm = localStorage.getItem(`zzh.promo.draft.${scope}`)
      if (savedForm) setForm({ ...initial, ...JSON.parse(savedForm) })
    } catch {
      /* ignore invalid draft */
    }
    setDraftScope(scope)
    const saved = localStorage.getItem(`zzh.promo.intake.${scope}`)
    try {
      const body = localStorage.getItem(`zzh.promo.pending.${scope}`)
      if (body) setPending(JSON.parse(body) as PromoOrderInput)
    } catch {
      /* no trusted pending data */
    }
    if (saved) {
      setToken(saved)
      setStarted(true)
      setStage('form')
      setRestoreLoading(true)
      setRestoreToken(saved)
    }
  }, [scope, owner, workspace])

  useEffect(() => {
    if (!restoreToken) return
    const controller = new AbortController()
    setRestoreLoading(true)
    setRestoreError('')
    void getPromoIntake(restoreToken, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setMaterials(result.materials)
          setOffline(localStorage.getItem(`zzh.promo.offline.${scope}`) === '1')
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setRestoreError(errorMessage(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoreLoading(false)
      })
    return () => controller.abort()
  }, [restoreToken, restoreAttempt, scope])

  useEffect(() => {
    if (started && draftScope === scope) {
      try {
        localStorage.setItem(`zzh.promo.draft.${scope}`, JSON.stringify(form))
      } catch {
        /* storage may be unavailable */
      }
    }
  }, [draftScope, scope, started, form])

  const guarded = async (fn: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason))
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(false)
    }
  }
  const start = () =>
    void guarded(async () => {
      if (!config?.enabled || !owner || !workspace) throw new Error('请先登录并选择工作空间')
      const intake = await createPromoIntake(workspace)
      if (!intake.token) throw new Error('上传会话未返回有效编号')
      localStorage.setItem(`zzh.promo.intake.${scope}`, intake.token)
      if (alive.current) {
        setToken(intake.token)
        setStarted(true)
        setStage('form')
      }
    })
  const addFile = (file: File, role: 'footage' | 'logo' | 'supplement', existing?: PromoMaterial) =>
    void guarded(async () => {
      if (!config || !token || pending) return
      setQuote(null)
      if (!config.allowed_mime.includes(file.type)) throw new Error('不支持该文件格式')
      if (role === 'footage' && !file.type.startsWith('image/') && !file.type.startsWith('video/'))
        throw new Error('实拍素材须为图片或视频')
      if (role === 'logo' && !file.type.startsWith('image/')) throw new Error('LOGO 须为图片')
      if (
        existing &&
        ((existing.name && existing.name !== file.name) ||
          (existing.size_bytes != null && existing.size_bytes !== file.size) ||
          (existing.mime_type && existing.mime_type !== file.type))
      )
        throw new Error('请选择与原素材名称、大小及格式一致的文件')
      if (file.size > config.max_file_bytes) throw new Error('文件超过单文件大小限制')
      if (!existing && materials.length >= config.max_files) throw new Error('文件数量已达上限')
      if (
        !existing &&
        materials.reduce((sum, item) => sum + (item.size_bytes || 0), 0) + file.size > config.max_total_bytes
      )
        throw new Error('素材总大小超出限制')
      setUploadingName(file.name)
      try {
        const ticket = existing
          ? await retryPromoUpload(existing.id)
          : await createPromoUpload({
              intake_token: token,
              role,
              name: file.name,
              mime_type: file.type,
              size_bytes: file.size,
            })
        if (!existing) setMaterials((list) => [...list, ticket.material])
        setUploadStage((old) => ({ ...old, [ticket.material.id]: 'uploading' }))
        try {
          await uploadPromoFile(ticket, file)
          setUploadStage((old) => ({ ...old, [ticket.material.id]: 'uploaded' }))
          const material = await completePromoUpload(ticket.material.id)
          if (material.status !== 'active') throw new Error('素材尚未完成，请重试确认')
          setMaterials((list) => list.map((item) => (item.id === material.id ? material : item)))
          setUploadStage((old) => {
            const next = { ...old }
            delete next[material.id]
            return next
          })
        } catch (reason) {
          setUploadStage((old) => ({
            ...old,
            [ticket.material.id]: old[ticket.material.id] === 'uploaded' ? 'uploaded' : 'failed',
          }))
          throw reason
        }
        setQuote(null)
      } finally {
        if (alive.current) setUploadingName('')
      }
    })
  const complete = (id: number) =>
    void guarded(async () => {
      const material = await completePromoUpload(id)
      if (material.status !== 'active') throw new Error('素材尚未完成，请稍后重试')
      setMaterials((list) => list.map((item) => (item.id === id ? material : item)))
      setUploadStage((old) => {
        const next = { ...old }
        delete next[id]
        return next
      })
    })
  const remove = (id: number) =>
    void guarded(async () => {
      setQuote(null)
      await deletePromoMaterial(id)
      setMaterials((list) => list.filter((item) => item.id !== id))
    })
  const setField = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((old) => ({ ...old, [key]: value }))
    setQuote(null)
  }
  const getQuote = () =>
    void guarded(async () => {
      if (!config || !token) return
      if (!form.company.trim() || !form.contact.trim() || !form.phone.trim() || !form.brief.trim())
        throw new Error('请填写公司、联系人、电话和制作需求')
      if (materials.some((item) => item.status !== 'active')) throw new Error('请完成或删除未完成的素材')
      if (
        !offline &&
        materials.filter((item) => item.role === 'footage' && item.status === 'active').length <
          config.footage_min_count
      )
        throw new Error(`至少上传 ${config.footage_min_count} 条实拍素材`)
      const result = await quotePromo({
        intake_token: token,
        duration_seconds: form.duration_seconds,
        ratio: form.ratio,
        resolution: form.resolution,
      })
      if (!result.config_hash || !Number.isFinite(result.total_cost)) throw new Error('报价信息不完整，请重试')
      setQuote(result)
      setStage('order')
    })
  const submit = (body: PromoOrderInput) =>
    void guarded(async () => {
      const previouslyUncertain = pending !== null
      localStorage.setItem(`zzh.promo.pending.${scope}`, JSON.stringify(body))
      setPending(body)
      try {
        const result = await createPromoOrder(body)
        if (!Number.isSafeInteger(result.id) || result.id <= 0 || !result.task_id)
          throw new Error('订单已提交但编号未确认，请重试原请求')
        localStorage.removeItem(`zzh.promo.pending.${scope}`)
        localStorage.removeItem(`zzh.promo.intake.${scope}`)
        localStorage.removeItem(`zzh.promo.offline.${scope}`)
        localStorage.removeItem(`zzh.promo.draft.${scope}`)
        if (alive.current) {
          setPending(null)
          setRestoreToken('')
          setConfirm(false)
          setToken('')
          setStarted(false)
          setForm(initial)
          setStage('intro')
          setQuote(null)
          setQuery({ order: String(result.id) })
          void refreshWallet({ force: true })
        }
      } catch (reason) {
        if (!previouslyUncertain && isDefiniteSubmissionRejection(reason)) {
          localStorage.removeItem(`zzh.promo.pending.${scope}`)
          if (alive.current) setPending(null)
        }
        if (alive.current) setConfirm(false)
        throw reason
      }
    })
  const selectFile =
    (role: 'footage' | 'logo' | 'supplement', existing?: PromoMaterial) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) addFile(file, role, existing)
    }
  return (
    <div className={styles.shell} data-promo-real>
      <AppSidebar activeKey="promo" onNavigate={navigate} open={sidebar} onClose={() => setSidebar(false)} />
      <div className={styles.main}>
        <AppTopbar onMenu={() => setSidebar(true)} />
        <div className={styles.workspace}>
          <TaskCenterDrawer scope="smart" />
          <main className={styles.content}>
            {orders || orderId > 0 ? (
              <PromoOrders
                key={`${scope}-${orderId}`}
                workspaceId={workspace}
                initialOrderId={orderId || undefined}
                serviceTel={config?.service_tel}
                onClose={() => {
                  setOrders(false)
                  setQuery({})
                }}
              />
            ) : (
              <div className={styles.screen}>
                {configLoading && <p role="status">正在加载服务配置…</p>}
                {restoreLoading && <p role="status">正在恢复上次上传会话…</p>}
                {error && (
                  <p role="alert" className={styles.notice}>
                    {error}{' '}
                    {!config && (
                      <button type="button" onClick={() => setConfigAttempt((v) => v + 1)}>
                        重试
                      </button>
                    )}
                  </p>
                )}
                {restoreError && (
                  <p role="alert" className={styles.notice}>
                    上次上传会话恢复失败：{restoreError}{' '}
                    <button type="button" disabled={restoreLoading} onClick={() => setRestoreAttempt((v) => v + 1)}>
                      重试恢复
                    </button>
                  </p>
                )}
                {pending && (
                  <div className={styles.notice} role="status">
                    <p>上次订单提交结果尚未确认，请重试原请求，或先查看订单状态。</p>
                    <button type="button" disabled={busy} onClick={() => setOrders(true)}>
                      查看订单
                    </button>
                    <button type="button" disabled={busy} onClick={() => submit(pending)}>
                      重试原请求
                    </button>
                  </div>
                )}
                {(!started || stage === 'intro' || !config?.enabled) && !pending && (
                  <>
                    <h1 className={styles.heroTitle}>{config?.entry_name || '定制宣传片'}</h1>
                    <p className={styles.heroSubtitle}>实拍＋AI 混剪 · 每单交付 1 条成片</p>
                    <section className={`${styles.panel} ${styles.intro}`}>
                      <div className={styles.introColumns}>
                        <div>
                          <h2>适合做什么</h2>
                          <div className={styles.tags}>
                            <span>政府 / 企业形象片</span>
                            <span>产品发布片</span>
                            <span>招商 / 融资片</span>
                          </div>
                          <h2>你要先准备这些</h2>
                          <div className={styles.plain}>
                            <ul>
                              <li>
                                <b>实拍素材</b>：
                                {config?.footage_min_count != null
                                  ? `至少 ${config.footage_min_count} 条图片或视频。`
                                  : '图片或视频素材，具体要求以服务开放后的配置为准。'}
                              </li>
                              <li>LOGO、VI、口播稿和音乐要求可选传。</li>
                            </ul>
                          </div>
                        </div>
                        <aside>
                          <h2>怎么交付</h2>
                          <div className={styles.plain}>
                            提交需求与素材后进入制作排期，交付后可在订单中播放和下载。修改与交付时间以订单详情为准。
                          </div>
                          <dl className={styles.introFacts}>
                            <div>
                              <dt>时长</dt>
                              <dd>
                                {config?.duration_options_seconds
                                  ?.map((v) => (v >= 60 ? `${v / 60} 分钟` : `${v} 秒`))
                                  .join(' / ') || '—'}
                              </dd>
                            </div>
                            <div>
                              <dt>交付</dt>
                              <dd>{config?.sla_days ? `${config.sla_days} 自然日` : '以报价为准'}</dd>
                            </div>
                            <div>
                              <dt>成品数量</dt>
                              <dd>1 条</dd>
                            </div>
                            <div>
                              <dt>预计消耗</dt>
                              <dd>提交前获取报价</dd>
                            </div>
                          </dl>
                        </aside>
                      </div>
                      {config && !config.enabled && (
                        <p className={styles.notice}>新建服务暂未开放，已有订单仍可查看。</p>
                      )}
                      <div className={styles.introActions}>
                        {config?.enabled && (
                          <button className={styles.primary} type="button" disabled={busy} onClick={start}>
                            提交需求，进入制作排期
                          </button>
                        )}
                        <button className={styles.secondary} type="button" onClick={() => setOrders(true)}>
                          查看我的订单
                        </button>
                      </div>
                    </section>
                  </>
                )}
                {config?.enabled && started && !pending && !restoreLoading && !restoreError && (
                  <>
                    <div className={`smart__progress ${styles.steps}`}>
                      <StepProgress
                        steps={[
                          { key: 'material', label: '需求与素材' },
                          { key: 'confirm', label: '确认并提交' },
                          { key: 'produce', label: '制作中' },
                          { key: 'delivery', label: '交付验收' },
                        ]}
                        current={stage === 'order' ? 1 : 0}
                      />
                    </div>
                    {stage === 'form' && (
                      <section className={styles.panel}>
                        <h1 className={styles.projectTitle}>定制宣传片 · 需求填写</h1>
                        <fieldset disabled={busy} className={styles.fields}>
                          <label>
                            <span>
                              单位 / 公司名称{' '}
                              <span className={styles.required} aria-hidden="true">
                                *
                              </span>
                            </span>
                            <input
                              id="promo-company"
                              aria-label="单位 / 公司名称"
                              required
                              aria-invalid={formValidated && !form.company.trim()}
                              aria-describedby={
                                formValidated && !form.company.trim() ? 'promo-company-error' : undefined
                              }
                              value={form.company}
                              onChange={(e) => setField('company', e.target.value)}
                            />
                            {formValidated && !form.company.trim() && (
                              <span id="promo-company-error" className={styles.fieldError}>
                                请填写单位 / 公司名称
                              </span>
                            )}
                          </label>
                          <label>
                            <span>
                              联系人{' '}
                              <span className={styles.required} aria-hidden="true">
                                *
                              </span>
                            </span>
                            <input
                              id="promo-contact"
                              aria-label="联系人"
                              required
                              aria-invalid={formValidated && !form.contact.trim()}
                              aria-describedby={
                                formValidated && !form.contact.trim() ? 'promo-contact-error' : undefined
                              }
                              value={form.contact}
                              onChange={(e) => setField('contact', e.target.value)}
                            />
                            {formValidated && !form.contact.trim() && (
                              <span id="promo-contact-error" className={styles.fieldError}>
                                请填写联系人
                              </span>
                            )}
                          </label>
                          <label>
                            <span>
                              联系电话{' '}
                              <span className={styles.required} aria-hidden="true">
                                *
                              </span>
                            </span>
                            <input
                              id="promo-phone"
                              aria-label="联系电话"
                              required
                              aria-invalid={formValidated && !form.phone.trim()}
                              aria-describedby={formValidated && !form.phone.trim() ? 'promo-phone-error' : undefined}
                              value={form.phone}
                              onChange={(e) => setField('phone', e.target.value)}
                            />
                            {formValidated && !form.phone.trim() && (
                              <span id="promo-phone-error" className={styles.fieldError}>
                                请填写联系电话
                              </span>
                            )}
                          </label>
                          <label>
                            宣传片场景
                            <select
                              value={form.scenario}
                              onChange={(e) => setField('scenario', e.target.value as Form['scenario'])}
                            >
                              <option value="government_corporate">政企宣传</option>
                              <option value="product_launch">产品发布</option>
                              <option value="investment_financing">招商融资</option>
                            </select>
                          </label>
                          <label>
                            期望时长
                            <select
                              value={form.duration_seconds}
                              onChange={(e) => setField('duration_seconds', Number(e.target.value))}
                            >
                              {config.duration_options_seconds.map((v) => (
                                <option key={v} value={v}>
                                  {v >= 60 ? `${v / 60} 分钟` : `${v} 秒`}
                                </option>
                              ))}
                            </select>
                            <small>时长影响制作规格与积分消耗</small>
                          </label>
                          <label>
                            画面比例
                            <select value={form.ratio} onChange={(e) => setField('ratio', e.target.value)}>
                              {config.ratio_options.map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                            <small>交付按此比例出片</small>
                          </label>
                          <label>
                            分辨率
                            <select value={form.resolution} onChange={(e) => setField('resolution', e.target.value)}>
                              {config.resolution_options.map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            旁白与字幕
                            <select
                              value={form.narration}
                              onChange={(e) => setField('narration', e.target.value as Form['narration'])}
                            >
                              <option value="both">旁白及字幕</option>
                              <option value="subtitles">仅字幕</option>
                              <option value="narration">仅旁白</option>
                              <option value="none">均不需要</option>
                            </select>
                          </label>
                          <label className={styles.wide}>
                            <span>
                              制作需求{' '}
                              <span className={styles.required} aria-hidden="true">
                                *
                              </span>
                            </span>
                            <textarea
                              id="promo-brief"
                              aria-label="制作需求"
                              required
                              aria-invalid={formValidated && !form.brief.trim()}
                              aria-describedby={formValidated && !form.brief.trim() ? 'promo-brief-error' : undefined}
                              value={form.brief}
                              onChange={(e) => setField('brief', e.target.value)}
                            />
                            {formValidated && !form.brief.trim() && (
                              <span id="promo-brief-error" className={styles.fieldError}>
                                请填写制作需求
                              </span>
                            )}
                          </label>
                          <label className={styles.wide}>
                            参考链接（选填）
                            <input
                              value={form.reference_url}
                              onChange={(e) => setField('reference_url', e.target.value)}
                            />
                          </label>
                        </fieldset>
                        <div className={styles.plain}>
                          <b>接下来：</b>填写需求后上传素材，交付日期以报价和订单详情为准。
                        </div>
                        <div className={styles.actions}>
                          <span>第 1 步 / 共 2 步：需求</span>
                          <button
                            className={styles.primary}
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setFormValidated(true)
                              const missing = (['company', 'contact', 'phone', 'brief'] as const).find(
                                (key) => !form[key].trim(),
                              )
                              if (missing) {
                                setError('请填写必填项')
                                document.getElementById(`promo-${missing}`)?.focus()
                                return
                              }
                              setError('')
                              setStage('materials')
                            }}
                          >
                            下一步：上传素材 →
                          </button>
                        </div>
                      </section>
                    )}
                    {stage === 'materials' && (
                      <section className={styles.panel}>
                        <h1 className={styles.projectTitle}>上传素材</h1>
                        {uploadingName && <p role="status">正在处理素材：{uploadingName}，请稍候…</p>}
                        <div className={styles.uploads}>
                          {(['logo', 'footage', 'supplement'] as const).map((role) => (
                            <section
                              key={role}
                              className={`${styles.materialCard} ${role === 'footage' ? styles.requiredMaterial : ''}`}
                            >
                              <h2>
                                {role === 'footage' ? '实拍素材' : role === 'logo' ? 'LOGO' : 'VI / 口播稿 / 音乐'}{' '}
                                <span className={styles.pill}>{role === 'footage' ? '必传' : '选传'}</span>
                              </h2>
                              <p>
                                {role === 'footage'
                                  ? `至少 ${config.footage_min_count} 条图片或视频`
                                  : role === 'logo'
                                    ? '图片文件，透明底优先'
                                    : '补充文件可选传'}
                              </p>
                              <label className={styles.uploadBox}>
                                {role === 'footage' ? '上传实拍素材' : role === 'logo' ? '上传 LOGO' : '上传补充文件'}
                                <input
                                  type="file"
                                  disabled={busy}
                                  accept={config.allowed_mime.join(',')}
                                  onChange={selectFile(role)}
                                />
                              </label>
                              {materials
                                .filter((item) => item.role === role)
                                .map((item) => (
                                  <div className={styles.material} key={item.id}>
                                    <span>
                                      {item.name || `素材 #${item.id}`} ·{' '}
                                      {item.status === 'active'
                                        ? '已就绪'
                                        : uploadStage[item.id] === 'uploading'
                                          ? '上传中'
                                          : uploadStage[item.id] === 'uploaded'
                                            ? '已上传，待确认'
                                            : uploadStage[item.id] === 'failed'
                                              ? '上传失败'
                                              : '未完成'}
                                    </span>
                                    {item.low_resolution && <span>清晰度较低</span>}
                                    {item.status !== 'active' && (
                                      <>
                                        <button type="button" disabled={busy} onClick={() => complete(item.id)}>
                                          重试确认
                                        </button>
                                        {uploadStage[item.id] !== 'uploaded' && (
                                          <label>
                                            选择原文件重试
                                            <input
                                              type="file"
                                              disabled={busy}
                                              onChange={selectFile(item.role || 'footage', item)}
                                            />
                                          </label>
                                        )}
                                      </>
                                    )}
                                    <button type="button" disabled={busy} onClick={() => remove(item.id)}>
                                      删除
                                    </button>
                                  </div>
                                ))}
                            </section>
                          ))}
                        </div>
                        <div className={styles.plain}>
                          <b>传不上来怎么办？</b>{' '}
                          {config.offline_fallback
                            ? '可以登记线下交接，由顾问联系你。'
                            : '请检查素材后重试，或联系客服。'}
                        </div>
                        {config.offline_fallback && !offline && (
                          <button
                            className={styles.secondary}
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void guarded(async () => {
                                await registerPromoOffline(token)
                                localStorage.setItem(`zzh.promo.offline.${scope}`, '1')
                                setOffline(true)
                                setQuote(null)
                              })
                            }
                          >
                            素材我线下交给顾问
                          </button>
                        )}
                        {offline && <p>已登记线下交接，具体交付日期以报价为准。</p>}
                        <fieldset className={styles.consent} disabled={busy}>
                          <label>
                            <input
                              type="checkbox"
                              checked={authorized}
                              onChange={(e) => setAuthorized(e.target.checked)}
                            />
                            {config.authorization_text}
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={acknowledged}
                              onChange={(e) => setAcknowledged(e.target.checked)}
                            />
                            {config.acknowledgement_text}
                          </label>
                        </fieldset>
                        {(!config.price_show || config.manual_quote_required) && (
                          <p className={styles.notice}>
                            当前规格需要顾问核价，请联系 {config.service_tel}。{' '}
                            <button
                              type="button"
                              disabled={busy || configLoading}
                              onClick={() => setConfigAttempt((v) => v + 1)}
                            >
                              刷新核价状态
                            </button>
                          </p>
                        )}
                        <div className={styles.actions}>
                          <span>第 2 步 / 共 2 步：素材</span>
                          <button
                            className={styles.secondary}
                            type="button"
                            disabled={busy}
                            onClick={() => setStage('form')}
                          >
                            上一步
                          </button>
                          <button
                            className={styles.primary}
                            type="button"
                            disabled={
                              busy || !authorized || !acknowledged || !config.price_show || config.manual_quote_required
                            }
                            onClick={getQuote}
                          >
                            下一步：确认并提交
                          </button>
                        </div>
                      </section>
                    )}
                    {stage === 'order' && quote && (
                      <section className={styles.panel}>
                        <h1 className={styles.projectTitle}>需求与素材已收齐</h1>
                        <div className={styles.block}>
                          <b>核心信息：</b>
                          <p>{form.brief}</p>
                        </div>
                        <div className={styles.block}>
                          <b>素材清单：</b>
                          <div className={styles.tableWrap}>
                            <table className={styles.table}>
                              <thead>
                                <tr>
                                  <th>素材</th>
                                  <th>文件</th>
                                  <th>状态</th>
                                </tr>
                              </thead>
                              <tbody>
                                {materials.length ? (
                                  materials.map((item) => (
                                    <tr key={item.id}>
                                      <td>
                                        {item.role === 'footage'
                                          ? '实拍素材'
                                          : item.role === 'logo'
                                            ? 'LOGO'
                                            : '补充文件'}
                                      </td>
                                      <td>{item.name || `素材 #${item.id}`}</td>
                                      <td>{item.status === 'active' ? '已就绪' : '未完成'}</td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td colSpan={3}>{offline ? '线下交接' : '暂无素材'}</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className={styles.order}>
                          <div className={styles.orderHeading}>
                            <h2>宣传片制作订单</h2>
                            <span className={styles.pill}>T+5 定制</span>
                            <span>提交后进入制作排期</span>
                          </div>
                          <dl className={styles.orderGrid}>
                            <div>
                              <dt>时长</dt>
                              <dd>
                                {form.duration_seconds >= 60
                                  ? `${form.duration_seconds / 60} 分钟`
                                  : `${form.duration_seconds} 秒`}
                              </dd>
                            </div>
                            <div>
                              <dt>承诺交付</dt>
                              <dd>{quote.promised_date || '待确定'}</dd>
                            </div>
                            <div>
                              <dt>成品数量</dt>
                              <dd>1 条</dd>
                            </div>
                            <div>
                              <dt>预计消耗</dt>
                              <dd>{quote.total_cost} 积分</dd>
                            </div>
                          </dl>
                          <div className={styles.plain}>
                            <b>出片规格：</b>
                            {form.ratio} · {form.resolution} ·{' '}
                            {form.narration === 'both'
                              ? '旁白及字幕'
                              : form.narration === 'subtitles'
                                ? '仅字幕'
                                : form.narration === 'narration'
                                  ? '仅旁白'
                                  : '均不需要'}
                          </div>
                          <div className={styles.plain}>
                            <b>提交前请确认：</b>
                            <ul>
                              <li>提交时冻结积分，首次交付时结算。</li>
                              <li>普通取消请联系顾问，退款资格以订单状态为准。</li>
                              <li>交付后的修改权限以订单详情为准。</li>
                            </ul>
                          </div>
                        </div>
                        <div className={styles.actions}>
                          <span>还可返回修改需求与素材</span>
                          <span className={styles.cost}>
                            预计费用 <b>{quote.total_cost}</b> 积分
                          </span>
                          <button
                            className={styles.secondary}
                            type="button"
                            disabled={busy}
                            onClick={() => setStage('materials')}
                          >
                            上一步
                          </button>
                          <button
                            className={styles.primary}
                            type="button"
                            disabled={
                              busy ||
                              !authorized ||
                              !acknowledged ||
                              quote.price_show === false ||
                              quote.manual_quote_required === true
                            }
                            onClick={() => setConfirm(true)}
                          >
                            提交宣传片任务（T+5）
                          </button>
                        </div>
                      </section>
                    )}
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
      <Modal
        open={confirm}
        title="确认提交宣传片订单？"
        okText="确认提交"
        cancelText="取消"
        confirmLoading={busy}
        closable={!busy}
        maskClosable={!busy}
        onCancel={() => !busy && setConfirm(false)}
        onOk={() => {
          if (quote && config && !pending)
            submit({
              ...form,
              intake_token: token,
              config_hash: quote.config_hash,
              idempotency_key: crypto.randomUUID(),
              authorized,
              acknowledged,
              authorization_version: config.authorization_version,
            })
        }}
      >
        {quote && (
          <p>
            基础制作：{quote.base_cost} 积分 · 制作服务费：{quote.service_cost} 积分
          </p>
        )}
        <p>提交后将冻结 {quote?.total_cost} 积分，首次交付时结算。</p>
        {error && <p role="alert">{error}</p>}
      </Modal>
    </div>
  )
}
