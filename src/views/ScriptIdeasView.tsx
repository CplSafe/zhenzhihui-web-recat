import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import AppSidebar from '@/components/home/AppSidebar'
import AppTopbar from '@/components/layout/AppTopbar'
import { useAuth } from '@/auth/AuthContext'
import { useRequireAuth } from '@/composables/useRequireAuth'
import { useSidebarNavigate } from '@/composables/useSidebarNavigate'
import {
  getApplication,
  listApplications,
  postApplication,
  postStage,
  getCreator,
  withdrawApplication,
  type CreatorResponse,
  uploadScriptFile,
  deleteScriptFile,
  type ScriptAttachment,
  type ScriptFormData,
  StudentApplicationError,
  type Application,
  type Detail,
  type FirstBody,
  type StageBody,
  type WorkflowVersion,
} from '@/api/studentApplications'
import { JoinPreview, StagePreview } from './ScriptPrototypeSections'
import { ScriptFlowDemo } from './ScriptFlowDemo'
import { ScriptGenreSelect } from './ScriptGenreSelect'
import { parseSubmittedIdea } from '@/utils/parseSubmittedIdea'
import {
  cardFields,
  formatCardContent,
  parseCardContent,
  scriptFields,
  formatScriptContent,
  parseScriptContent,
  readableStageContent,
  parseRevisionContent,
  formatRevisionContent,
} from '@/utils/scriptCardContent'
import './HomeView.css'
import './ScriptIdeasView.css'

type Snapshot = { key: string; body: FirstBody | StageBody }
const stageLabel: Record<string, string> = {
  creative: '创意',
  draft: '一卡',
  card: '一卡',
  script: '剧本',
  revision: '完善剧本',
  final: '完善剧本',
}
const isCard = (stage?: string) => stage === 'draft' || stage === 'card'
const isRevision = (stage?: string) => stage === 'revision' || stage === 'final'
function editableAttachments(
  detail: Detail,
  task: NonNullable<NonNullable<Detail['workflow']>['current_task']>,
): ScriptAttachment[] {
  const current = task.data?.attachments
  if (Array.isArray(current) && current.length) return current
  if (!['withdrawn', 'needs_changes'].includes(detail.workflow?.review_status || '')) return []
  const latest = [...(detail.workflow?.versions || [])]
    .filter((version) => version.stage === task.stage)
    .sort((a, b) => b.version - a.version)[0]
  const historical =
    latest?.data?.attachments ??
    (task.stage === 'creative' && !latest ? detail.application.data?.attachments : undefined)
  return Array.isArray(historical) ? historical : []
}
type ScriptFieldName = (typeof scriptFields)[number]
function validateScriptFields(values: Record<string, string>): Partial<Record<ScriptFieldName, string>> {
  const errors: Partial<Record<ScriptFieldName, string>> = {}
  for (const field of ['中文剧名', '题材', '分幕大纲'] as const)
    if (!values[field]?.trim()) errors[field] = `请填写${field}`
  const count = Number(values['预计集数'])
  const min = Number(values['单集最短时长'])
  const max = Number(values['单集最长时长'])
  const first = Number(values['首个付费解锁集'])
  if (!values['预计集数']?.trim() || !Number.isSafeInteger(count) || count < 1 || count > 200)
    errors['预计集数'] = '请输入 1 至 200 的整数'
  if (!values['单集最短时长']?.trim() || !Number.isSafeInteger(min) || min < 10 || min > 600)
    errors['单集最短时长'] = '请输入 10 至 600 秒的整数'
  if (
    !values['单集最长时长']?.trim() ||
    !Number.isSafeInteger(max) ||
    max < 10 ||
    max > 600 ||
    (Number.isSafeInteger(min) && min >= 10 && max < min)
  )
    errors['单集最长时长'] = '请输入 10 至 600 秒，且不小于最短时长'
  if (
    !values['首个付费解锁集']?.trim() ||
    !Number.isSafeInteger(first) ||
    first < 1 ||
    (count >= 1 && count <= 200 && first > count)
  )
    errors['首个付费解锁集'] = '请输入不超过预计集数的正整数'
  const raw = values['重点付费 / 追更节点']?.trim() || ''
  if (raw) {
    const points = raw.split(/[,，、\s]+/).map(Number)
    if (
      points.some((n) => !Number.isSafeInteger(n) || n < 1 || (count >= 1 && count <= 200 && n > count)) ||
      new Set(points).size !== points.length
    )
      errors['重点付费 / 追更节点'] = '请输入不重复且不超过预计集数的集数'
  }
  return errors
}
function structuredRows(stage: string, data?: ScriptFormData): string[][] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const fields: Record<string, Array<[string, string]>> = {
    creative: [
      ['申请人', 'applicant_name'],
      ['学校', 'applicant_school'],
      ['剧名', 'title'],
      ['题材', 'genre'],
      ['剧情简介', 'synopsis'],
      ['第一集剧本剧情', 'episode_1_plot'],
      ['人物、身份、性格', 'characters'],
    ],
    card: [
      ['中文剧名', 'title_zh'],
      ['英文剧名', 'title_en'],
      ['一卡覆盖集数', 'covered_episodes'],
      ['免费段最强付费卡点', 'strongest_paywall_episode'],
      ['中文完整版剧情简介', 'synopsis_zh_full'],
      ['核心卖点', 'selling_points'],
      ['人物小传', 'character_bios'],
      ['分集大纲与付费卡点', 'episode_outline_and_paywalls'],
    ],
    script: [
      ['中文剧名', 'title_zh'],
      ['题材', 'genre'],
      ['预计集数', 'planned_episodes'],
      ['单集最短时长', 'duration_min_seconds'],
      ['单集最长时长', 'duration_max_seconds'],
      ['首个付费解锁集', 'first_paid_episode'],
      ['付费 / 追更节点', 'paywall_episodes'],
      ['分幕大纲', 'act_outline'],
      ['世界观与核心规则', 'world_rules'],
    ],
    final: [
      ['本次修改说明', 'revision_description'],
      ['原创声明', 'originality_confirmed'],
    ],
  }
  const key = isCard(stage) ? 'card' : isRevision(stage) ? 'final' : stage
  if (!fields[key] || !fields[key].some(([, name]) => data[name] !== undefined)) return null
  return fields[key].map(([label, name]) => [
    label,
    name === 'originality_confirmed'
      ? data[name]
        ? '已确认'
        : '未确认'
      : Array.isArray(data[name])
        ? (data[name] as unknown[]).join('、') || '—'
        : String(data[name] ?? '') || '—',
  ])
}
const stateLabel: Record<string, string> = {
  submitted: '已进入流程',
  pending: '启动结果待确认',
  needs_review: '需要管理员处理',
}
const reviewLabel: Record<number, string> = { 2: '通过', 3: '不通过', 5: '退回' }
const formatTime = (value?: number | string) =>
  value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN') : '—'
function message(error: unknown) {
  if (error instanceof StudentApplicationError) {
    if (error.status === 401) return '登录已失效，请重新登录。'
    if (error.status === 403) return '当前账号无法提交，请联系管理员。'
    if (error.status === 404) return '申请不存在或无权查看。'
    if (error.status === 409) return '任务状态或提交内容已变化，请刷新进度核对；输入已保留。'
    if (error.status === 503) return '服务暂不可用，请使用原提交内容重试。'
    if (error.status === 400) return error.message || '参数有误，请检查后重新提交。'
  }
  return '请求结果不确定，请先查询进度，重试时将使用原提交内容。'
}
function readSnapshot(key: string): Snapshot | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}
function writeSnapshot(key: string, value: Snapshot | null) {
  if (value) localStorage.setItem(key, JSON.stringify(value))
  else localStorage.removeItem(key)
}

export default function ScriptIdeasView() {
  const navigate = useNavigate(),
    location = useLocation(),
    { id, stage: previewStage } = useParams()
  const { authSession } = useAuth(),
    requireAuth = useRequireAuth(),
    sidebarNavigate = useSidebarNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const owner = String(
    authSession?.user?.id ??
      authSession?.user?.user_id ??
      authSession?.user?.userId ??
      authSession?.user?.account_id ??
      authSession?.user?.uid ??
      '',
  )
  const isJoin = location.pathname.endsWith('/join')
  const isHome = location.pathname === '/script-ideas',
    isNew = location.pathname.endsWith('/new'),
    isList = location.pathname.endsWith('/list')
  const [form, setForm] = useState({ name: '', phone: '', school: '', creative: '' })
  const [creator, setCreator] = useState<CreatorResponse | null>(null)
  const [creatorError, setCreatorError] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null),
    [items, setItems] = useState<Application[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0)
  const joinedProfile = creator?.profile
  useEffect(() => {
    if (!owner || !(isHome || isNew || id)) return
    let cancelled = false
    setCreator(null)
    getCreator()
      .then((result) => {
        if (!cancelled) {
          setCreator(result)
          setCreatorError('')
        }
      })
      .catch(() => {
        if (!cancelled) setCreatorError('无法读取创作者资料，请稍后重试。')
      })
    return () => {
      cancelled = true
    }
  }, [owner, isHome, isNew, id])
  const formInitialized = useRef('')
  useEffect(() => {
    if (!isNew || formInitialized.current === location.key) return
    formInitialized.current = location.key
    setForm({ name: '', phone: '', school: '', creative: '' })
    setIdeaFields({ title: '', genre: '', ep1Plot: '', characters: '' })
    setIdeaValidationAttempted(false)
    setFiles([])
  }, [isNew, location.key])
  const [ideaFields, setIdeaFields] = useState({ title: '', genre: '', ep1Plot: '', characters: '' })
  const [ideaValidationAttempted, setIdeaValidationAttempted] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [excludedAttachmentIds, setExcludedAttachmentIds] = useState<number[]>([])
  const [deletingFile, setDeletingFile] = useState(false)
  const uploadKeys = useRef(new WeakMap<File, string>())
  const uploaded = useRef(new WeakMap<File, ScriptAttachment>())
  const [listQuery, setListQuery] = useState('')
  const [listStage, setListStage] = useState('')
  const [listStatus, setListStatus] = useState('')
  const [listGenre, setListGenre] = useState('')
  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [content, setContent] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<Snapshot | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [taskChanged, setTaskChanged] = useState(false)
  const [enteredNextStage, setEnteredNextStage] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [scriptValidationAttempted, setScriptValidationAttempted] = useState(false)
  const [scriptShakeVersion, setScriptShakeVersion] = useState(0)
  const [revisionDescription, setRevisionDescription] = useState('')
  const [revisionOriginal, setRevisionOriginal] = useState(false)
  const [rejectedDraft, setRejectedDraft] = useState('')
  const [hasRejectedDraft, setHasRejectedDraft] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const taskRef = useRef(''),
    submitting = useRef(false),
    dirtyRef = useRef(false),
    requestRef = useRef(0),
    abortRef = useRef<AbortController | null>(null)
  const storageKey = owner ? `zzh.student-application.pending.v1.${owner}.${id || 'new'}` : ''
  useEffect(() => {
    setPending(storageKey ? readSnapshot(storageKey) : null)
    taskRef.current = ''
    dirtyRef.current = false
    setTaskChanged(false)
    setEnteredNextStage(false)
    setLastUpdated(null)
    setRefreshError('')
    setDetail(null)
    setContent('')
    setFiles([])
    setExcludedAttachmentIds([])
    setRevisionDescription('')
    setRevisionOriginal(false)
    setSubmitError('')
    setScriptValidationAttempted(false)
    setError('')
  }, [storageKey])
  const loadDetail = useCallback(async () => {
    if (!id) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = ++requestRef.current
    setLoading(true)
    try {
      const result = await getApplication(id, controller.signal)
      if (controller.signal.aborted || requestId !== requestRef.current) return
      setDetail(result)
      setError('')
      setRefreshError('')
      setLastUpdated(Date.now())
      // A recorded version proves that an uncertain stage submission reached the server.
      const saved = storageKey ? readSnapshot(storageKey) : null
      const savedTask = saved && 'task_id' in saved.body ? saved.body.task_id : ''
      if (
        savedTask &&
        saved &&
        'stage' in saved.body &&
        result.workflow?.versions?.some(
          (version) =>
            version.task_id === savedTask &&
            version.stage === (saved.body as StageBody).stage &&
            ((saved.body as StageBody).data
              ? Boolean(version.data)
              : version.content === (saved.body as StageBody).content),
        )
      ) {
        writeSnapshot(storageKey, null)
        setPending(null)
      }
      const task = result.progress_available ? result.workflow?.current_task : null
      if (task && task.task_id !== taskRef.current) {
        if (dirtyRef.current && taskRef.current) {
          setTaskChanged(true)
        } else {
          taskRef.current = task.task_id
          const revision = isRevision(task.stage) ? parseRevisionContent(task.content || '') : null
          const data = task.data || {}
          if (task.stage === 'creative' && data) {
            setForm({
              name: String(data.applicant_name || ''),
              phone: String(data.applicant_phone || ''),
              school: String(data.applicant_school || ''),
              creative: String(data.synopsis || ''),
            })
            setIdeaFields({
              title: String(data.title || ''),
              genre: String(data.genre || ''),
              ep1Plot: String(data.episode_1_plot || ''),
              characters: String(data.characters || ''),
            })
          }
          const structured = result.workflow?.structured === true || (result.workflow?.flow_version || 0) >= 4
          const card =
            isCard(task.stage) && (structured || data.title_zh || data.title_en || data.synopsis_zh_full)
              ? formatCardContent({
                  中文剧名: String(
                    data.title_zh ||
                      result.application.title ||
                      parseSubmittedIdea(result.application.creative || '')?.title ||
                      '',
                  ),
                  英文剧名: String(data.title_en || ''),
                  一卡覆盖集数: String(data.covered_episodes ?? ''),
                  免费段最强付费卡点: String(data.strongest_paywall_episode ?? ''),
                  中文完整版剧情简介: String(data.synopsis_zh_full || ''),
                  核心卖点: String(data.selling_points || ''),
                  人物小传: String(data.character_bios || ''),
                  分集大纲与付费卡点: String(data.episode_outline_and_paywalls || ''),
                })
              : ''
          const script =
            task.stage === 'script' && (structured || data.planned_episodes || data.act_outline)
              ? formatScriptContent({
                  中文剧名: String(
                    data.title_zh ||
                      result.application.title ||
                      parseSubmittedIdea(result.application.creative || '')?.title ||
                      '',
                  ),
                  题材: String(
                    data.genre ||
                      result.application.genre ||
                      parseSubmittedIdea(result.application.creative || '')?.genre ||
                      '',
                  ),
                  预计集数: String(data.planned_episodes ?? ''),
                  单集最短时长: String(data.duration_min_seconds ?? ''),
                  单集最长时长: String(data.duration_max_seconds ?? ''),
                  首个付费解锁集: String(data.first_paid_episode ?? ''),
                  分幕大纲: String(data.act_outline || ''),
                  世界观与核心规则: String(data.world_rules || ''),
                  '重点付费 / 追更节点': Array.isArray(data.paywall_episodes) ? data.paywall_episodes.join(', ') : '',
                })
              : ''
          setContent(
            isRevision(task.stage)
              ? (revision?.body ?? readableStageContent(task.content || ''))
              : card || script || task.content || '',
          )
          setRevisionDescription(revision?.description || String(data.revision_description || ''))
          setRevisionOriginal(false)
          setFiles([])
          setExcludedAttachmentIds([])
          setScriptValidationAttempted(false)
          setSubmitError('')
          setTaskChanged(false)
        }
      } else if (!task && dirtyRef.current && taskRef.current) {
        setTaskChanged(true)
      } else if (task && task.task_id === taskRef.current) {
        setTaskChanged(false)
      }
      return true
    } catch (e) {
      if (controller.signal.aborted || requestId !== requestRef.current) return
      setRefreshError('进度更新失败，显示上次成功获取的结果，请稍后重试。')
      setError(message(e))
      return false
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [id, storageKey])
  useEffect(() => {
    if (!id) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let failures = 0
    let cycle = 0
    const requests = requestRef
    const refresh = async () => {
      if (stopped || document.hidden) return
      const currentCycle = ++cycle
      const result = await loadDetail()
      if (result === false) failures++
      else if (result === true) failures = 0
      if (!stopped && !document.hidden && currentCycle === cycle)
        timer = setTimeout(refresh, Math.min(15000 * 2 ** failures, 60000))
    }
    const resume = () => {
      cycle++
      if (timer) clearTimeout(timer)
      if (!document.hidden) void refresh()
    }
    void refresh()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
      requests.current++
      abortRef.current?.abort()
    }
  }, [id, loadDetail])
  useEffect(() => {
    if (!isList) return
    let cancelled = false
    setLoading(true)
    listApplications(offset, { q: listQuery, stage: listStage, review_status: listStatus, genre: listGenre })
      .then((r) => {
        if (!cancelled) {
          setItems(r.items)
          setTotal(r.total)
          setStats(r.stats || null)
          setError('')
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setItems([])
          setStats(null)
          setTotal(0)
          setError(message(e))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isList, offset, listQuery, listStage, listStatus, listGenre])
  const open = (path: string) => void requireAuth(() => navigate(path), { returnTo: path })
  const markScriptErrors = (values: Record<string, string>) => {
    const errors = validateScriptFields(values)
    setScriptValidationAttempted(true)
    setScriptShakeVersion((version) => version + 1)
    setSubmitError('请检查标红的剧本内容。')
    const first = scriptFields.findIndex((field) => errors[field])
    if (first >= 0)
      requestAnimationFrame(() => {
        const input = document.getElementById(`si-script-field-${first}`)
        input?.focus({ preventScroll: true })
        input?.scrollIntoView({ block: 'center', behavior: 'auto' })
      })
  }
  const removeSelectedFile = async (file: File) => {
    if (busy || pending || deletingFile) return
    const attachment = uploaded.current.get(file)
    if (attachment) {
      setDeletingFile(true)
      try {
        await deleteScriptFile(attachment.file_id)
        uploaded.current.delete(file)
        uploadKeys.current.delete(file)
      } catch (error) {
        const reason = error instanceof Error ? error.message : '请稍后重试'
        ;(isNew ? setError : setSubmitError)(`附件删除失败：${reason}`)
        return
      } finally {
        setDeletingFile(false)
      }
    }
    dirtyRef.current = true
    setFiles((current) => current.filter((item) => item !== file))
    ;(isNew ? setError : setSubmitError)('')
  }
  const submit = async (snapshot?: Snapshot) => {
    const setSubmissionError = isNew ? setError : setSubmitError
    if (submitting.current || deletingFile || !owner || !storageKey) {
      if (!owner) setSubmissionError('无法确认当前账号，请重新登录后提交。')
      return
    }
    let next = snapshot
    if (!next && isNew) {
      setIdeaValidationAttempted(true)
      const missingFields = [
        !ideaFields.title.trim() && '剧名',
        !ideaFields.genre.trim() && '题材',
        !form.creative.trim() && '故事创意',
      ].filter(Boolean)
      if (missingFields.length) {
        setSubmissionError(`请填写${missingFields.join('、')}。`)
        const firstMissing = !ideaFields.title.trim() ? 'title' : !ideaFields.genre.trim() ? 'genre' : 'creative'
        document.getElementById(`si-${firstMissing}-input`)?.focus()
        return
      }
      const name = form.name.trim(),
        phone = form.phone.trim(),
        school = form.school.trim()
      if (!creator?.profile || !creator.workflow_synced) {
        setSubmissionError(
          creatorError || (creator?.profile ? '创作者资料尚未同步，请重新保存入驻资料。' : '请先完成创作者入驻。'),
        )
        return
      }
      if (
        !name ||
        Array.from(name).length > 80 ||
        !school ||
        Array.from(school).length > 200 ||
        Array.from(ideaFields.title.trim()).length > 200 ||
        Array.from(ideaFields.genre.trim()).length > 80 ||
        !/^[\d+()\s-]{7,25}$/.test(phone) ||
        Array.from(form.creative.trim()).length > 12000
      ) {
        setSubmissionError('请检查姓名、学校、电话和创意正文的填写及长度。')
        return
      }
      if (!files.length) {
        setSubmissionError('请选择剧本文档附件。')
        return
      }
      const body: FirstBody = {
        data: {
          applicant_name: name,
          applicant_phone: phone,
          applicant_school: school,
          title: ideaFields.title.trim(),
          genre: ideaFields.genre.trim(),
          synopsis: form.creative.trim(),
          episode_1_plot: ideaFields.ep1Plot.trim(),
          characters: ideaFields.characters.trim(),
        },
      }
      next = { key: crypto.randomUUID(), body }
    } else if (!next && id) {
      const task = detail?.progress_available && detail.workflow?.current_task
      if (
        !task ||
        taskChanged ||
        detail?.workflow?.status !== 1 ||
        !['creative', 'draft', 'card', 'script', 'revision', 'final'].includes(task.stage)
      ) {
        setSubmissionError('当前待办不可提交，请刷新进度。')
        return
      }
      const structured = detail.workflow.structured === true || (detail.workflow.flow_version || 0) >= 4
      const card = parseCardContent(content)
      if (
        isCard(task.stage) &&
        card &&
        (!Number.isSafeInteger(Number(card['一卡覆盖集数'])) || Number(card['一卡覆盖集数']) < 8)
      ) {
        setSubmissionError('一卡覆盖集数至少为 8 集。')
        return
      }
      const script = parseScriptContent(content)
      if (!structured) {
        const stageContent = isRevision(task.stage)
          ? formatRevisionContent({
              description: revisionDescription.trim(),
              body: content.trim(),
              original: revisionOriginal,
            })
          : content.trim()
        if (
          !content.trim() ||
          Array.from(stageContent).length > 20000 ||
          (isRevision(task.stage) && (!revisionDescription.trim() || !revisionOriginal))
        ) {
          setSubmissionError('请填写不超过 20000 字符的完整正文，并确认当前待办。')
          return
        }
        next = { key: crypto.randomUUID(), body: { task_id: task.task_id, stage: task.stage, content: stageContent } }
      } else {
        const previous = editableAttachments(detail, task)
          .filter((file) => !excludedAttachmentIds.includes(file.file_id))
          .map((file) => ({ file_id: file.file_id }))
          .filter((file) => Number.isSafeInteger(file.file_id) && file.file_id > 0)
        let data: Record<string, unknown>
        if (task.stage === 'creative') {
          if (
            ![form.name, form.phone, form.school, form.creative, ideaFields.title, ideaFields.genre].every((value) =>
              value.trim(),
            ) ||
            !/^[\d+()\s-]{7,25}$/.test(form.phone.trim()) ||
            Array.from(ideaFields.title.trim()).length > 200 ||
            Array.from(ideaFields.genre.trim()).length > 80 ||
            Array.from(form.creative.trim()).length > 12000
          ) {
            setSubmissionError('请填写完整的申请人、学校、电话、剧名、题材和故事创意。')
            return
          }
          data = {
            applicant_name: form.name.trim(),
            applicant_phone: form.phone.trim(),
            applicant_school: form.school.trim(),
            title: ideaFields.title.trim(),
            genre: ideaFields.genre.trim(),
            synopsis: form.creative.trim(),
            episode_1_plot: ideaFields.ep1Plot.trim(),
            characters: ideaFields.characters.trim(),
          }
        } else if (isCard(task.stage) && card) {
          if (
            cardFields.some((field) => !card[field]?.trim()) ||
            !Number.isSafeInteger(Number(card['一卡覆盖集数'])) ||
            Number(card['一卡覆盖集数']) < 8 ||
            !Number.isSafeInteger(Number(card['免费段最强付费卡点'])) ||
            Number(card['免费段最强付费卡点']) < 1
          ) {
            setSubmissionError('请填写完整的一卡信息，集数必须为正整数。')
            return
          }
          data = {
            title_zh: card['中文剧名'],
            title_en: card['英文剧名'],
            covered_episodes: Number(card['一卡覆盖集数']),
            strongest_paywall_episode: Number(card['免费段最强付费卡点']),
            synopsis_zh_full: card['中文完整版剧情简介'],
            selling_points: card['核心卖点'],
            character_bios: card['人物小传'],
            episode_outline_and_paywalls: card['分集大纲与付费卡点'],
          }
        } else if (task.stage === 'script' && script) {
          const count = Number(script['预计集数']),
            min = Number(script['单集最短时长']),
            max = Number(script['单集最长时长']),
            first = Number(script['首个付费解锁集'])
          const raw = script['重点付费 / 追更节点']?.trim() || ''
          const points = raw ? raw.split(/[,，、\s]+/).map(Number) : []
          if (Object.keys(validateScriptFields(script)).length) {
            markScriptErrors(script)
            return
          }
          if ((detail.workflow.flow_version || 0) >= 5 && !revisionOriginal) {
            setSubmissionError('请勾选原创声明后提交。')
            return
          }
          if ((detail.workflow.flow_version || 0) >= 5 && !creator?.originality_version) {
            setSubmissionError('无法获取原创声明版本，请刷新页面或重新登录。')
            return
          }
          data = {
            title_zh: script['中文剧名'],
            genre: script['题材'],
            planned_episodes: count,
            duration_min_seconds: min,
            duration_max_seconds: max,
            first_paid_episode: first,
            act_outline: script['分幕大纲'],
            world_rules: script['世界观与核心规则'],
            paywall_episodes: points,
          }
          if ((detail.workflow.flow_version || 0) >= 5)
            Object.assign(data, { originality_confirmed: true, originality_version: creator!.originality_version })
        } else if (isRevision(task.stage)) {
          if (!revisionDescription.trim() || !revisionOriginal || !creator?.originality_version) {
            setSubmissionError('请填写修改说明并确认原创声明。')
            return
          }
          data = {
            revision_description: revisionDescription.trim(),
            originality_confirmed: true,
            originality_version: creator.originality_version,
          }
        } else {
          setSubmissionError('当前阶段内容不完整，请检查后提交。')
          return
        }
        if (
          !files.length &&
          (!previous.length ||
            previous.length > 30 ||
            new Set(previous.map((file) => file.file_id)).size !== previous.length)
        ) {
          setSubmissionError('请为本次提交选择 1 至 30 个附件。')
          return
        }
        if (!files.length) data.attachments = previous
        next = { key: crypto.randomUUID(), body: { task_id: task.task_id, stage: task.stage, data } }
      }
    }
    if (!next) return
    if (!snapshot && files.length) {
      submitting.current = true
      setBusy(true)
      setSubmissionError('')
      try {
        const attachments: ScriptAttachment[] = []
        for (const file of files) {
          let attachment = uploaded.current.get(file)
          if (!attachment) {
            let key = uploadKeys.current.get(file)
            if (!key) {
              key = crypto.randomUUID()
              uploadKeys.current.set(file, key)
            }
            attachment = await uploadScriptFile(file, key)
            uploaded.current.set(file, attachment)
          }
          attachments.push({ file_id: attachment.file_id })
        }
        next = { ...next, body: { ...next.body, data: { ...next.body.data, attachments } } }
      } catch (e) {
        setSubmissionError(e instanceof Error ? `附件未能上传：${e.message}。请重试。` : '附件未能上传，请重试。')
        submitting.current = false
        setBusy(false)
        return
      }
      submitting.current = false
    }
    try {
      writeSnapshot(storageKey, next)
    } catch {
      setSubmissionError('无法保存提交快照，请检查浏览器存储设置后重试。')
      return
    }
    setPending(next)
    submitting.current = true
    setBusy(true)
    setSubmissionError('')
    try {
      if (isNew) {
        const result = await postApplication(next.body as FirstBody, next.key)
        writeSnapshot(storageKey, null)
        setPending(null)
        navigate(`/script-ideas/${result.id}`, { replace: true })
      } else if (id) {
        await postStage(id, next.body as StageBody, next.key)
        writeSnapshot(storageKey, null)
        setPending(null)
        dirtyRef.current = false
        setEnteredNextStage(false)
        const refreshed = await loadDetail()
        if (refreshed) contentRef.current?.scrollTo({ top: 0, behavior: 'auto' })
      }
    } catch (e) {
      if (e instanceof StudentApplicationError && [400, 401, 403, 404].includes(e.status)) {
        writeSnapshot(storageKey, null)
        setPending(null)
      }
      if (e instanceof StudentApplicationError && e.status === 409 && id) await loadDetail()
      setSubmissionError(message(e))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const withdraw = async () => {
    const taskId = detail?.workflow?.withdraw_task_id
    if (!id || !owner || !detail?.workflow?.can_withdraw || !taskId || busy) return
    const keyName = `zzh.student-application.withdraw.v1.${owner}.${id}.${taskId}`
    let key: string
    try {
      key = localStorage.getItem(keyName) || crypto.randomUUID()
      localStorage.setItem(keyName, key)
    } catch {
      setError('无法保存撤回请求，请检查浏览器存储后重试。')
      return
    }
    setBusy(true)
    try {
      await withdrawApplication(id, taskId, '补充内容后重新提交', key)
      localStorage.removeItem(keyName)
      dirtyRef.current = false
      await loadDetail()
    } catch (e) {
      if (e instanceof StudentApplicationError && [400, 401, 403, 404].includes(e.status))
        localStorage.removeItem(keyName)
      if (e instanceof StudentApplicationError && e.status === 409) await loadDetail()
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const task = detail?.progress_available ? detail.workflow?.current_task : null
  const canEdit = Boolean(
    task &&
    ['creative', 'draft', 'card', 'script', 'revision', 'final'].includes(task.stage) &&
    detail?.workflow?.status === 1,
  )
  const reviews = [...(detail?.workflow?.reviews || [])].sort((a, b) => (b.finished_at || 0) - (a.finished_at || 0))
  const visibleReviews = reviews.filter((review) => {
    const stage =
      review.stage || detail?.workflow?.versions?.find((version) => version.version === review.version)?.stage
    const isGradedVersion =
      review.version != null && detail?.workflow?.card_grades?.some((grade) => grade.version === review.version)
    return !(review.status === 2 && (isCard(stage) || (!stage && isGradedVersion)))
  })
  const latestReview = reviews[0]
  const rejection = reviews.find((review) => review.status === 3 || review.status === 5)
  const showRejection = detail?.workflow?.review_status
    ? ['needs_changes', 'rejected'].includes(detail.workflow.review_status)
    : detail?.workflow?.status === 3 || (canEdit && latestReview?.status === 5)
  const rejectionReason = typeof rejection?.reason === 'string' ? rejection.reason.trim() : ''
  const reviewVersion = detail?.workflow?.versions?.find((version) => version.version === rejection?.version)
  const rejectedVersion =
    detail?.progress_available && latestReview && [3, 5].includes(latestReview.status)
      ? detail.workflow?.versions?.find((version) => version.version === latestReview.version)
      : undefined
  const rejectedDraftKey =
    owner && id && rejectedVersion
      ? `zzh.student-application.rejected-draft.v1.${owner}.${id}.${rejectedVersion.version}`
      : ''
  const rejectedInitialContent = rejectedVersion?.content || ''
  useEffect(() => {
    if (!rejectedDraftKey) {
      setRejectedDraft(rejectedInitialContent)
      setHasRejectedDraft(false)
      return
    }
    try {
      const saved = localStorage.getItem(rejectedDraftKey)
      setRejectedDraft(saved ?? rejectedInitialContent)
      setHasRejectedDraft(saved !== null)
    } catch {
      setRejectedDraft(rejectedInitialContent)
    }
  }, [rejectedDraftKey, rejectedInitialContent])
  // 审核中没有待办时，以最新提交版本确定正在审核的阶段；没有版本时保持未知。
  const latestSubmittedVersion = detail?.workflow?.versions?.reduce(
    (latest, version) => (!latest || version.version > latest.version ? version : latest),
    undefined as WorkflowVersion | undefined,
  )
  const approvedCreative = Boolean(
    detail?.progress_available &&
    detail.workflow?.status === 1 &&
    task?.stage === 'draft' &&
    latestSubmittedVersion?.stage === 'creative' &&
    latestReview?.status === 2 &&
    (latestReview.stage === 'creative' || latestReview.version === latestSubmittedVersion.version),
  )
  const showCreativeApproved = approvedCreative && !enteredNextStage
  const showCardApproved = Boolean(
    !enteredNextStage &&
    detail?.progress_available &&
    detail.workflow?.status === 1 &&
    task?.stage === 'revision' &&
    latestSubmittedVersion?.stage === 'draft' &&
    latestReview?.status === 2 &&
    (latestReview.stage === 'draft' || latestReview.version === latestSubmittedVersion.version),
  )
  const showScriptApproved = Boolean(
    !enteredNextStage &&
    detail?.progress_available &&
    detail.workflow?.status === 1 &&
    task?.stage === 'revision' &&
    latestSubmittedVersion?.stage === 'script' &&
    latestReview?.status === 2 &&
    (latestReview.stage === 'script' || latestReview.version === latestSubmittedVersion.version),
  )
  const currentStage = detail?.progress_available
    ? detail.workflow?.current_stage ||
      task?.stage ||
      (detail.workflow?.status === 3 ? reviewVersion?.stage : undefined) ||
      (detail.workflow?.stage === 'waiting_review' ? latestSubmittedVersion?.stage : undefined)
    : undefined
  const currentStep =
    showCreativeApproved || currentStage === 'creative'
      ? 0
      : showCardApproved || isCard(currentStage)
        ? 1
        : showScriptApproved || currentStage === 'script' || isRevision(currentStage)
          ? 2
          : -1
  const serverStatus: Record<string, string> = {
    under_review: '审核中',
    withdrawn: '已撤回',
    needs_changes: '需修改',
    awaiting_submission: '待填写',
    approved: '已通过',
    rejected: '未通过',
    cancelled: '已取消',
    pending: '处理中',
    unknown: '待核对',
  }
  const statusText =
    detail?.workflow?.review_status && serverStatus[detail.workflow.review_status]
      ? serverStatus[detail.workflow.review_status]
      : !detail?.progress_available
        ? '进度暂不可用'
        : detail.workflow?.status === 2
          ? '流程已通过'
          : detail.workflow?.status === 3
            ? '流程未通过'
            : detail.workflow?.status === 4
              ? '流程已取消'
              : detail.workflow?.stage === 'finished'
                ? '流程已完成'
                : canEdit
                  ? latestReview?.status === 5
                    ? '需修改'
                    : '待提交'
                  : detail.workflow?.stage === 'waiting_review'
                    ? '审核中'
                    : '进度待确认'
  return (
    <div className="home script-ideas">
      <AppSidebar
        activeKey="script-ideas"
        onNavigate={sidebarNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="home__main">
        <AppTopbar onMenu={() => setSidebarOpen(true)} />
        <div className="home__content" ref={contentRef}>
          <main className={`si-page${id ? ' si-review-detail' : ''}`}>
            {!isHome && (
              <div className="si-back-bar">
                <button
                  type="button"
                  className="si-back-button"
                  onClick={() => {
                    if (typeof window.history.state?.idx === 'number' && window.history.state.idx > 0) navigate(-1)
                    else navigate('/script-ideas', { replace: true })
                  }}
                >
                  ← 返回
                </button>
              </div>
            )}
            {isHome ? (
              <>
                <header className="si-heading si-heading-row">
                  <div>
                    <h1>剧本创意</h1>
                    <p>把你的故事交给我们。每条创意的进度、意见和提交内容都在这里。</p>
                  </div>
                </header>
                <div className="si-entries">
                  <section className="si-card">
                    <div className="si-entry-top">
                      <div className="si-icon">◉</div>
                      <span className="si-home-tag muted">{joinedProfile ? '已入驻' : '第一步'}</span>
                    </div>
                    <h2>{joinedProfile ? '修改入驻信息' : '入驻'}</h2>
                    <p>{joinedProfile ? '已填写创作者资料，可随时修改。' : '使用当前登录账号登记创作者资料。'}</p>
                    <button onClick={() => open('/script-ideas/join')}>
                      {joinedProfile ? '查看 / 修改' : '立即入驻'}
                    </button>
                  </section>
                  <section className="si-card">
                    <div className="si-entry-top">
                      <div className="si-icon">▤</div>
                      <span className="si-home-tag muted">进度可查</span>
                    </div>
                    <h2>我的创意</h2>
                    <p>查看所有已提交创意的进度、审核意见与提交内容。</p>
                    <button disabled={!joinedProfile} onClick={() => open('/script-ideas/list')}>
                      查看列表
                    </button>
                  </section>
                  <section className="si-card si-primary-card">
                    <div className="si-entry-top">
                      <div className="si-icon">✚</div>
                      <span className="si-home-tag">随时可提</span>
                    </div>
                    <h2>提交创意</h2>
                    <p>每条创意生成一条独立审批流程，随时可提交新的。</p>
                    <button className="si-primary" disabled={!joinedProfile} onClick={() => open('/script-ideas/new')}>
                      新建创意
                    </button>
                  </section>
                </div>
              </>
            ) : isJoin ? (
              <JoinPreview key={owner} user={authSession?.user} />
            ) : previewStage ? (
              previewStage === 'demo' ? (
                <ScriptFlowDemo key={`${owner || 'guest'}${location.search}`} owner={owner || 'guest'} />
              ) : (
                <StagePreview stage={previewStage} />
              )
            ) : (
              <>
                {!id && (
                  <header className="si-heading si-heading-row">
                    <div>
                      <h1>{isNew ? '提交新创意' : isList ? '我的创意' : `创意详情 #${id}`}</h1>
                      <p>
                        {isNew
                          ? '填写基本信息和故事创意，提交后即可查看审核进度。'
                          : isList
                            ? '查看已提交的创意记录和流程进度。'
                            : `申请编号 ${id} · 题材 — · 创建 ${formatTime(detail?.application.created_at)}`}
                      </p>
                    </div>
                    {id && detail && (
                      <span className="si-badge">{stateLabel[detail.application.state] || '状态待确认'}</span>
                    )}
                    {isList && (
                      <button className="si-primary" onClick={() => navigate('/script-ideas/new')}>
                        ＋ 提交新创意
                      </button>
                    )}
                  </header>
                )}
                {error && (
                  <div className="si-error" role="alert">
                    {error}
                  </div>
                )}
                {isNew && (
                  <form
                    className="si-card si-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void submit()
                    }}
                  >
                    <div className="si-form-head">
                      <h2>填写提交创意</h2>
                    </div>
                    <div className="si-form-section">
                      <h3>填写规范</h3>
                      <div className="si-spec">
                        <strong>▤ 创意里要有这三点就够了</strong>
                        <ul>
                          <li>主角是谁、遇到了什么困境（动机 + 代价）</li>
                          <li>最强冲突 / 爽点在哪里</li>
                          <li>想让观众追下去的钩子</li>
                          <li>详细内容可参照模板，复制文本到下方提交</li>
                        </ul>
                        <a href="/script-idea-templates/创意提交模板.docx" download>
                          ↓ 下载模板：创意提交模板.docx
                        </a>
                      </div>
                    </div>
                    <div className="si-form-section">
                      <h3>申请人信息</h3>
                      <p>请填写申请人的真实信息，以便联系和审核。</p>
                      <button type="button" onClick={() => open('/script-ideas/join')}>
                        查看 / 修改入驻信息
                      </button>
                      <div className="si-fields">
                        {(['name', 'school', 'phone'] as const).map((k) => (
                          <label key={k}>
                            {{ name: '姓名', phone: '联系电话', school: '学校 / 机构' }[k]} <em>*</em>
                            <input
                              value={form[k]}
                              onChange={(event) => setForm({ ...form, [k]: event.target.value })}
                              disabled={!!pending}
                              required
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="si-form-section">
                      <h3>申请详情</h3>
                      <div className="si-fields">
                        {(['title', 'genre'] as const).map((k) => (
                          <label key={k}>
                            {{ title: '剧名', genre: '题材' }[k]} <em>*</em>
                            {k === 'genre' ? (
                              <ScriptGenreSelect
                                id="si-genre-input"
                                value={ideaFields.genre}
                                disabled={!!pending}
                                invalid={ideaValidationAttempted && !ideaFields.genre.trim()}
                                onChange={(value) => {
                                  setIdeaFields({ ...ideaFields, genre: value })
                                  setError((previous) => (previous.startsWith('请填写') ? '' : previous))
                                }}
                              />
                            ) : (
                              <input
                                id={`si-${k}-input`}
                                value={ideaFields[k]}
                                onChange={(e) => {
                                  setIdeaFields({ ...ideaFields, [k]: e.target.value })
                                  setError((previous) => (previous.startsWith('请填写') ? '' : previous))
                                }}
                                onInvalid={() => setIdeaValidationAttempted(true)}
                                disabled={!!pending}
                                required
                                aria-invalid={ideaValidationAttempted && !ideaFields[k].trim() ? true : undefined}
                                aria-describedby={
                                  ideaValidationAttempted && !ideaFields[k].trim() ? `si-${k}-error` : undefined
                                }
                                placeholder="例如：血月禁域：双王血契"
                              />
                            )}
                            {ideaValidationAttempted && !ideaFields[k].trim() && (
                              <span className="si-field-error" id={`si-${k}-error`}>
                                请填写{k === 'title' ? '剧名' : '题材'}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                      <label>
                        故事创意 <em>*</em>
                        <textarea
                          id="si-creative-input"
                          rows={7}
                          value={form.creative}
                          onChange={(e) => setForm({ ...form, creative: e.target.value })}
                          disabled={!!pending}
                          placeholder="交代主角、困境、冲突和想看的爽点"
                          required
                        />
                      </label>
                      <label>
                        第一集剧本剧情（选填）
                        <textarea
                          rows={5}
                          value={ideaFields.ep1Plot}
                          onChange={(e) => setIdeaFields({ ...ideaFields, ep1Plot: e.target.value })}
                          disabled={!!pending}
                          placeholder="场景、时间、地点、人物、动作和对白"
                        />
                      </label>
                      <label>
                        人物、身份、性格（选填）
                        <textarea
                          rows={4}
                          value={ideaFields.characters}
                          onChange={(e) => setIdeaFields({ ...ideaFields, characters: e.target.value })}
                          disabled={!!pending}
                          placeholder="一行一个人：姓名 / 身份 / 年龄 / 性格"
                        />
                      </label>
                      <small>故事创意最多 12000 个字符。</small>
                      <div className="si-attachments">
                        <label>
                          剧本文档附件 <em>*</em>
                          <input
                            type="file"
                            multiple
                            accept=".doc,.docx,.pdf,.txt,.md,.ppt,.pptx"
                            disabled={busy || !!pending || deletingFile}
                            onChange={(event) => {
                              const selected = Array.from(event.target.files || [])
                              event.target.value = ''
                              if (!selected.length) return
                              if (
                                selected.length > 30 ||
                                selected.some(
                                  (file) =>
                                    file.size > 500 * 1024 * 1024 || !/\.(docx?|pdf|txt|md|pptx?)$/i.test(file.name),
                                )
                              ) {
                                setError(
                                  '最多选择 30 个文档，单个不超过 500 MiB，格式须为 doc、docx、pdf、txt、md、ppt 或 pptx。',
                                )
                                return
                              }
                              setFiles(selected)
                              setError('')
                            }}
                          />
                          <small>最多 30 个文件，单个不超过 500 MiB；支持 doc、docx、pdf、txt、md、ppt、pptx。</small>
                        </label>
                        {files.map((file, index) => (
                          <div className="si-attachment-item" key={`${file.name}-${file.size}-${index}`}>
                            <span>{file.name}</span>
                            <button
                              type="button"
                              disabled={busy || !!pending || deletingFile}
                              aria-label={`删除附件 ${file.name}`}
                              onClick={() => void removeSelectedFile(file)}
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    {pending ? (
                      <div className="si-pending">
                        上一次提交结果尚未确认。请先查看我的创意，再用原内容重试。
                        <button type="button" disabled={busy} onClick={() => void submit(pending)}>
                          重试原提交
                        </button>
                        <button type="button" onClick={() => navigate('/script-ideas/list')}>
                          查看我的创意
                        </button>
                      </div>
                    ) : (
                      <div className="si-form-foot">
                        <button className="si-primary" type="submit" disabled={busy || deletingFile}>
                          {busy ? '提交中…' : '提交创意'}
                        </button>
                        <button type="button" onClick={() => navigate('/script-ideas')}>
                          取消
                        </button>
                        <span>提交后进入审批流程</span>
                      </div>
                    )}
                  </form>
                )}
                {isList && (
                  <>
                    <div className="si-list-summary">
                      {(
                        [
                          ['已提交创意', 'submitted'],
                          ['审核中', 'under_review'],
                          ['需修改', 'needs_changes'],
                          ['已通过', 'approved'],
                        ] as const
                      ).map(([label, key]) => (
                        <div className="si-card si-stat" key={key}>
                          <span>{label}</span>
                          <strong>{loading || error || !stats ? '—' : (stats[key] ?? 0)}</strong>
                        </div>
                      ))}
                    </div>
                    <section className="si-card si-list">
                      <div className="si-list-tools">
                        <label>
                          搜索申请
                          <input
                            value={listQuery}
                            maxLength={200}
                            onChange={(e) => {
                              setOffset(0)
                              setListQuery(e.target.value)
                            }}
                            placeholder="剧名、姓名、学校或申请编号"
                          />
                        </label>
                        <select
                          aria-label="全部阶段"
                          value={listStage}
                          onChange={(e) => {
                            setOffset(0)
                            setListStage(e.target.value)
                          }}
                        >
                          <option value="">全部阶段</option>
                          {[
                            ['creative', '创意'],
                            ['card', '一卡'],
                            ['script', '剧本'],
                            ['final', '终稿'],
                            ['production', '制作'],
                          ].map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="全部状态"
                          value={listStatus}
                          onChange={(e) => {
                            setOffset(0)
                            setListStatus(e.target.value)
                          }}
                        >
                          <option value="">全部状态</option>
                          {Object.entries(serverStatus).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <label>
                          题材
                          <input
                            value={listGenre}
                            onChange={(e) => {
                              setOffset(0)
                              setListGenre(e.target.value)
                            }}
                            placeholder="输入题材"
                          />
                        </label>
                        <button
                          onClick={() => {
                            setOffset(0)
                            setListQuery('')
                            setListStage('')
                            setListStatus('')
                            setListGenre('')
                          }}
                        >
                          重置
                        </button>
                      </div>
                      <div className="si-list-columns">
                        <span>创意 / 申请编号</span>
                        <span>题材</span>
                        <span>当前阶段</span>
                        <span>审核状态</span>
                        <span>最近更新</span>
                        <span>操作</span>
                      </div>
                      {loading ? (
                        <p>正在加载…</p>
                      ) : items.length ? (
                        items.map((item) => (
                          <button
                            className="si-list-row"
                            key={item.id}
                            onClick={() => navigate(`/script-ideas/${item.id}`)}
                          >
                            <span>
                              <strong>{item.title || '创意申请'}</strong>
                              <small>{formatTime(item.created_at)}</small>
                            </span>
                            <span>{item.genre || '—'}</span>
                            <span>{stageLabel[item.current_stage || ''] || item.current_stage || '—'}</span>
                            <span className="si-badge">
                              {serverStatus[item.review_status || ''] || stateLabel[item.state] || '状态待确认'}
                            </span>
                            <span>{formatTime(item.updated_at)}</span>
                            <span>查看进度</span>
                          </button>
                        ))
                      ) : (
                        <p className="si-list-empty">
                          {listQuery || listStage || listStatus || listGenre
                            ? '没有匹配的申请。'
                            : '暂无已提交的创意。'}
                        </p>
                      )}
                      <div className="si-pagination">
                        <span>共 {total} 条</span>
                        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>
                          上一页
                        </button>
                        <button disabled={offset + 20 >= total} onClick={() => setOffset(offset + 20)}>
                          下一页
                        </button>
                      </div>
                    </section>
                  </>
                )}
                {id && (
                  <>
                    {loading && !detail && <p>正在加载…</p>}
                    {detail && (
                      <>
                        <section
                          className={`si-status${showRejection ? ' is-rejected' : detail.workflow?.status === 2 || showCreativeApproved || showCardApproved || showScriptApproved ? ' is-passed' : ''}`}
                        >
                          <span className="si-status-icon" aria-hidden="true">
                            {showRejection ? (
                              '!'
                            ) : showCreativeApproved || showCardApproved || showScriptApproved ? (
                              '✓'
                            ) : canEdit ? (
                              '✎'
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
                                <path
                                  d="M12 7v5h4"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </span>
                          <div className="si-status-main">
                            <h2>
                              {stateLabel[detail.application.state] === '需要管理员处理'
                                ? '需要管理员处理'
                                : showCreativeApproved || showCardApproved || showScriptApproved
                                  ? '本阶段已通过'
                                  : statusText}
                            </h2>
                            <p>
                              {detail.application.state === 'needs_review'
                                ? '流程启动失败或结果不确定，请联系管理员。'
                                : detail.application.state === 'pending'
                                  ? '申请已保存，流程启动结果尚未写回，请稍后刷新。'
                                  : !detail.progress_available
                                    ? '申请已保存，进度暂不可用，请稍后刷新。'
                                    : showRejection
                                      ? `本轮意见：${rejectionReason || '未收到审核意见，请联系管理员。'}`
                                      : showCreativeApproved
                                        ? '创意审核已通过，可以开始准备下一阶段的内容。'
                                        : showCardApproved
                                          ? '一卡审核已通过，可以开始准备下一阶段的内容。'
                                          : showScriptApproved
                                            ? '剧本审核已通过，可以开始准备下一阶段的内容。'
                                            : canEdit
                                              ? `现在可以填写「${stageLabel[task!.stage]}」的内容，填完后主动提交。`
                                              : detail.workflow?.stage === 'waiting_review'
                                                ? '申请已提交，正在审核。'
                                                : '以下内容和状态来自当前流程。'}
                            </p>
                            {showRejection && (
                              <p>
                                {canEdit
                                  ? '请根据意见修改正文后主动提交。'
                                  : '当前没有可提交的待办，如需继续请联系管理员。'}
                              </p>
                            )}
                            {(showCreativeApproved || showCardApproved || showScriptApproved) && (
                              <div className="si-status-actions">
                                <button type="button" className="si-primary" onClick={() => setEnteredNextStage(true)}>
                                  {showCreativeApproved
                                    ? '去填写「一卡」'
                                    : showCardApproved
                                      ? '去填写「剧本」'
                                      : '继续完善剧本'}{' '}
                                  →
                                </button>
                              </div>
                            )}
                            {detail.progress_available &&
                              (detail.workflow?.stage === 'waiting_review' || detail.workflow?.can_withdraw) && (
                                <>
                                  <p className="si-status-note">审核期间内容不可直接修改。</p>
                                  {detail.workflow.can_withdraw && detail.workflow.withdraw_task_id && (
                                    <div className="si-status-actions">
                                      <button type="button" disabled={busy} onClick={() => void withdraw()}>
                                        {busy ? '处理中…' : '撤回提交'}
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                            {lastUpdated && (
                              <small className="si-update-time">
                                进度自动更新 · 最近更新 {formatTime(lastUpdated)}
                              </small>
                            )}
                            {refreshError && (
                              <small className="si-refresh-error" role="status">
                                {refreshError}
                              </small>
                            )}
                          </div>
                        </section>
                        <div className="si-detail-grid">
                          <aside className="si-detail-side">
                            <div className="si-card si-progress">
                              <h2>流程进度</h2>
                              {['提交创意', '一卡', '剧本'].map((x, i) => {
                                const done = i < currentStep
                                return (
                                  <div
                                    key={x}
                                    className={
                                      currentStep === i
                                        ? `is-current${showRejection ? ' is-rejected' : ''}`
                                        : done
                                          ? 'is-done'
                                          : undefined
                                    }
                                    aria-current={currentStep === i ? 'step' : undefined}
                                  >
                                    <b aria-label={done ? '已通过' : undefined}>{done ? '✓' : i + 1}</b>
                                    <span>
                                      {x}
                                      {currentStep === i ? ' · 当前' : ''}
                                      <small>
                                        {i === 2 && isRevision(currentStage)
                                          ? '按评审意见完善正文'
                                          : ['提交故事构想', '填写一卡', '提交并完善完整剧本'][i]}
                                      </small>
                                    </span>
                                  </div>
                                )
                              })}
                              {currentStep === -1 && (
                                <p className="si-stage-unknown">当前阶段信息不足，请以审核记录和待办为准。</p>
                              )}
                            </div>
                          </aside>
                          <div>
                            {taskChanged && (
                              <div className="si-card si-task-changed" role="alert">
                                <strong>当前待办已变化，未提交的正文已保留。</strong>
                                <p>请核对最新进度后再操作；不要直接提交到原待办。</p>
                                {!canEdit && <textarea aria-label="保留的正文" value={content} readOnly rows={6} />}
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      taskRef.current = task!.task_id
                                      setTaskChanged(false)
                                    }}
                                  >
                                    使用保留正文填写新待办
                                  </button>
                                )}
                              </div>
                            )}
                            {canEdit && !showCreativeApproved && !showCardApproved && !showScriptApproved && (
                              <form
                                className="si-card si-form"
                                onSubmit={(e) => {
                                  e.preventDefault()
                                  void submit()
                                }}
                              >
                                <div className="si-form-head">
                                  <h2>填写{stageLabel[task!.stage]}</h2>
                                  <span>
                                    {isRevision(task!.stage)
                                      ? '说明改了什么，提交最终版本。'
                                      : '请按当前待办提交完整正文'}
                                  </span>
                                </div>
                                {isRevision(task!.stage) && (
                                  <div className="si-form-section">
                                    <h3>本轮评审意见</h3>
                                    <div className="si-review-note">
                                      <strong>本轮评审意见</strong>
                                      <p>{latestReview?.reason?.trim() || '暂无评审意见。'}</p>
                                    </div>
                                  </div>
                                )}
                                <div className="si-form-section">
                                  <h3>填写规范</h3>
                                  <div className="si-spec">
                                    <strong>
                                      ▤{' '}
                                      {isCard(task!.stage)
                                        ? '一卡内容建议'
                                        : task!.stage === 'script'
                                          ? '完整剧本内容建议'
                                          : '完善剧本内容建议'}
                                    </strong>
                                    <ul>
                                      {(isCard(task!.stage)
                                        ? [
                                            '完整剧情简介与核心卖点',
                                            '人物小传、分集大纲与付费卡点',
                                            '第一集正文及完整故事走向',
                                          ]
                                        : task!.stage === 'script'
                                          ? ['项目立案、集数与付费规划', '分幕大纲与世界观规则', '提交完整剧本内容']
                                          : ['逐条回应本轮评审意见，说明修改内容', '更新完整剧本正文', '确认原创声明']
                                      ).map((item) => (
                                        <li key={item}>{item}</li>
                                      ))}
                                    </ul>
                                    <a
                                      href={
                                        isCard(task!.stage)
                                          ? '/script-idea-templates/一卡标准模板.docx'
                                          : task!.stage === 'script'
                                            ? '/script-idea-templates/完整剧本标准模板.docx'
                                            : '/script-idea-templates/终稿提交模板.docx'
                                      }
                                      download
                                    >
                                      ↓ 下载本阶段模板
                                    </a>
                                    <span> 模板供参考，可选择文档附件随本次提交。</span>
                                  </div>
                                </div>
                                <p>重新加载进度不会覆盖正在编辑的内容。</p>
                                {hasRejectedDraft && rejectedVersion?.stage === task!.stage && (
                                  <div className="si-pending">
                                    发现此阶段保存的本机修改内容。
                                    <button
                                      type="button"
                                      disabled={!!pending}
                                      onClick={() => {
                                        setContent(rejectedDraft)
                                        dirtyRef.current = true
                                      }}
                                    >
                                      使用本机修改内容
                                    </button>
                                  </div>
                                )}
                                {task!.stage === 'creative' &&
                                (detail.workflow?.structured || (detail.workflow?.flow_version || 0) >= 4) ? (
                                  <div className="si-approved-fields">
                                    <h3>创意修改</h3>
                                    {(['name', 'school', 'phone'] as const).map((key) => (
                                      <label key={key}>
                                        <span>
                                          {{ name: '申请人', school: '学校 / 机构', phone: '联系电话' }[key]} <em>*</em>
                                        </span>
                                        <input
                                          required
                                          value={form[key]}
                                          disabled={busy || !!pending}
                                          onChange={(event) => {
                                            dirtyRef.current = true
                                            setForm({ ...form, [key]: event.target.value })
                                          }}
                                        />
                                      </label>
                                    ))}
                                    {(['title', 'genre'] as const).map((key) => (
                                      <label key={key}>
                                        <span>
                                          {key === 'title' ? '剧名' : '题材'} <em>*</em>
                                        </span>
                                        {key === 'genre' ? (
                                          <ScriptGenreSelect
                                            value={ideaFields.genre}
                                            disabled={busy || !!pending}
                                            onChange={(value) => {
                                              dirtyRef.current = true
                                              setIdeaFields({ ...ideaFields, genre: value })
                                            }}
                                          />
                                        ) : (
                                          <input
                                            required
                                            value={ideaFields[key]}
                                            disabled={busy || !!pending}
                                            onChange={(event) => {
                                              dirtyRef.current = true
                                              setIdeaFields({ ...ideaFields, [key]: event.target.value })
                                            }}
                                          />
                                        )}
                                      </label>
                                    ))}
                                    <label>
                                      <span>
                                        故事创意 <em>*</em>
                                      </span>
                                      <textarea
                                        required
                                        value={form.creative}
                                        disabled={busy || !!pending}
                                        onChange={(event) => {
                                          dirtyRef.current = true
                                          setForm({ ...form, creative: event.target.value })
                                        }}
                                      />
                                    </label>
                                    {(['ep1Plot', 'characters'] as const).map((key) => (
                                      <label key={key}>
                                        {key === 'ep1Plot' ? '第一集剧本剧情' : '人物、身份、性格'}
                                        <textarea
                                          value={ideaFields[key]}
                                          disabled={busy || !!pending}
                                          onChange={(event) => {
                                            dirtyRef.current = true
                                            setIdeaFields({ ...ideaFields, [key]: event.target.value })
                                          }}
                                        />
                                      </label>
                                    ))}
                                  </div>
                                ) : isRevision(task!.stage) ? (
                                  <div className="si-approved-fields si-revision-fields">
                                    <h3>终稿提交</h3>
                                    <label>
                                      <span>
                                        本次修改说明 <em>*</em>
                                      </span>
                                      <textarea
                                        rows={3}
                                        required
                                        disabled={!!pending}
                                        value={revisionDescription}
                                        onChange={(event) => {
                                          dirtyRef.current = true
                                          setRevisionDescription(event.target.value)
                                        }}
                                      />
                                    </label>
                                    {!(detail.workflow?.structured || (detail.workflow?.flow_version || 0) >= 4) && (
                                      <label>
                                        <span>
                                          剧本正文 <em>*</em>
                                        </span>
                                        <textarea
                                          rows={12}
                                          required
                                          disabled={!!pending}
                                          value={content}
                                          onChange={(event) => {
                                            dirtyRef.current = true
                                            setContent(event.target.value)
                                          }}
                                        />
                                      </label>
                                    )}
                                    <small>正文与修改说明合计最多 20000 个字符。</small>

                                    <label className="si-original-check">
                                      <input
                                        type="checkbox"
                                        required
                                        disabled={!!pending}
                                        checked={revisionOriginal}
                                        onChange={(event) => {
                                          dirtyRef.current = true
                                          setRevisionOriginal(event.target.checked)
                                          setSubmitError('')
                                        }}
                                      />
                                      <span>
                                        我确认本剧本为原创，已阅读
                                        <a
                                          href="/script-ideas/originality-statement"
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          《原创说明》
                                        </a>
                                        并同意平台用于后续制作评估 <em>*</em>
                                      </span>
                                    </label>
                                  </div>
                                ) : task!.stage === 'script' &&
                                  (!content || parseScriptContent(content) || parseCardContent(content)) ? (
                                  <div className="si-approved-fields">
                                    <h3>项目立案</h3>
                                    <div className="si-approved-grid">
                                      {scriptFields.map((field, index) => {
                                        const values = parseScriptContent(content) || {
                                          中文剧名:
                                            parseCardContent(content)?.中文剧名 ||
                                            parseSubmittedIdea(detail.application.creative || '')?.title ||
                                            '',
                                          题材: parseSubmittedIdea(detail.application.creative || '')?.genre || '',
                                        }
                                        const fieldError = scriptValidationAttempted
                                          ? validateScriptFields(values)[field]
                                          : undefined
                                        const props = {
                                          id: `si-script-field-${index}`,
                                          value: values[field] || '',
                                          required: ![6, 8].includes(index),
                                          readOnly: (detail.workflow?.flow_version || 0) >= 4 && index < 2,
                                          disabled: !!pending,
                                          className: fieldError ? 'si-input-invalid si-input-shake' : undefined,
                                          'aria-invalid': fieldError ? true : undefined,
                                          'aria-describedby': fieldError ? `si-script-error-${index}` : undefined,
                                          onInvalid: (
                                            event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>,
                                          ) => {
                                            event.preventDefault()
                                            markScriptErrors(values)
                                          },
                                          onChange: (
                                            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
                                          ) => {
                                            dirtyRef.current = true
                                            const nextValues = { ...values, [field]: event.target.value }
                                            setContent(formatScriptContent(nextValues))
                                            if (
                                              scriptValidationAttempted &&
                                              !Object.keys(validateScriptFields(nextValues)).length
                                            )
                                              setSubmitError((current) =>
                                                current === '请检查标红的剧本内容。' ? '' : current,
                                              )
                                          },
                                        }
                                        return (
                                          <label
                                            key={`${field}-${scriptShakeVersion}`}
                                            className={index >= 7 ? 'si-card-field-wide' : undefined}
                                          >
                                            <span>
                                              {field}
                                              {(index === 3 || index === 4) && '（秒）'} {props.required && <em>*</em>}
                                              {index === 6 && '（多个集数用逗号分隔）'}
                                            </span>
                                            {index >= 7 ? (
                                              <textarea {...props} rows={3} />
                                            ) : (
                                              <input
                                                {...props}
                                                type={index >= 2 && index !== 6 ? 'number' : 'text'}
                                                min={
                                                  index === 3 || index === 4
                                                    ? 10
                                                    : index >= 2 && index !== 6
                                                      ? 1
                                                      : undefined
                                                }
                                                max={index === 3 || index === 4 ? 600 : undefined}
                                                step={index >= 2 && index !== 6 ? 1 : undefined}
                                              />
                                            )}
                                            {fieldError && (
                                              <small id={`si-script-error-${index}`} className="si-field-error">
                                                {fieldError}
                                              </small>
                                            )}
                                          </label>
                                        )
                                      })}
                                    </div>
                                    {(detail.workflow?.flow_version || 0) >= 5 && (
                                      <label className="si-original-check">
                                        <input
                                          type="checkbox"
                                          checked={revisionOriginal}
                                          onChange={(event) => {
                                            dirtyRef.current = true
                                            setRevisionOriginal(event.target.checked)
                                            setSubmitError('')
                                          }}
                                        />
                                        <span>
                                          我确认本剧本为原创，已阅读
                                          <a
                                            href="/script-ideas/originality-statement"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            《原创说明》
                                          </a>
                                          并同意平台用于后续制作评估 <em>*</em>
                                        </span>
                                      </label>
                                    )}
                                  </div>
                                ) : isCard(task!.stage) && (!content || parseCardContent(content)) ? (
                                  <div className="si-approved-fields">
                                    <h3>一卡信息</h3>
                                    <div className="si-approved-grid">
                                      {cardFields.map((field, index) => {
                                        const values = parseCardContent(content) || {
                                          中文剧名: parseSubmittedIdea(detail.application.creative || '')?.title || '',
                                        }
                                        const props = {
                                          value: values[field] || '',
                                          required: true,
                                          readOnly: (detail.workflow?.flow_version || 0) >= 4 && index === 0,
                                          disabled: !!pending,
                                          onChange: (
                                            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
                                          ) => {
                                            dirtyRef.current = true
                                            setContent(formatCardContent({ ...values, [field]: event.target.value }))
                                          },
                                        }
                                        return (
                                          <label key={field} className={index >= 4 ? 'si-card-field-wide' : undefined}>
                                            <span>
                                              {field} <em>*</em>
                                            </span>
                                            {index >= 4 ? (
                                              <textarea {...props} rows={3} />
                                            ) : (
                                              <input
                                                {...props}
                                                type={index === 2 || index === 3 ? 'number' : 'text'}
                                                min={index === 2 ? 8 : index === 3 ? 1 : undefined}
                                              />
                                            )}
                                            {index === 2 && <small>至少 8 集</small>}
                                          </label>
                                        )
                                      })}
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <label>
                                      正文 <em>*</em>
                                      <textarea
                                        rows={12}
                                        value={content}
                                        disabled={!!pending}
                                        onChange={(e) => {
                                          dirtyRef.current = true
                                          setContent(e.target.value)
                                        }}
                                        required
                                      />
                                    </label>
                                    <small>最多 20000 个字符</small>
                                  </>
                                )}
                                {(detail.workflow?.structured || (detail.workflow?.flow_version || 0) >= 4) && (
                                  <div className="si-attachments">
                                    <label>
                                      本次提交附件 <em>*</em>
                                      <input
                                        type="file"
                                        multiple
                                        accept=".doc,.docx,.pdf,.txt,.md,.ppt,.pptx"
                                        disabled={busy || !!pending || deletingFile}
                                        onChange={(event) => {
                                          const selected = Array.from(event.target.files || [])
                                          event.target.value = ''
                                          if (!selected.length) return
                                          if (
                                            selected.length > 30 ||
                                            selected.some(
                                              (file) =>
                                                file.size > 500 * 1024 * 1024 ||
                                                !/\.(docx?|pdf|txt|md|pptx?)$/i.test(file.name),
                                            )
                                          ) {
                                            setSubmitError(
                                              '最多选择 30 个文档，单个不超过 500 MiB，格式须为 doc、docx、pdf、txt、md、ppt 或 pptx。',
                                            )
                                            return
                                          }
                                          dirtyRef.current = true
                                          setFiles(selected)
                                          setSubmitError('')
                                        }}
                                      />
                                      <small>
                                        每次提交需有 1 至 30 个文档，单个不超过 500 MiB。重新选择将替换本阶段已有附件。
                                      </small>
                                    </label>
                                    {files.map((file, index) => (
                                      <div className="si-attachment-item" key={`${file.name}-${file.size}-${index}`}>
                                        <span>{file.name}</span>
                                        <button
                                          type="button"
                                          disabled={busy || !!pending || deletingFile}
                                          aria-label={`删除附件 ${file.name}`}
                                          onClick={() => void removeSelectedFile(file)}
                                        >
                                          删除
                                        </button>
                                      </div>
                                    ))}
                                    {!files.length &&
                                      editableAttachments(detail, task!)
                                        .filter((file) => !excludedAttachmentIds.includes(file.file_id))
                                        .map((file) => (
                                          <div className="si-attachment-item" key={file.file_id}>
                                            <span>
                                              将沿用本阶段已有附件：{file.file_name || `文件 ${file.file_id}`}
                                            </span>
                                            <button
                                              type="button"
                                              disabled={busy || !!pending || deletingFile}
                                              aria-label={`移除本次附件 ${file.file_name || `文件 ${file.file_id}`}`}
                                              onClick={() => {
                                                dirtyRef.current = true
                                                setExcludedAttachmentIds((ids) => [...ids, file.file_id])
                                              }}
                                            >
                                              移除
                                            </button>
                                          </div>
                                        ))}
                                  </div>
                                )}
                                {submitError && (
                                  <div className="si-error si-submit-error" role="alert">
                                    {submitError}
                                  </div>
                                )}
                                {pending ? (
                                  <div className="si-pending">
                                    上次提交结果尚未确认，请刷新进度核对。
                                    {!taskChanged && (pending.body as StageBody).task_id === task?.task_id && (
                                      <button type="button" disabled={busy} onClick={() => void submit(pending)}>
                                        重试原提交
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="si-form-foot">
                                    <button className="si-primary" disabled={busy || taskChanged || deletingFile}>
                                      {busy
                                        ? '提交中…'
                                        : isRevision(task!.stage)
                                          ? '提交终稿'
                                          : `提交${stageLabel[task!.stage]}`}
                                    </button>
                                    <button type="button" onClick={() => navigate('/script-ideas/list')}>
                                      取消
                                    </button>
                                    <span>提交后进入审批流程</span>
                                  </div>
                                )}
                              </form>
                            )}
                            {(!canEdit || showCreativeApproved || showCardApproved || showScriptApproved) && (
                              <section className="si-card si-content si-readonly">
                                <div className="si-readonly-head">
                                  <span>✓</span>
                                  <div>
                                    <h2>
                                      {showCreativeApproved
                                        ? '已提交内容 · 提交创意'
                                        : showCardApproved
                                          ? '已提交内容 · 一卡'
                                          : showScriptApproved
                                            ? '已提交内容 · 剧本'
                                            : '已提交内容（只读）'}
                                    </h2>
                                    <p>
                                      {showCreativeApproved || showCardApproved || showScriptApproved
                                        ? '本阶段已通过审核，以下是已提交的内容。'
                                        : '已提交的内容可在这里查看。'}
                                    </p>
                                  </div>
                                </div>
                                {(() => {
                                  const cardVersion =
                                    showCardApproved ||
                                    showScriptApproved ||
                                    (!canEdit && latestSubmittedVersion?.stage !== 'creative')
                                      ? latestSubmittedVersion
                                      : undefined
                                  const original = cardVersion
                                    ? cardVersion.content || ''
                                    : detail.application.creative || ''
                                  const card = cardVersion ? parseCardContent(original) : null
                                  const script = cardVersion ? parseScriptContent(original) : null
                                  const revision = cardVersion ? parseRevisionContent(original) : null
                                  const parsed = parseSubmittedIdea(original)
                                  const attachments =
                                    (cardVersion?.data || latestSubmittedVersion?.data || detail.application.data)
                                      ?.attachments || []
                                  const attachmentNames =
                                    Array.isArray(attachments) && attachments.length
                                      ? attachments.map((file) => file.file_name).join('、')
                                      : '当前申请未提供附件信息'
                                  const attachmentContent =
                                    Array.isArray(attachments) && attachments.length
                                      ? attachments.map((file, index) => (
                                          <span key={`${file.file_id}-${index}`}>
                                            {index > 0 && '、'}
                                            {file.file_id > 0 ? (
                                              <a href={`/api/v1/script-files/${file.file_id}/download`} download>
                                                {file.file_name || `文件 ${file.file_id}`}
                                              </a>
                                            ) : (
                                              file.file_name || '未知文件'
                                            )}
                                          </span>
                                        ))
                                      : attachmentNames
                                  const creativeData =
                                    latestSubmittedVersion?.stage === 'creative'
                                      ? latestSubmittedVersion.data || detail.application.data
                                      : detail.application.data
                                  const rows = cardVersion
                                    ? structuredRows(cardVersion.stage, cardVersion.data)
                                      ? [
                                          ...structuredRows(cardVersion.stage, cardVersion.data)!,
                                          ['附件', attachmentNames],
                                        ]
                                      : card
                                        ? [
                                            ...cardFields.map((field) => [field, card[field] || '—']),
                                            ['一卡文档附件', attachmentNames],
                                          ]
                                        : script
                                          ? [
                                              ...scriptFields.map((field) => [field, script[field] || '—']),
                                              ['完整剧本文档附件', attachmentNames],
                                            ]
                                          : revision
                                            ? [
                                                ['本次修改说明', revision.description || '—'],
                                                ['剧本正文', revision.body || '—'],
                                                ['终稿附件', attachmentNames],
                                                ['原创声明', revision.original ? '已确认' : '未确认'],
                                              ]
                                            : [
                                                [
                                                  `${stageLabel[cardVersion.stage] || '提交'}正文`,
                                                  readableStageContent(original) || '暂无内容',
                                                ],
                                                ['附件', attachmentNames],
                                              ]
                                    : structuredRows('creative', creativeData)
                                      ? [...structuredRows('creative', creativeData)!, ['附件', attachmentNames]]
                                      : parsed
                                        ? [
                                            ['申请人', detail.application.name || '—'],
                                            ['学校', detail.application.school || '—'],
                                            ['剧名', parsed.title || '—'],
                                            ['题材', parsed.genre || '—'],
                                            ['剧情简介', parsed.synopsis || '—'],
                                            ['第一集剧本剧情（格式统一）', parsed.plot || '—'],
                                            ['人物、身份、性格', parsed.characters || '—'],
                                            ['剧本文档附件', attachmentNames],
                                          ]
                                        : [
                                            ['申请人', detail.application.name || '—'],
                                            ['学校', detail.application.school || '—'],
                                            ['故事创意', original || '暂无内容'],
                                            ['剧本文档附件', attachmentNames],
                                          ]
                                  return (
                                    <>
                                      {showCreativeApproved && parsed ? (
                                        <div className="si-approved-fields">
                                          <h3>填写规范</h3>
                                          <div className="si-spec">
                                            <strong>创意里要有这三点就够了</strong>
                                            <ul>
                                              <li>主角是谁、遇到了什么困境</li>
                                              <li>最强冲突和亮点在哪里</li>
                                              <li>想让观众追下去的钩子</li>
                                            </ul>
                                            <a href="/script-idea-templates/创意提交模板.docx" download>
                                              ↓ 下载模板：创意提交模板.docx
                                            </a>
                                          </div>
                                          <h3>申请人信息</h3>
                                          <div className="si-approved-grid">
                                            <label>
                                              申请人
                                              <input value={detail.application.name || ''} readOnly />
                                            </label>
                                            <label>
                                              学校
                                              <input value={detail.application.school || ''} readOnly />
                                            </label>
                                          </div>
                                          <h3>申请详情</h3>
                                          <div className="si-approved-grid">
                                            <label>
                                              剧名
                                              <input value={parsed.title || ''} readOnly />
                                            </label>
                                            <label>
                                              题材
                                              <input value={parsed.genre || ''} readOnly />
                                            </label>
                                          </div>
                                          <label>
                                            剧情简介
                                            <textarea value={parsed.synopsis || ''} readOnly rows={3} />
                                          </label>
                                          <label>
                                            第一集剧本剧情（格式统一）
                                            <textarea value={parsed.plot || ''} readOnly rows={4} />
                                          </label>
                                          <label>
                                            人物、身份、性格
                                            <textarea value={parsed.characters || ''} readOnly rows={3} />
                                          </label>
                                          <label>
                                            剧本文档附件
                                            <span className="si-approved-attachment">{attachmentContent}</span>
                                          </label>
                                        </div>
                                      ) : (
                                        rows.map(([label, value]) => (
                                          <div className="si-readonly-body" key={label}>
                                            <span>{label}</span>
                                            <p className="si-preserve">
                                              {label.endsWith('附件') ? attachmentContent : value}
                                            </p>
                                          </div>
                                        ))
                                      )}
                                      {parsed && (
                                        <details className="si-original-content">
                                          <summary>查看提交的完整原文</summary>
                                          <p className="si-preserve">{original}</p>
                                        </details>
                                      )}
                                    </>
                                  )
                                })()}
                                <div className="si-readonly-foot">
                                  <a
                                    href={
                                      showScriptApproved || currentStage === 'script'
                                        ? '/script-idea-templates/完整剧本标准模板.docx'
                                        : (showCardApproved || isCard(currentStage)) && !showCreativeApproved
                                          ? '/script-idea-templates/一卡标准模板.docx'
                                          : isRevision(currentStage)
                                            ? '/script-idea-templates/终稿提交模板.docx'
                                            : '/script-idea-templates/创意提交模板.docx'
                                    }
                                    download
                                  >
                                    ↓ 下载本阶段模板
                                  </a>
                                  <span>已提交内容仅供查看。</span>
                                </div>
                              </section>
                            )}
                            {pending && !canEdit && (
                              <div className="si-card si-pending">
                                存在结果未确认的提交，请刷新进度或联系管理员核对。
                              </div>
                            )}
                            <section className="si-card si-content si-timeline">
                              <h2>审批记录</h2>
                              {visibleReviews.length ? (
                                visibleReviews.map((v, i) => (
                                  <article
                                    className={`si-history${v.status === 3 || v.status === 5 ? ' is-rejected' : ''}`}
                                    key={`${v.task_id || ''}-${v.version || ''}-${i}`}
                                  >
                                    <strong>
                                      {reviewLabel[v.status] || '审核结果'}{' '}
                                      {v.version != null ? `· 版本 ${v.version}` : ''}
                                      {(() => {
                                        const stage =
                                          v.stage ||
                                          detail.workflow?.versions?.find((version) => version.version === v.version)
                                            ?.stage
                                        return stage && stageLabel[stage] ? ` · ${stageLabel[stage]}` : ''
                                      })()}
                                    </strong>
                                    <small>{formatTime(v.finished_at)}</small>
                                    <p className="si-preserve">
                                      {typeof v.reason === 'string' && v.reason.trim()
                                        ? v.reason
                                        : v.status === 3 || v.status === 5
                                          ? '未收到审核意见，请联系管理员。'
                                          : '暂无意见'}
                                    </p>
                                  </article>
                                ))
                              ) : (
                                <p>暂无审核意见</p>
                              )}
                            </section>
                            <section className="si-card si-content">
                              <h2>历史版本</h2>
                              {detail.workflow?.versions?.length ? (
                                detail.workflow.versions.map((v) => (
                                  <article className="si-history" key={`${v.version}-${v.task_id}`}>
                                    <strong>
                                      版本 {v.version} · {stageLabel[v.stage] || '提交内容'}
                                    </strong>
                                    <small>{formatTime(v.submitted_at)}</small>
                                    <p className="si-preserve">{readableStageContent(v.content || '')}</p>
                                  </article>
                                ))
                              ) : (
                                <p>暂无版本记录</p>
                              )}
                            </section>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
