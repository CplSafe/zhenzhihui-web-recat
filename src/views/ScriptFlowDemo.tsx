import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ScriptGenreSelect } from './ScriptGenreSelect'
import { ScriptTemplateDownloads } from './ScriptTemplateDownloads'

const stages = ['提交创意', '一卡', '剧本', '完善剧本']
const descriptions = ['说清楚你想写什么故事', '把创意扩成标准一卡', '补齐可生产的完整剧本', '按评审意见修订并提交终稿']
const specs = [
  {
    title: '创意里要有这三点就够了',
    lines: [
      '主角是谁、遇到了什么困境（动机 + 代价）',
      '最强冲突 / 爽点在哪里',
      '想让观众追下去的钩子',
      '详细内容写在文档里上传，网页上填个简介即可',
    ],
  },
  {
    title: '标准一卡包含这些（照模板写进文档）',
    lines: [
      '剧名：中文剧名 + 英文剧名',
      '梗概三版：中文完整版 / 中文简洁版 / English Platform Synopsis',
      '核心类型与核心卖点',
      '人物小传：姓名 / 身份 / 年龄 / 性格 / 核心欲望 / 剧情作用（≥3 人）',
      '分集大纲：前 3～10 集，每集结尾一个钩子',
      '免费段最强付费卡点：第几集、怎么卡、下一集怎么兑现',
      '第一集分集正文：场景 N-1｜时间｜地点｜人物 → 动作 → 对白（中英）→ 钩子',
    ],
  },
  {
    title: '完整剧本包含这些（照模板写进文档）',
    lines: [
      '项目立案：中英剧名 / 系列总名 / 题材与核心类型 / 集数 / 单集时长 / 总时长',
      '付费规划：首个付费解锁集 + 重点付费与追更节点',
      '简介三版（沿用一卡，可修订）',
      '世界观与核心规则：能做什么、不能做什么、代价是什么',
      '人物全档：角色 / 年龄 / 身份或阶层 / 性格 / 核心欲望 / 剧情作用',
      '分幕大纲：幕次 + 集数区间 + 本幕概述',
      '分集正文：Episode → 场景（时间码）→ 人物 → 动作 → 中英对白 → ENDING HOOK',
    ],
  },
  {
    title: '终稿要交什么',
    lines: ['逐条回应本轮评审意见，说清改在哪、怎么改的', '更新后的完整剧本（终稿附件）', '确认原创声明'],
  },
]
const notes = [
  '故事方向不错，请补充主角的动机和代价，并完善第一集剧情。',
  '请补充分集结尾钩子，并明确免费段最强付费卡点。',
  '请写清世界观规则中的能力边界与代价，并补齐分集正文。',
  '请根据本轮评审意见修改，并同步更新终稿附件。',
]
type Field = { name: string; type?: 'textarea' | 'number' | 'file' | 'check'; required?: boolean }
const fields: Field[][] = [
  [
    { name: '剧名', required: true },
    { name: '题材', required: true },
    { name: '剧情简介', type: 'textarea', required: true },
    { name: '第一集剧本剧情', type: 'textarea' },
    { name: '人物、身份、性格', type: 'textarea' },
    { name: '剧本文档附件', type: 'file', required: true },
  ],
  [
    { name: '中文剧名', required: true },
    { name: '英文剧名', required: true },
    { name: '一卡覆盖集数', type: 'number', required: true },
    { name: '免费段最强付费卡点', type: 'number', required: true },
    { name: '中文完整版剧情简介', type: 'textarea', required: true },
    { name: '核心卖点', type: 'textarea', required: true },
    { name: '人物小传', type: 'textarea', required: true },
    { name: '分集大纲与付费卡点', type: 'textarea', required: true },
    { name: '一卡文档附件', type: 'file', required: true },
  ],
  [
    { name: '中文剧名', required: true },
    { name: '题材', required: true },
    { name: '预计集数', type: 'number', required: true },
    { name: '单集最短时长', type: 'number', required: true },
    { name: '单集最长时长', type: 'number', required: true },
    { name: '首个付费解锁集', type: 'number', required: true },
    { name: '重点付费 / 追更节点', type: 'number' },
    { name: '分幕大纲', type: 'textarea', required: true },
    { name: '世界观与核心规则', type: 'textarea' },
    { name: '完整剧本文档附件', type: 'file', required: true },
  ],
  [
    { name: '本次修改说明', type: 'textarea', required: true },
    { name: '终稿附件', type: 'file', required: true },
    { name: '我确认本剧本为原创，并同意平台用于后续制作评估', type: 'check', required: true },
  ],
]
type Demo = {
  id?: string
  createdAt?: string
  stage: number
  status: 'pending' | 'reviewing' | 'revision' | 'passed' | 'withdrawn'
  data: Record<string, string>[]
  records: string[]
  applicant?: string
  school?: string
  reviewNote?: string
}
const initial = (): Demo => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  stage: 0,
  status: 'pending',
  data: [
    {},
    { 一卡覆盖集数: '10', 免费段最强付费卡点: '9' },
    { 预计集数: '55', 单集最短时长: '65', 单集最长时长: '72', 首个付费解锁集: '10', '重点付费 / 追更节点': '11' },
    {},
  ],
  records: [],
})

export function ScriptFlowDemo({ owner }: { owner: string }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const newId = params.get('new')
  const key = `zzh.script-flow-demo.v1.${owner}${newId ? `.draft.${newId}` : ''}`
  const indexKey = `zzh.script-flow-demo.tasks.v1.${owner}`
  const navigate = useNavigate()
  const taskId = params.get('task')
  const [demo, setDemo] = useState<Demo>(() => {
    try {
      const tasks: Demo[] = JSON.parse(localStorage.getItem(indexKey) || '[]')
      if (taskId) return tasks.find((task) => task.id === taskId) || initial()
      return JSON.parse(localStorage.getItem(key) || 'null') || initial()
    } catch {
      return initial()
    }
  })
  const [error, setError] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File[]>>({})
  const [approvalOpen, setApprovalOpen] = useState<boolean | null>(null)
  const profile: Record<string, string> = (() => {
    try {
      return JSON.parse(localStorage.getItem(`zzh.script-creator-profile.v1.${owner}`) || '{}')
    } catch {
      return {}
    }
  })()
  const save = (next: Demo) => {
    setDemo(next)
    try {
      if (!taskId) localStorage.setItem(key, JSON.stringify(next))
      if (next.records.length) {
        const tasks: Demo[] = JSON.parse(localStorage.getItem(indexKey) || '[]')
        const id = next.id || crypto.randomUUID()
        next.id = id
        localStorage.setItem(indexKey, JSON.stringify([next, ...tasks.filter((item) => item.id !== id)]))
      }
      setError('')
    } catch {
      setError('本机保存失败，请检查浏览器存储空间。')
    }
  }
  const setValue = (name: string, value: string) => {
    const data = demo.data.map((x) => ({ ...x }))
    data[demo.stage][name] = value
    save({ ...demo, data })
  }
  const changeStatus = (status: Demo['status'], message: string) =>
    save({
      ...demo,
      status,
      reviewNote: status === 'revision' ? notes[demo.stage] : demo.reviewNote,
      records: [`${new Date().toLocaleString()} · ${message}`, ...demo.records],
    })
  const values = demo.data[demo.stage]
  const isNew = demo.stage === 0 && demo.records.length === 0
  const locked = demo.status === 'reviewing' || (demo.stage === 3 && demo.status === 'passed')
  const applicant = demo.applicant ?? profile['真实姓名'] ?? ''
  const school = demo.school ?? profile['学校 / 机构'] ?? ''
  const missing = [
    ...(demo.stage === 0 && !applicant.trim() ? [{ name: '申请人' }] : []),
    ...(demo.stage === 0 && !school.trim() ? [{ name: '学校' }] : []),
    ...fields[demo.stage].filter((field) => field.required && !values[field.name]?.trim()),
  ]
  const titles = {
    pending: '待提交',
    reviewing: '审核中',
    revision: '需要修改',
    passed: demo.stage === 3 ? '全流程已完成' : '本阶段已通过',
    withdrawn: '已撤回',
  }
  return (
    <>
      <header className="si-heading">
        {isNew && <h1>提交新创意</h1>}
        <p>本页面仅在当前浏览器模拟流程，不创建真实申请；附件只记录文件名，不上传或保存文件内容。</p>
        <button type="button" onClick={() => navigate('/script-ideas/new')}>
          填写真实申请
        </button>
      </header>
      {!isNew && (
        <section
          className={`si-status${demo.status === 'passed' ? ' is-passed' : demo.status === 'revision' ? ' is-rejected' : ''}`}
        >
          <span className="si-status-icon">
            {demo.status === 'passed' ? '✓' : demo.status === 'revision' ? '!' : demo.status === 'pending' ? '✎' : '◷'}
          </span>
          <div>
            <h2>{titles[demo.status]}</h2>
            <p>
              {demo.status === 'pending'
                ? `现在可以填写「${stages[demo.stage]}」的内容。`
                : demo.status === 'reviewing'
                  ? `你的「${stages[demo.stage]}」已提交，正在模拟审核。`
                  : demo.status === 'revision'
                    ? `本轮意见：${notes[demo.stage]}`
                    : demo.status === 'passed'
                      ? demo.stage === 3
                        ? '这条创意的全部演示流程已走完。'
                        : '可以开始准备下一阶段的内容了。'
                      : '已撤回提交，现在可以修改内容。'}
            </p>
            {demo.status === 'reviewing' && <p>审核期间不可直接修改；如需修改，请先撤回提交。</p>}
            {demo.status === 'reviewing' && (
              <button type="button" onClick={() => changeStatus('withdrawn', '撤回提交')}>
                撤回提交
              </button>
            )}
            {demo.status === 'passed' && demo.stage < 3 && (
              <button
                className="si-primary"
                type="button"
                onClick={() => {
                  const next = demo.stage + 1
                  const data = demo.data.map((x) => ({ ...x }))
                  data[next] = { ...data[next], 中文剧名: demo.data[0]['剧名'] || '', 题材: demo.data[0]['题材'] || '' }
                  setSelectedFiles({})
                  save({
                    ...demo,
                    stage: next,
                    status: 'pending',
                    data,
                    records: [`${new Date().toLocaleString()} · 进入${stages[next]}，等待提交`, ...demo.records],
                  })
                }}
              >
                去填写「{stages[demo.stage + 1]}」
              </button>
            )}
          </div>
        </section>
      )}
      {(isNew || ['pending', 'revision', 'withdrawn'].includes(demo.status)) && (
        <ScriptTemplateDownloads stage={demo.stage === 0 ? 'creative' : demo.stage === 1 ? 'card' : 'script'} />
      )}
      <div className={`si-detail-grid${isNew ? ' si-demo-new' : ''}`}>
        {!isNew && (
          <aside className="si-detail-side">
            <div className="si-card si-progress">
              <h2>流程进度</h2>
              {stages.map((stage, i) => (
                <div
                  key={stage}
                  aria-current={i === demo.stage ? 'step' : undefined}
                  className={i === demo.stage ? 'is-current' : i < demo.stage ? 'is-done' : undefined}
                >
                  <b>{i < demo.stage ? '✓' : i + 1}</b>
                  <span>
                    {stage}
                    {i === demo.stage ? ' · 当前' : ''}
                    <small>{descriptions[i]}</small>
                  </span>
                </div>
              ))}
            </div>
          </aside>
        )}
        <div>
          {locked ? (
            <section className="si-card si-content si-readonly">
              <div className="si-readonly-head">
                <span>✓</span>
                <div>
                  <h2>
                    {demo.stage === 3 && demo.status === 'passed' ? '最终提交内容（只读）' : '已提交内容（只读）'}
                  </h2>
                  <p>
                    {demo.status === 'reviewing'
                      ? '审核期间不可直接修改；如需修改，请先撤回提交。'
                      : '本条创意已全部通过并归档。'}
                  </p>
                </div>
              </div>
              {demo.stage === 0 && (
                <>
                  <div className="si-readonly-body">
                    <span>申请人</span>
                    <p>{demo.applicant || profile['真实姓名'] || '—'}</p>
                  </div>
                  <div className="si-readonly-body">
                    <span>学校</span>
                    <p>{demo.school || profile['学校 / 机构'] || '—'}</p>
                  </div>
                </>
              )}
              {fields[demo.stage].map((field) => (
                <div className="si-readonly-body" key={field.name}>
                  <span>
                    {field.name === '第一集剧本剧情'
                      ? '第一集剧本剧情（格式统一）'
                      : field.name === '人物、身份、性格'
                        ? '人物、身份、性格（如文档包含可不写）'
                        : field.name}
                  </span>
                  <p className="si-preserve">{values[field.name] || '—'}</p>
                </div>
              ))}
            </section>
          ) : (
            <form
              className="si-card si-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (missing.length) {
                  setError(`请填写：${missing.map((f) => f.name).join('、')}`)
                  return
                }
                if (
                  demo.stage === 1 &&
                  (!Number.isSafeInteger(Number(values['一卡覆盖集数'])) || Number(values['一卡覆盖集数']) < 8)
                ) {
                  setError('一卡覆盖集数至少为 8 集。')
                  return
                }
                if (demo.stage === 2 && Number(values['单集最短时长']) > Number(values['单集最长时长'])) {
                  setError('单集最短时长不能超过最长时长。')
                  return
                }
                save({
                  ...demo,
                  applicant: applicant.trim(),
                  school: school.trim(),
                  status: 'reviewing',
                  records: [
                    `${new Date().toLocaleString()} · 模拟审核中`,
                    `${new Date().toLocaleString()} · 提交了「${stages[demo.stage]}」资料`,
                    ...demo.records,
                  ],
                })
              }}
            >
              <div className="si-form-head">
                <h2>
                  {locked
                    ? demo.stage === 3 && demo.status === 'passed'
                      ? '最终提交内容（只读）'
                      : '已提交内容（只读）'
                    : demo.status === 'passed'
                      ? `已提交内容 · ${stages[demo.stage]}`
                      : `填写${stages[demo.stage]}`}
                </h2>
              </div>
              <div className="si-form-section">
                <h3>填写规范</h3>
                <div className="si-spec">
                  <strong>▤ {specs[demo.stage].title}</strong>
                  <ul>
                    {specs[demo.stage].lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {demo.stage === 3 && (
                <div className="si-form-section">
                  <h3>本轮评审意见</h3>
                  <p>{demo.reviewNote || '评审意见将在这里显示，按意见修改后重新提交即可。'}</p>
                </div>
              )}
              {demo.stage === 0 && (
                <div className="si-form-section">
                  <h3>申请人信息</h3>
                  <p>可填写或修改自动带入的申请人信息。</p>
                  <div className="si-fields">
                    <label>
                      申请人 <em>*</em>
                      <input
                        value={applicant}
                        aria-required="true"
                        onChange={(event) => save({ ...demo, applicant: event.target.value })}
                      />
                    </label>
                    <label>
                      学校 <em>*</em>
                      <input
                        value={school}
                        aria-required="true"
                        onChange={(event) => save({ ...demo, school: event.target.value })}
                      />
                    </label>
                  </div>
                </div>
              )}
              <div className="si-form-section">
                <h3>{['申请详情', '一卡信息', '项目立案', '终稿提交'][demo.stage]}</h3>
                <div className="si-fields">
                  {fields[demo.stage]
                    .filter((f) => f.name !== '单集最长时长')
                    .map((f) => (
                      <label
                        key={f.name}
                        className={['textarea', 'file', 'check'].includes(f.type || '') ? 'si-field-wide' : ''}
                      >
                        {f.name === '单集最短时长' ? '单集时长' : f.name} {f.required && <em>*</em>}
                        {locked ? (
                          <p className="si-preserve">{values[f.name] || '—'}</p>
                        ) : f.name === '题材' && demo.stage === 0 ? (
                          <ScriptGenreSelect
                            value={values[f.name] || ''}
                            onChange={(value) => setValue(f.name, value)}
                          />
                        ) : f.type === 'textarea' ? (
                          <textarea
                            value={values[f.name] || ''}
                            onChange={(e) => setValue(f.name, e.target.value)}
                            rows={4}
                          />
                        ) : f.type === 'file' ? (
                          <>
                            <input
                              type="file"
                              accept=".doc,.docx,.pdf,.txt,.md,.ppt,.pptx"
                              multiple
                              onChange={(e) => {
                                const files = [...(selectedFiles[f.name] || []), ...Array.from(e.target.files || [])]
                                if (files.some((x) => !/\.(doc|docx|pdf|txt|md|ppt|pptx)$/i.test(x.name))) {
                                  setError('请上传 doc、docx、pdf、txt、md、ppt 或 pptx 格式的文件。')
                                  return
                                }
                                if (files.length > 30 || files.some((x) => x.size > 500 * 1024 * 1024)) {
                                  setError('最多选择 30 个文件，每个文件不超过 500 MB。')
                                  return
                                }
                                setSelectedFiles({ ...selectedFiles, [f.name]: files })
                                setValue(f.name, files.map((x) => x.name).join('、'))
                              }}
                            />
                            <small>上限 30 个文件，最大 500 MB/个；本机演示仅记录文件名。</small>
                            {(values[f.name] || '')
                              .split('、')
                              .filter(Boolean)
                              .map((name, index) => (
                                <div className="si-demo-file" key={`${name}-${index}`}>
                                  <span>{name}</span>
                                  <button
                                    type="button"
                                    aria-label={`移除${name}`}
                                    onClick={() => {
                                      const names = (values[f.name] || '').split('、')
                                      names.splice(index, 1)
                                      const files = [...(selectedFiles[f.name] || [])]
                                      files.splice(index, 1)
                                      setSelectedFiles({ ...selectedFiles, [f.name]: files })
                                      setValue(f.name, names.join('、'))
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                          </>
                        ) : f.type === 'check' ? (
                          <input
                            type="checkbox"
                            checked={values[f.name] === '已确认'}
                            onChange={(e) => setValue(f.name, e.target.checked ? '已确认' : '')}
                          />
                        ) : f.name === '单集最短时长' ? (
                          <div className="si-range">
                            <input
                              aria-label="单集最短时长"
                              type="number"
                              min={10}
                              max={600}
                              value={values['单集最短时长'] || ''}
                              onChange={(e) => setValue('单集最短时长', e.target.value)}
                            />
                            <span>～</span>
                            <input
                              aria-label="单集最长时长"
                              type="number"
                              min={10}
                              max={600}
                              value={values['单集最长时长'] || ''}
                              onChange={(e) => setValue('单集最长时长', e.target.value)}
                            />
                            <span>秒</span>
                          </div>
                        ) : f.type === 'number' ? (
                          <div className="si-stepper">
                            {(f.name === '免费段最强付费卡点' || f.name === '首个付费解锁集') && <span>第</span>}
                            <button
                              type="button"
                              aria-label={`减少${f.name}`}
                              onClick={() =>
                                setValue(
                                  f.name,
                                  String(
                                    Math.max(
                                      f.name === '重点付费 / 追更节点' ? 0 : f.name === '一卡覆盖集数' ? 8 : 1,
                                      Number(values[f.name] || 0) - 1,
                                    ),
                                  ),
                                )
                              }
                            >
                              −
                            </button>
                            <input
                              aria-label={f.name}
                              type="number"
                              min={f.name === '重点付费 / 追更节点' ? 0 : f.name === '一卡覆盖集数' ? 8 : 1}
                              max={
                                f.name === '一卡覆盖集数' ||
                                f.name === '免费段最强付费卡点' ||
                                f.name === '重点付费 / 追更节点'
                                  ? 30
                                  : 200
                              }
                              value={values[f.name] || ''}
                              onChange={(e) => setValue(f.name, e.target.value)}
                            />
                            <button
                              type="button"
                              aria-label={`增加${f.name}`}
                              onClick={() =>
                                setValue(
                                  f.name,
                                  String(
                                    Math.min(
                                      f.name === '一卡覆盖集数' ||
                                        f.name === '免费段最强付费卡点' ||
                                        f.name === '重点付费 / 追更节点'
                                        ? 30
                                        : 200,
                                      Number(values[f.name] || 0) + 1,
                                    ),
                                  ),
                                )
                              }
                            >
                              ＋
                            </button>
                            <span>{f.name === '重点付费 / 追更节点' ? '个' : '集'}</span>
                          </div>
                        ) : (
                          <input
                            type={f.type === 'number' ? 'number' : 'text'}
                            readOnly={
                              (demo.stage === 1 && f.name === '中文剧名') ||
                              (demo.stage === 2 && (f.name === '中文剧名' || f.name === '题材'))
                            }
                            min={
                              f.type === 'number'
                                ? f.name === '重点付费 / 追更节点'
                                  ? 0
                                  : f.name === '一卡覆盖集数'
                                    ? 8
                                    : f.name.startsWith('单集')
                                      ? 10
                                      : 1
                                : undefined
                            }
                            max={
                              f.type === 'number'
                                ? f.name === '一卡覆盖集数' ||
                                  f.name === '免费段最强付费卡点' ||
                                  f.name === '重点付费 / 追更节点'
                                  ? 30
                                  : f.name.startsWith('单集')
                                    ? 600
                                    : 200
                                : undefined
                            }
                            value={values[f.name] || ''}
                            onChange={(e) => setValue(f.name, e.target.value)}
                          />
                        )}
                      </label>
                    ))}
                </div>
              </div>
              {!locked && (
                <div className="si-form-section">
                  <h3>审批流程</h3>
                  <p>提交后会按平台配置的流程逐级审核，结果可在审批记录里查看。</p>
                  <div className="si-spec">
                    <button type="button" onClick={() => setApprovalOpen(!(approvalOpen ?? !missing.length))}>
                      审批流程 · {missing.length ? '待补全必填' : '必填已完整'}{' '}
                      {(approvalOpen ?? !missing.length) ? '收起 ▲' : '展开 ▼'}
                    </button>
                    <p>
                      {!(approvalOpen ?? !missing.length)
                        ? missing.length
                          ? `还差 ${missing.length} 项必填：${missing.map((f) => f.name).join('、')}`
                          : '必填信息已完整，展开查看审批流程。'
                        : ['创意初审', '一卡评审', '剧本评审', '终稿复核']
                            .map((label, i) => `${i + 1} ${label}${i === demo.stage ? ' · 当前' : ''}`)
                            .join('　→　')}
                    </p>
                  </div>
                </div>
              )}
              {error && <p role="alert">{error}</p>}
              {!locked && (
                <div className="si-form-foot">
                  <button className="si-primary" type="submit">
                    {demo.status === 'pending' ? '提交' : '重新提交'}
                    {demo.stage === 0 ? '创意' : demo.stage === 3 ? '终稿' : stages[demo.stage]}
                  </button>
                  <button type="button" onClick={() => navigate('/script-ideas/list')}>
                    取消
                  </button>
                </div>
              )}
            </form>
          )}
          {demo.records.length > 0 && (
            <section className="si-card si-content si-timeline">
              <h2>审批记录</h2>
              {demo.records.map((record, i) => (
                <article className="si-history" key={i}>
                  <strong>{record.split(' · ')[1]}</strong>
                  <small>{record.split(' · ')[0]}</small>
                </article>
              ))}
            </section>
          )}
        </div>
      </div>
    </>
  )
}

/** 本机模拟记录与真实申请分开，避免把模拟结果当成后台审核结果。 */
export function ScriptDemoList({ owner }: { owner: string }) {
  const navigate = useNavigate()
  const [stage, setStage] = useState('')
  const [status, setStatus] = useState('')
  const [genre, setGenre] = useState('')
  const [query, setQuery] = useState('')
  const tasks: Demo[] = (() => {
    try {
      return JSON.parse(localStorage.getItem(`zzh.script-flow-demo.tasks.v1.${owner}`) || '[]')
    } catch {
      return []
    }
  })()
  const labels: Record<Demo['status'], string> = {
    pending: '待提交',
    reviewing: '审核中',
    revision: '需修改',
    withdrawn: '已撤回',
    passed: '已通过',
  }
  const genres = Array.from(new Set(tasks.map((t) => t.data[0]['题材']).filter(Boolean)))
  const results = tasks.filter(
    (t) =>
      (!stage || String(t.stage) === stage) &&
      (!status || t.status === status) &&
      (!genre || t.data[0]['题材'] === genre) &&
      (!query.trim() || `${t.data[0]['剧名'] || ''} ${t.id || ''}`.toLowerCase().includes(query.trim().toLowerCase())),
  )
  return (
    <section className="si-card si-list" aria-label="本机演示创意">
      <div className="si-form-head">
        <h2>本机演示创意</h2>
        <span>仅显示当前浏览器的模拟记录</span>
        <button type="button" onClick={() => navigate(`/script-ideas/stage/demo?new=${crypto.randomUUID()}`)}>
          新建演示创意
        </button>
      </div>
      <div className="si-list-summary">
        {[
          ['已提交创意', tasks.length],
          ['审核中', tasks.filter((t) => t.status === 'reviewing').length],
          ['需修改', tasks.filter((t) => t.status === 'revision').length],
          ['已通过', tasks.filter((t) => t.status === 'passed').length],
        ].map(([label, count]) => (
          <div className="si-card si-stat" key={label}>
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      <div className="si-list-tools">
        <input
          aria-label="搜索演示创意"
          placeholder="搜索剧名或编号"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="演示阶段" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">全部阶段</option>
          {stages.map((name, i) => (
            <option value={i} key={name}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="演示审核状态" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(labels).map(([key, name]) => (
            <option value={key} key={key}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="演示题材" value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">全部题材</option>
          {genres.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setStage('')
            setStatus('')
            setGenre('')
            setQuery('')
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
        <span>创建时间</span>
        <span>操作</span>
      </div>
      {results.map((task) => (
        <button
          type="button"
          className="si-list-row"
          key={task.id}
          onClick={() => navigate(`/script-ideas/stage/demo?task=${encodeURIComponent(task.id || '')}`)}
        >
          <span>
            <strong>{task.data[0]['剧名'] || '未命名创意'}</strong>
            <small>{task.id}</small>
          </span>
          <span>{task.data[0]['题材'] || '—'}</span>
          <span>{stages[task.stage]}</span>
          <span className="si-badge">{labels[task.status]}</span>
          <span>{task.createdAt ? new Date(task.createdAt).toLocaleDateString() : '—'}</span>
          <span>查看进度</span>
        </button>
      ))}
      {!results.length && <p>暂无符合条件的演示创意。</p>}
    </section>
  )
}
