import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import TaskCenterDrawer from '@/components/task/TaskCenterDrawer'
import PromoOrders from '@/components/task/PromoOrders'
import PromoRealView from './PromoRealView'
import StepProgress from '@/components/smart/StepProgress'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import { useCurrentUser, useWorkspaceId } from '@/stores/workspaceSession'
import { useTaskCenterStore } from '@/stores/taskCenter'
import { addCalendarDays, promoCredits, usePromoDemoStore, type PromoStatus, type PromoTask } from '@/stores/promoDemo'
import styles from './PromoCreateView.module.css'

type Stage = 'intro' | 'form' | 'materials' | 'order' | 'waiting' | 'delivery'
type Form = Pick<
  PromoTask,
  'org' | 'contact' | 'phone' | 'scene' | 'duration' | 'ratio' | 'resolution' | 'voice' | 'core' | 'reference'
>
const initialForm: Form = {
  org: '',
  contact: '',
  phone: '',
  scene: '企业形象片',
  duration: 180,
  ratio: '16:9 横版',
  resolution: '1080P',
  voice: '要旁白＋字幕',
  core: '',
  reference: '',
}
const dateText = (time: number) =>
  new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
const hotline = '13681065734'
const money = (seconds: number) => promoCredits(seconds).toLocaleString('zh-CN')
const steps = [
  { key: 'form', label: '填写需求' },
  { key: 'materials', label: '上传素材' },
  { key: 'order', label: '确认提交' },
  { key: 'delivery', label: '制作与交付' },
]

/** 仅读取尺寸信息，不把本地文件转成大字符串或发送到服务端。 */
function inspectResolution(file: File): Promise<boolean | null> {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return Promise.resolve(null)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = file.type.startsWith('video/')
    const element = video ? document.createElement('video') : document.createElement('img')
    let done = false
    const finish = (result: boolean | null) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      element.removeAttribute('src')
      if (element instanceof HTMLVideoElement) element.load()
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timer = window.setTimeout(() => finish(null), 5000)
    element.onerror = () => finish(null)
    if (element instanceof HTMLVideoElement) {
      element.preload = 'metadata'
      element.onloadedmetadata = () => finish(Math.min(element.videoWidth, element.videoHeight) < 1080)
    } else element.onload = () => finish(Math.min(element.naturalWidth, element.naturalHeight) < 1080)
    element.src = url
  })
}

function Progress({ stage, pendingHandoff }: { stage: Stage; pendingHandoff: boolean }) {
  const index = stage === 'form' ? 0 : stage === 'materials' ? 1 : stage === 'order' ? 2 : 3
  return (
    <div className={styles.progress}>
      <StepProgress
        steps={steps}
        current={index}
        statuses={
          pendingHandoff
            ? ['已完成', '待交接', '已提交', '等待素材']
            : steps.map((_, i) => (i < index ? '已完成' : i === index ? '进行中' : '待开始'))
        }
      />
    </div>
  )
}

function PromoDemoView() {
  const onNavigate = useSidebarNavigate()
  const [params, setParams] = useSearchParams()
  const currentUser = useCurrentUser() as { id?: number; user_id?: number } | null
  const ownerId = Number(currentUser?.id || currentUser?.user_id || 0)
  const workspaceId = Number(useWorkspaceId() || 0)
  const tasks = usePromoDemoStore((state) => state.tasks)
  const add = usePromoDemoStore((state) => state.add)
  const update = usePromoDemoStore((state) => state.update)
  const openList = usePromoDemoStore((state) => state.openList)
  const setDrawerExpanded = useTaskCenterStore((state) => state.setDrawerExpanded)
  const taskId = params.get('task') || ''
  const task = tasks.find((item) => item.id === taskId && item.ownerId === ownerId && item.workspaceId === workspaceId)
  const [stage, setStage] = useState<Stage>('intro')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [form, setForm] = useState<Form>(initialForm)
  const [files, setFiles] = useState<File[]>([])
  const [offlineDelivery, setOfflineDelivery] = useState(false)
  const [quality, setQuality] = useState<Map<File, boolean | null>>(new Map())
  const [logo, setLogo] = useState<File | null>(null)
  const [other, setOther] = useState<File[]>([])
  const [authorized, setAuthorized] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [demoControls, setDemoControls] = useState(false)
  const [showRealOrders, setShowRealOrders] = useState(false)
  useEffect(() => {
    if (task?.id) setStage(task.status === '已交付' ? 'delivery' : 'waiting')
    else if (taskId) setStage('intro')
  }, [taskId, task?.id, task?.status])
  const goto = (next: Stage) => {
    setStage(next)
    setMessage('')
    window.scrollTo(0, 0)
  }
  const patchForm = <K extends keyof Form>(key: K, value: Form[K]) => setForm((old) => ({ ...old, [key]: value }))
  const showTasks = () => {
    openList()
    setDrawerExpanded(true)
  }
  const submitForm = (event: FormEvent) => {
    event.preventDefault()
    if (!form.org.trim() || !form.contact.trim() || !form.phone.trim() || !form.core.trim()) {
      setMessage('请填写所有必填项。')
      return
    }
    goto('materials')
  }
  const selectFiles = (event: ChangeEvent<HTMLInputElement>, setter: (files: File[]) => void) => {
    const selected = Array.from(event.target.files || [])
    if (selected.length) setter(selected)
    event.target.value = ''
  }
  const addFootage = (selected: File[]) => {
    setFiles((old) => [...old, ...selected])
    selected.forEach((file) => {
      void inspectResolution(file).then((low) => setQuality((old) => new Map(old).set(file, low)))
    })
  }
  const submitOrder = () => {
    if (!ownerId || !workspaceId) {
      setMessage('请登录并选择工作空间后再体验演示。')
      setConfirm(false)
      return
    }
    const now = Date.now()
    const newTask: PromoTask = {
      ...form,
      id: `promo-${crypto.randomUUID()}`,
      ownerId,
      workspaceId,
      files: files.map((file) => file.name),
      materialDelivery: offlineDelivery ? 'offline' : 'online',
      logo: logo?.name || '',
      other: other.map((file) => file.name),
      createdAt: now,
      dueAt: offlineDelivery ? 0 : addCalendarDays(now, 5),
      status: offlineDelivery ? '待交接' : '制作中',
      revisionUsed: false,
    }
    add(newTask)
    setConfirm(false)
    setParams({ task: newTask.id })
    setStage('waiting')
    showTasks()
  }
  const newOrder = () => {
    setParams({})
    setForm(initialForm)
    setFiles([])
    setOfflineDelivery(false)
    setQuality(new Map())
    setLogo(null)
    setOther([])
    setAuthorized(false)
    setAcknowledged(false)
    goto('form')
  }
  const setDemoStatus = (status: PromoStatus) => {
    if (!task) return
    update(task.id, ownerId, workspaceId, {
      status,
      ...(status === '已交付' ? { deliveredAt: Date.now() } : {}),
      ...(status === '返工中' ? { revisionUsed: true, dueAt: addCalendarDays(Date.now(), 2) } : {}),
    })
    setDemoControls(false)
  }
  return (
    <div className={styles.shell} data-promo-demo>
      <AppSidebar activeKey="promo" onNavigate={onNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className={styles.main}>
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <div className={styles.workspace}>
          <TaskCenterDrawer scope="smart" />
          <main className={styles.content}>
            {showRealOrders ? (
              <PromoOrders key={workspaceId} workspaceId={workspaceId} onClose={() => setShowRealOrders(false)} />
            ) : (
              <>
                <div className={styles.demoNotice}>
                  演示模式：仅在当前浏览器保存页面状态与文件名，不上传素材、不创建订单，也不扣除积分。
                </div>
                {stage !== 'intro' && <Progress stage={stage} pendingHandoff={task?.status === '待交接'} />}
                {stage === 'intro' && (
                  <>
                    <header className={styles.hero}>
                      <div>
                        <span className={styles.eyebrow}>CUSTOM FILM · T+5</span>
                        <h1>定制宣传片</h1>
                        <p>把你的故事与素材，交给我们制作成一条完整的宣传片。</p>
                      </div>
                      <div className={styles.heroTime}>
                        <strong>5 天</strong>
                        <span>素材齐全后交付</span>
                      </div>
                    </header>
                    <section className={styles.overview}>
                      <div>
                        <h2>一条片子，讲清楚你的故事</h2>
                        <p>适合企业形象、产品发布、招商融资与政府汇报。每单交付 1 条 1–10 分钟的成片。</p>
                        <h3>开始前请准备</h3>
                        <ul>
                          <li>
                            <b>实拍图片或视频</b>：至少 3 条，建议 1080P。
                          </li>
                          <li>LOGO、VI、口播稿或音乐要求可选填。</li>
                          <li>拿到成片后 3 天内可提出 1 次修改。</li>
                        </ul>
                      </div>
                      <aside>
                        <h3>交付概览</h3>
                        <dl>
                          <div>
                            <dt>成片时长</dt>
                            <dd>1–10 分钟</dd>
                          </div>
                          <div>
                            <dt>成片数量</dt>
                            <dd>1 条</dd>
                          </div>
                          <div>
                            <dt>预计消耗</dt>
                            <dd>
                              <strong>{money(180)} 积分</strong>
                              <small>3 分钟示例</small>
                            </dd>
                          </div>
                        </dl>
                        <p>积分随所选时长变化，提交前再次确认。</p>
                        <button className={styles.primary} type="button" onClick={() => goto('form')}>
                          填写制作需求 <span>→</span>
                        </button>
                        <button className={styles.secondary} type="button" onClick={() => setShowRealOrders(true)}>
                          查看真实宣传片订单
                        </button>
                      </aside>
                    </section>
                  </>
                )}
                {stage === 'form' && (
                  <section className={styles.panel}>
                    <header className={styles.panelHead}>
                      <div>
                        <p className={styles.eyebrow}>STEP 01</p>
                        <h1>填写宣传片需求</h1>
                        <p>告诉我们你想传达什么，素材齐全后开始计算交付时间。</p>
                      </div>
                      <span>约需 3 分钟</span>
                    </header>
                    <form onSubmit={submitForm}>
                      <div className={styles.formGrid}>
                        <label>
                          单位 / 公司名称 <em>*</em>
                          <input
                            required
                            value={form.org}
                            onChange={(e) => patchForm('org', e.target.value)}
                            placeholder="请输入单位或公司名称"
                          />
                        </label>
                        <label>
                          联系人 <em>*</em>
                          <input
                            required
                            value={form.contact}
                            onChange={(e) => patchForm('contact', e.target.value)}
                            placeholder="如何称呼您"
                          />
                        </label>
                        <label>
                          联系方式 <em>*</em>
                          <input
                            required
                            value={form.phone}
                            onChange={(e) => patchForm('phone', e.target.value)}
                            placeholder="手机号或其他联系方式"
                          />
                        </label>
                        <label>
                          宣传片场景 <em>*</em>
                          <select value={form.scene} onChange={(e) => patchForm('scene', e.target.value)}>
                            {['企业形象片', '产品发布片', '招商 / 融资片', '政府汇报片'].map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          期望时长 <em>*</em>
                          <select value={form.duration} onChange={(e) => patchForm('duration', Number(e.target.value))}>
                            {[60, 180, 300, 600].map((x) => (
                              <option key={x} value={x}>
                                {x / 60} 分钟
                              </option>
                            ))}
                          </select>
                          <small>时长影响积分消耗</small>
                        </label>
                        <label>
                          画面比例 <em>*</em>
                          <select value={form.ratio} onChange={(e) => patchForm('ratio', e.target.value)}>
                            {['16:9 横版', '9:16 竖版', '1:1 方版', '4:3 横版'].map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          分辨率 <em>*</em>
                          <select value={form.resolution} onChange={(e) => patchForm('resolution', e.target.value)}>
                            {['720P', '1080P', '2K', '4K'].map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          旁白与字幕 <em>*</em>
                          <select value={form.voice} onChange={(e) => patchForm('voice', e.target.value)}>
                            {['要旁白＋字幕', '只要字幕', '只要旁白', '都不要'].map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.full}>
                          核心信息 <em>*</em>
                          <textarea
                            required
                            value={form.core}
                            onChange={(e) => patchForm('core', e.target.value)}
                            placeholder="介绍要突出的信息、重点场景和期望表达的内容"
                          />
                        </label>
                        <label className={styles.full}>
                          参考片链接（选填）
                          <input
                            value={form.reference}
                            onChange={(e) => patchForm('reference', e.target.value)}
                            placeholder="粘贴参考片链接"
                          />
                        </label>
                      </div>
                      <p className={styles.tip}>素材收齐后开始排期，承诺日期从素材齐全当天起算 5 个自然日。</p>
                      {message && (
                        <p role="alert" className={styles.error}>
                          {message}
                        </p>
                      )}
                      <div className={styles.actions}>
                        <button className={styles.secondary} type="button" onClick={() => goto('intro')}>
                          返回
                        </button>
                        <button className={styles.primary} type="submit">
                          下一步：上传素材 →
                        </button>
                      </div>
                    </form>
                  </section>
                )}
                {stage === 'materials' && (
                  <section className={styles.panel}>
                    <header className={styles.panelHead}>
                      <div>
                        <p className={styles.eyebrow}>STEP 02</p>
                        <h1>上传素材</h1>
                        <p>素材越完整，越能准确呈现你想讲的内容。</p>
                      </div>
                      <span>
                        {offlineDelivery
                          ? '已选择线下交接'
                          : files.length >= 3
                            ? '必传已齐'
                            : `实拍素材 ${files.length} / 3`}
                      </span>
                    </header>
                    <div className={styles.materialGrid}>
                      <div className={styles.material}>
                        <h3>
                          LOGO <small>选传</small>
                        </h3>
                        <p>PNG / SVG / AI，透明底优先</p>
                        <label className={styles.upload}>
                          选择 LOGO
                          <input
                            type="file"
                            accept="image/*,.ai,.svg"
                            onChange={(e) => selectFiles(e, (items) => setLogo(items[0] || null))}
                          />
                        </label>
                        {logo && <p>{logo.name}</p>}
                      </div>
                      <div className={styles.material}>
                        <h3>
                          实拍素材 <em>必传</em>
                        </h3>
                        <p>至少 3 条图片或视频，建议 1080P</p>
                        <label className={styles.upload}>
                          选择图片或视频
                          <input
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            onChange={(e) => selectFiles(e, addFootage)}
                          />
                        </label>
                        <ul className={styles.fileList}>
                          {files.map((file, i) => (
                            <li key={`${file.name}-${i}`}>
                              <span>
                                {file.name}
                                {quality.get(file) === true && <em> · 低于 1080P</em>}
                              </span>
                              <button
                                type="button"
                                aria-label={`移除 ${file.name}`}
                                onClick={() => setFiles((old) => old.filter((_, index) => index !== i))}
                              >
                                ×
                              </button>
                            </li>
                          ))}
                        </ul>
                        <small>低于 1080P 的素材可以提交，成片清晰度可能受影响。</small>
                      </div>
                      <div className={styles.material}>
                        <h3>
                          VI / 口播稿 / 音乐 <small>选传</small>
                        </h3>
                        <p>没有也可以，按需求补充。</p>
                        <label className={styles.upload}>
                          选择补充素材
                          <input type="file" multiple onChange={(e) => selectFiles(e, (items) => setOther(items))} />
                        </label>
                        {other.map((file) => (
                          <p key={file.name}>{file.name}</p>
                        ))}
                      </div>
                    </div>
                    <p className={styles.tip}>
                      大文件传不上来时可分段上传，也可联系顾问线下交接；素材齐全后开始计算交付日期。
                    </p>
                    <button
                      type="button"
                      className={styles.link}
                      aria-pressed={offlineDelivery}
                      onClick={() => setOfflineDelivery((value) => !value)}
                    >
                      {offlineDelivery ? '已选择线下交接 · 切换为线上选择' : '素材我线下交给顾问'}
                    </button>
                    {offlineDelivery && (
                      <div className={styles.offlineInfo} role="status">
                        <strong>线下交接素材</strong>
                        <p>
                          请联系顾问 <a href={`tel:${hotline}`}>{hotline}</a> 商定交接方式，提供至少 3
                          个实拍图片或视频。素材收齐后开始计算 5 天交付时间。
                        </p>
                        <p>当前为演示，选择此项不会自动联系顾问或传送素材。</p>
                      </div>
                    )}
                    {message && <p role="status">{message}</p>}
                    <div className={styles.checks}>
                      <label>
                        <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
                        我确认已获得素材中人物肖像与第三方内容的授权，我方对素材合法性负责。
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(e) => setAcknowledged(e.target.checked)}
                        />
                        我已知悉本片非即时生成，不承诺投放过审，含 AI 画面时按平台规则带 AIGC 标识。
                      </label>
                    </div>
                    <div
                      id="promo-material-requirements"
                      className={styles.requirements}
                      role="status"
                      aria-live="polite"
                    >
                      {((!offlineDelivery && files.length < 3) || !authorized || !acknowledged) && (
                        <>
                          <strong>完成以下事项后可进入下一步：</strong>
                          <ul>
                            {!offlineDelivery && files.length < 3 && (
                              <li>还需上传 {3 - files.length} 个实拍图片或视频</li>
                            )}
                            {!authorized && <li>请确认已获得素材授权</li>}
                            {!acknowledged && <li>请勾选制作与 AIGC 标识须知</li>}
                          </ul>
                        </>
                      )}
                    </div>
                    <div className={styles.actions}>
                      <span>
                        预计消耗 <b>{money(form.duration)} 积分</b>
                      </span>
                      <button className={styles.secondary} type="button" onClick={() => goto('form')}>
                        上一步
                      </button>
                      <button
                        className={styles.primary}
                        type="button"
                        disabled={(!offlineDelivery && files.length < 3) || !authorized || !acknowledged}
                        aria-describedby="promo-material-requirements"
                        onClick={() => goto('order')}
                      >
                        下一步：确认并提交
                      </button>
                    </div>
                  </section>
                )}
                {stage === 'order' && (
                  <section className={styles.panel}>
                    <header className={styles.panelHead}>
                      <div>
                        <p className={styles.eyebrow}>STEP 03</p>
                        <h1>确认需求与订单</h1>
                        <p>
                          {offlineDelivery
                            ? '请检查以下信息，素材交接完成后开始制作排期。'
                            : '请检查以下信息，提交后将进入制作排期。'}
                        </p>
                      </div>
                    </header>
                    <h3>核心信息</h3>
                    <p>{form.core}</p>
                    <h3>素材清单</h3>
                    <p>
                      {offlineDelivery ? '线下交给顾问（待交接）' : files.map((file) => file.name).join('、')}{' '}
                      {logo ? ` · LOGO：${logo.name}` : ' · LOGO 未提供'}
                    </p>
                    <div className={styles.order}>
                      <div className={styles.orderTitle}>
                        <h2>宣传片制作订单</h2>
                        <span>T+5 交付</span>
                      </div>
                      <dl>
                        <div>
                          <dt>时长</dt>
                          <dd>{form.duration / 60} 分钟</dd>
                        </div>
                        <div>
                          <dt>承诺交付</dt>
                          <dd>{offlineDelivery ? '素材收齐后确定' : dateText(addCalendarDays(Date.now(), 5))}</dd>
                        </div>
                        <div>
                          <dt>成品数量</dt>
                          <dd>1 条</dd>
                        </div>
                        <div>
                          <dt>预计消耗</dt>
                          <dd>{money(form.duration)} 积分</dd>
                        </div>
                      </dl>
                      <p className={styles.tip}>
                        出片规格：{form.duration / 60} 分钟 · {form.ratio} · {form.resolution} · {form.voice} · 交付 1
                        条
                      </p>
                      <ul>
                        <li>宣传片需要几天制作，非即时出片。</li>
                        <li>积分先冻结，交付后扣除；未交付全额退回。</li>
                        <li>提交后不能自助取消，需要取消请联系客服 {hotline}。</li>
                        <li>交付后 3 天内可提 1 次修改，修改后再等 2 天。</li>
                      </ul>
                    </div>
                    <div className={styles.actions}>
                      <span>
                        预计费用 <b>{money(form.duration)} 积分</b>
                      </span>
                      <button className={styles.secondary} type="button" onClick={() => goto('materials')}>
                        上一步
                      </button>
                      <button className={styles.primary} type="button" onClick={() => setConfirm(true)}>
                        提交宣传片任务（T+5）
                      </button>
                    </div>
                  </section>
                )}
                {stage === 'waiting' && task && (
                  <section className={`${styles.panel} ${styles.waiting}`}>
                    <p className={styles.eyebrow}>宣传片任务 · {task.id.slice(0, 12)}</p>
                    <h1>
                      {task.status === '待交接'
                        ? '已提交演示任务，请联系顾问交接素材'
                        : task.status === '逾期'
                          ? '制作中，顾问会主动联系你'
                          : task.status === '返工中'
                            ? '修改已受理，请等待再次交付'
                            : task.status === '已退款'
                              ? '演示积分已退回'
                              : '已提交宣传片任务，请 5 天后回来验收成片'}
                    </h1>
                    <p>
                      {task.status === '待交接'
                        ? `线下交接待完成 · ${money(task.duration)} 积分（模拟）；素材收齐后开始计算 5 天交付时间。`
                        : task.status === '返工中'
                          ? '修改权益已使用 1/1，预计 2 天内再次交付。'
                          : `承诺交付 ${dateText(task.dueAt)} · ${money(task.duration)} 积分（模拟）`}
                    </p>
                    <ol className={styles.phases}>
                      <li>{task.status === '待交接' ? '等待素材交接' : '需求与素材已收齐'}</li>
                      <li>{task.status === '返工中' ? '修改制作中' : '制作中'}</li>
                      <li>成片交付</li>
                      <li>验收成片</li>
                    </ol>
                    {task.status === '待交接' && (
                      <p className={styles.tip}>
                        请联系顾问 <a href={`tel:${hotline}`}>{hotline}</a>{' '}
                        商定素材交接方式。当前仅为演示，不会自动发送通知或交接素材。
                      </p>
                    )}
                    {task.status === '逾期' && (
                      <>
                        <p className={styles.error}>已超过承诺日期，顾问会主动联系你，积分将全额退回。</p>
                        <button className={styles.secondary} type="button" onClick={() => setDemoStatus('已退款')}>
                          我不要了，退回积分（演示）
                        </button>
                      </>
                    )}
                    <p className={styles.tip}>
                      需要改需求或加急？客服电话 <a href={`tel:${hotline}`}>{hotline}</a>
                    </p>
                    <button className={styles.secondary} type="button" onClick={showTasks}>
                      查看宣传片任务
                    </button>
                  </section>
                )}
                {stage === 'delivery' && task && (
                  <section className={styles.delivery}>
                    <div className={styles.panel}>
                      <p className={styles.eyebrow}>成片已交付 · T+5</p>
                      <h1>{task.scene}</h1>
                      <video
                        className={styles.video}
                        controls
                        preload="metadata"
                        src="/tutorials/smart-create.mp4"
                        aria-label="宣传片示例视频"
                      />
                      <p className={styles.caption}>示例视频仅用于演示播放器，并非实际交付的成片。</p>
                      <div className={styles.actions}>
                        <a className={styles.primary} href="/tutorials/smart-create.mp4" download="宣传片示例视频.mp4">
                          下载示例视频
                        </a>
                        <span>
                          {task.duration / 60} 分钟 · {task.resolution} · 1 条
                        </span>
                      </div>
                      <dl className={styles.deliveryFacts}>
                        <div>
                          <dt>承诺交付</dt>
                          <dd>{dateText(task.dueAt)}</dd>
                        </div>
                        <div>
                          <dt>实际交付</dt>
                          <dd>{dateText(task.deliveredAt || Date.now())}</dd>
                        </div>
                        <div>
                          <dt>修改权益</dt>
                          <dd>{task.revisionUsed ? '已使用 1/1' : '1 次 · 3 天内'}</dd>
                        </div>
                      </dl>
                    </div>
                    <aside className={styles.deliverySide}>
                      <div className={styles.panel}>
                        <h2>不满意？提 1 次修改</h2>
                        <p>交付后 3 天内可提 1 次，不额外收费，修改后再等 2 天。</p>
                        {task.revisionUsed ? (
                          <p>修改权益已用完，需要其他版本请重新下单或联系客服。</p>
                        ) : (
                          <>
                            <label>
                              修改意见
                              <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="请说明哪里需要调整"
                              />
                            </label>
                            <button
                              className={styles.primary}
                              disabled={!note.trim() || Date.now() > addCalendarDays(task.deliveredAt || Date.now(), 3)}
                              type="button"
                              onClick={() => {
                                update(task.id, ownerId, workspaceId, {
                                  status: '返工中',
                                  revisionUsed: true,
                                  revisionNote: note.trim(),
                                  dueAt: addCalendarDays(Date.now(), 2),
                                })
                                setNote('')
                              }}
                            >
                              提交修改
                            </button>
                          </>
                        )}
                      </div>
                      <div className={styles.panel}>
                        <h2>还要别的版本？</h2>
                        <p>竖版、短剪等其他版本可再下一单。</p>
                        <button className={styles.secondary} type="button" onClick={newOrder}>
                          再下一单
                        </button>
                      </div>
                      <div className={styles.panel}>
                        <h2>联系客服</h2>
                        <a href={`tel:${hotline}`}>{hotline}</a>
                      </div>
                    </aside>
                  </section>
                )}
                {taskId && !task && <p role="alert">未找到当前账号和工作空间下的演示任务。</p>}
                {task && (
                  <div className={styles.demoControl}>
                    <button type="button" onClick={() => setDemoControls(!demoControls)} aria-expanded={demoControls}>
                      演示控制
                    </button>
                    {demoControls && (
                      <div>
                        {task.status === '待交接' ? (
                          <button
                            type="button"
                            onClick={() =>
                              update(task.id, ownerId, workspaceId, {
                                status: '制作中',
                                dueAt: addCalendarDays(Date.now(), 5),
                              })
                            }
                          >
                            演示：素材已交接
                          </button>
                        ) : (
                          (['制作中', '返工中', '已交付', '逾期'] as PromoStatus[]).map((status) => (
                            <button type="button" key={status} onClick={() => setDemoStatus(status)}>
                              {status}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>
      {confirm && (
        <div className={styles.modalBackdrop} onClick={() => setConfirm(false)}>
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="promo-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="promo-confirm-title">确认提交宣传片任务？</h2>
            <p>素材齐全后 5 天内交付 1 条成片，提交后可在任务中查看。</p>
            <dl>
              <div>
                <dt>基础制作</dt>
                <dd>{(form.duration * 25).toLocaleString()} 积分</dd>
              </div>
              <div>
                <dt>制作服务费</dt>
                <dd>{(promoCredits(form.duration) - form.duration * 25).toLocaleString()} 积分</dd>
              </div>
              <div>
                <dt>预计冻结</dt>
                <dd>{money(form.duration)} 积分</dd>
              </div>
              <div>
                <dt>承诺交付</dt>
                <dd>{offlineDelivery ? '素材收齐后确定' : dateText(addCalendarDays(Date.now(), 5))}</dd>
              </div>
            </dl>
            <p>有问题请联系客服 {hotline}。当前仅为演示，不会冻结积分。</p>
            <div className={styles.actions}>
              <button className={styles.secondary} type="button" onClick={() => setConfirm(false)}>
                再想想
              </button>
              <button className={styles.primary} type="button" onClick={submitOrder}>
                确认提交
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

/** 旧演示记录仍可查看；新建入口使用服务端宣传片流程。 */
export default function PromoCreateView() {
  const [params] = useSearchParams()
  const workspaceId = useWorkspaceId()
  const user = useCurrentUser() as { id?: number; user_id?: number } | null
  const key = `${user?.id || user?.user_id || 0}-${workspaceId || 0}`
  return params.has('task') ? <PromoDemoView /> : <PromoRealView key={key} />
}
