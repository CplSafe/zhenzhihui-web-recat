import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCreator, saveCreator, type CreatorResponse } from '@/api/studentApplications'
import { scriptIdeaGenres } from '@/utils/scriptIdeaGenres'

const joinFields = [
  ['真实姓名', '请输入真实姓名'],
  ['身份类型', '请选择'],
  ['学校 / 机构', '请输入学校全称'],
  ['年级 / 专业', '例如：大三 · 广播电视编导'],
  ['所在城市', '例如：山东 · 济宁'],
  ['联系手机', '用于接收审核结果与培训通知'],
  ['联系邮箱', '用于接收文档与通知'],
  ['微信 / QQ', '选填'],
  ['擅长题材（可多选）', '搜索或输入新题材'],
]
const stageFields: Record<string, { title: string; template: string; fields: Array<[string, string]> }> = {
  card: {
    title: '一卡',
    template: '一卡标准模板.docx',
    fields: [
      ['中文剧名', 'input'],
      ['英文剧名', 'input'],
      ['一卡覆盖集数', 'stepper'],
      ['免费段最强付费卡点', 'payep'],
      ['中文完整版剧情简介', 'textarea'],
      ['核心卖点', 'textarea'],
      ['人物小传', 'textarea'],
      ['分集大纲与付费卡点', 'textarea'],
      ['一卡文档附件', 'upload'],
    ],
  },
  script: {
    title: '剧本',
    template: '完整剧本标准模板.docx',
    fields: [
      ['中文剧名', 'input'],
      ['题材', 'input'],
      ['预计集数', 'stepper'],
      ['单集时长', 'range'],
      ['首个付费解锁集', 'payep'],
      ['重点付费 / 追更节点', 'stepper'],
      ['分幕大纲', 'textarea'],
      ['世界观与核心规则', 'textarea'],
      ['完整剧本文档附件', 'upload'],
    ],
  },
  final: {
    title: '完善剧本',
    template: '终稿提交模板.docx',
    fields: [
      ['本轮评审意见', 'textarea'],
      ['本次修改说明', 'textarea'],
      ['终稿附件', 'upload'],
      ['原创声明', 'check'],
    ],
  },
}

/** 原型字段作为只读预览呈现；当前接口只支持完整文本。 */
export function PrototypeStageFields({ stage }: { stage: string }) {
  const config = stageFields[stage]
  if (!config) return null
  return (
    <div className="si-prototype-fields">
      <h3>{config.title}信息</h3>
      <div className="si-fields">
        {config.fields.map(([label, type]) => (
          <label
            key={label}
            className={type === 'textarea' || type === 'upload' || type === 'check' ? 'si-field-wide' : ''}
          >
            {label}
            {type === 'textarea' ? (
              <textarea disabled rows={3} placeholder="暂不支持单独保存" />
            ) : type === 'upload' ? (
              <div className="si-upload-placeholder">
                <button type="button" disabled aria-label="上传文件（暂不可用）">
                  ↑ 上传文件
                </button>
                <span>上限 30 个文件，最大 500 MB/个</span>
                <span>附件上传暂不可用</span>
              </div>
            ) : type === 'stepper' || type === 'payep' ? (
              <div className="si-stepper" aria-label={`${label}（暂不可用）`}>
                {type === 'payep' && <span>第</span>}
                <button type="button" disabled aria-label="减少">
                  −
                </button>
                <input type="number" disabled placeholder="—" aria-label={label} />
                <button type="button" disabled aria-label="增加">
                  ＋
                </button>
                <span>集</span>
              </div>
            ) : type === 'range' ? (
              <div className="si-range">
                <input type="number" disabled placeholder="—" aria-label="单集最短时长" />
                <span>～</span>
                <input type="number" disabled placeholder="—" aria-label="单集最长时长" />
                <span>秒</span>
              </div>
            ) : type === 'check' ? (
              <div>
                <input type="checkbox" disabled /> 原创声明暂不可提交
              </div>
            ) : (
              <input disabled placeholder="暂不支持单独保存" />
            )}
          </label>
        ))}
      </div>
    </div>
  )
}

const genreKey = '擅长题材（可多选）'
const parseGenres = (value: string) =>
  (value || '')
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean)

export function JoinPreview({ user }: { user: any }) {
  const navigate = useNavigate()
  const nickname = user?.nickname || user?.name || '当前账号'
  const accountId = user?.id ?? user?.user_id ?? user?.userId ?? user?.account_id ?? user?.uid
  const owner = accountId == null ? '' : String(accountId)
  const [creator, setCreator] = useState<CreatorResponse | null>(null)
  const [profile, setProfile] = useState<Record<string, string>>({})
  const [joined, setJoined] = useState(false)
  const [saving, setSaving] = useState(false)
  const [agreed, setAgreed] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!owner) return
    getCreator()
      .then((result) => {
        if (cancelled) return
        setCreator(result)
        if (result.profile) {
          const p = result.profile
          const identities: Record<string, string> = {
            student: '在校学生',
            creator: '自然流创作者',
            team: '团队编剧',
            freelancer: '自由职业',
          }
          setProfile({
            真实姓名: p.real_name || '',
            身份类型: identities[p.identity_type] || '',
            '学校 / 机构': p.school || '',
            '年级 / 专业': p.grade_major || '',
            所在城市: p.city || '',
            联系手机: p.phone || '',
            联系邮箱: p.email || '',
            '微信 / QQ': p.contact_im || '',
            [genreKey]: Array.isArray(p.specialties) ? p.specialties.join('、') : '',
          })
          setJoined(true)
        }
      })
      .catch(() => {
        if (!cancelled) setSaveError('无法读取服务端入驻资料，请稍后重试。')
      })
    return () => {
      cancelled = true
    }
  }, [owner])
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [genreQuery, setGenreQuery] = useState('')
  const [genreOpen, setGenreOpen] = useState(false)
  const genres = parseGenres(profile[genreKey])
  const mobile = String(user?.mobile || user?.phone || '').trim()
  const maskedPhone = /^\d{7,}$/.test(mobile) ? `${mobile.slice(0, 3)}****${mobile.slice(-4)}` : ''
  const addGenre = (value: string) => {
    const item = value.trim()
    if (item && !genres.includes(item)) setProfile({ ...profile, [genreKey]: [...genres, item].join('、') })
    setGenreQuery('')
    setGenreOpen(false)
  }
  if (saved)
    return (
      <section className="si-join-success-wrap" aria-labelledby="si-join-success-title">
        <div className="si-card si-join-success">
          <div className="si-join-success-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="m5 12 4.5 4.5L19 7"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 id="si-join-success-title">{joined ? '资料已保存' : '入驻成功'}</h1>
          <p>
            创作者资料已保存到服务端。
            <br />
            之后提交创意时可自动带入，也可随时修改。
          </p>
          <dl className="si-join-success-meta">
            <div>
              <dt>登录账号</dt>
              <dd>{accountId ?? '—'}</dd>
            </div>
            <div>
              <dt>申请人</dt>
              <dd>{profile['真实姓名']}</dd>
            </div>
            <div>
              <dt>身份类型</dt>
              <dd>{profile['身份类型']}</dd>
            </div>
            <div>
              <dt>学校 / 机构</dt>
              <dd>{profile['学校 / 机构']}</dd>
            </div>
          </dl>
          <ol className="si-join-success-steps" aria-label="创作流程">
            {['入驻', '提交创意', '一卡', '剧本', '完善剧本'].map((step, index) => (
              <li key={step} className={index === 0 ? 'is-done' : undefined}>
                <span>
                  {index === 0 ? '✓' : index + 1} {step}
                </span>
                {index < 4 && (
                  <span aria-hidden="true" className="si-join-step-arrow">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
          <div className="si-join-success-actions">
            <button type="button" className="si-primary" onClick={() => navigate('/script-ideas/new')}>
              去提交第一个创意
            </button>
            <button type="button" onClick={() => navigate('/script-ideas')}>
              返回剧本创意首页
            </button>
          </div>
        </div>
      </section>
    )
  return (
    <>
      <header className="si-heading">
        <h1>{joined ? '修改入驻信息' : '创作者入驻'}</h1>
        <p>使用当前登录的帧智汇账号填写创作者资料。</p>
      </header>
      <div className="si-join-layout">
        <form
          className="si-card si-form si-join-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!owner) {
              setSaveError('无法确认当前账号，请重新登录后再保存。')
              return
            }
            const pendingGenre = genreQuery.trim()
            const nextGenres = pendingGenre && !genres.includes(pendingGenre) ? [...genres, pendingGenre] : genres
            const next = { ...profile, [genreKey]: nextGenres.join('、') }
            if (
              ['真实姓名', '身份类型', '学校 / 机构', '联系手机', '联系邮箱', genreKey].some(
                (name) => !next[name]?.trim(),
              )
            ) {
              setSaveError('请填写完整的必填信息。')
              return
            }
            if (!agreed || !creator?.agreement_version) {
              setSaveError('请阅读并同意入驻协议，确认协议版本后提交。')
              return
            }
            if (nextGenres.length < 1 || nextGenres.length > 10 || new Set(nextGenres).size !== nextGenres.length) {
              setSaveError('擅长题材须填写 1 至 10 个且不能重复。')
              return
            }
            const identities: Record<string, string> = {
              在校学生: 'student',
              自然流创作者: 'creator',
              团队编剧: 'team',
              自由职业: 'freelancer',
            }
            setSaving(true)
            try {
              const response = await saveCreator({
                real_name: next['真实姓名'],
                identity_type: identities[next['身份类型']],
                school: next['学校 / 机构'],
                grade_major: next['年级 / 专业'] || '',
                city: next['所在城市'] || '',
                phone: next['联系手机'],
                email: next['联系邮箱'],
                contact_im: next['微信 / QQ'] || '',
                specialties: nextGenres,
                agreement_accepted: true,
                agreement_version: creator.agreement_version,
              })
              setCreator(response)
              setProfile(next)
              setGenreQuery('')
              if (response.workflow_synced) {
                setSaved(true)
                setSaveError('')
              } else setSaveError('资料已保存，但流程账号同步尚未完成，请再次保存重试。')
            } catch (error) {
              setSaveError(error instanceof Error ? error.message : '保存失败，请稍后重试。')
            } finally {
              setSaving(false)
            }
          }}
        >
          <div className="si-form-head">
            <div>
              <h2>{joined ? '修改入驻信息' : '创作者入驻'}</h2>
            </div>
          </div>
          <div className="si-form-section">
            <h3>当前登录账号</h3>
            <p>本页使用你当前登录的帧智汇账号完成入驻，无需重新注册。</p>
            <div className="si-account">
              <span>{String(nickname).slice(0, 1)}</span>
              <div>
                <strong>{nickname}</strong>
                <small>
                  账号 ID {accountId ?? '—'}
                  {maskedPhone ? ` · 手机 ${maskedPhone}` : ''}
                </small>
              </div>
            </div>
          </div>
          <div className="si-form-section">
            <h3>个人必要信息</h3>
            <div className="si-fields">
              {joinFields.map(([label, placeholder]) => {
                const required = ['真实姓名', '身份类型', '学校 / 机构', '联系手机', '联系邮箱', genreKey].includes(
                  label,
                )
                if (label === genreKey)
                  return (
                    <div className="si-field-wide si-genre-field" key={label}>
                      <label htmlFor="si-join-genres">
                        {label} <em>*</em>
                      </label>
                      <div className="si-genre-input">
                        {genres.map((item) => (
                          <span className="si-genre-chip" key={item}>
                            {item}
                            <button
                              type="button"
                              aria-label={`移除题材 ${item}`}
                              onClick={() =>
                                setProfile({ ...profile, [genreKey]: genres.filter((x) => x !== item).join('、') })
                              }
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          id="si-join-genres"
                          value={genreQuery}
                          placeholder={genres.length ? '搜索或输入新题材，回车添加' : placeholder}
                          required={!genres.length}
                          autoComplete="off"
                          onFocus={() => setGenreOpen(true)}
                          onBlur={() => window.setTimeout(() => setGenreOpen(false), 150)}
                          onChange={(e) => {
                            setGenreQuery(e.target.value)
                            setGenreOpen(true)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addGenre(genreQuery)
                            }
                            if (e.key === 'Escape') setGenreOpen(false)
                          }}
                        />
                      </div>
                      {genreOpen && (
                        <div className="si-genre-options" aria-label="题材选项">
                          {scriptIdeaGenres
                            .filter(
                              (item) => !genres.includes(item) && item.toLowerCase().includes(genreQuery.toLowerCase()),
                            )
                            .map((item) => (
                              <button type="button" key={item} onClick={() => addGenre(item)}>
                                {item}
                              </button>
                            ))}
                          {genreQuery.trim() && !genres.includes(genreQuery.trim()) && (
                            <button type="button" onClick={() => addGenre(genreQuery)}>
                              添加“{genreQuery.trim()}”
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                return (
                  <label key={label}>
                    {label} {required && <em>*</em>}
                    {label === '身份类型' ? (
                      <select
                        required
                        value={profile[label] || ''}
                        onChange={(e) => setProfile({ ...profile, [label]: e.target.value })}
                      >
                        <option value="">请选择</option>
                        {['在校学生', '自然流创作者', '团队编剧', '自由职业'].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        required={required}
                        type={label === '联系邮箱' ? 'email' : 'text'}
                        value={profile[label] || ''}
                        placeholder={placeholder}
                        onChange={(e) => setProfile({ ...profile, [label]: e.target.value })}
                      />
                    )}
                    {label === '真实姓名' && <small className="si-field-hint">与后续署名、结算一致</small>}
                    {label === '学校 / 机构' && <small className="si-field-hint">自然流创作者可填「个人创作者」</small>}
                  </label>
                )
              })}
            </div>
          </div>
          <div className="si-agreement-section">
            <label className="si-agreement">
              <input
                type="checkbox"
                aria-label="我已阅读并同意《创作者入驻协议》"
                required
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
              />
              <span>
                我已阅读并同意
                <a href="/script-ideas/creator-agreement" target="_blank" rel="noopener noreferrer">
                  《创作者入驻协议》
                </a>
              </span>
            </label>
          </div>
          {saveError && <p role="alert">{saveError}</p>}
          <div className="si-form-foot">
            <button className="si-primary" type="submit" disabled={saving || !creator?.agreement_version}>
              {joined ? '保存修改' : '提交入驻信息'}
            </button>
            <button
              type="button"
              onClick={() => {
                setProfile({
                  真实姓名: '林知夏',
                  身份类型: '在校学生',
                  '学校 / 机构': '兖州职业技术学院',
                  '年级 / 专业': '大三 · 广播电视编导',
                  所在城市: '山东 · 济宁',
                  联系手机: '13800006621',
                  联系邮箱: 'linzhixia@example.com',
                  '微信 / QQ': 'linzhixia_21',
                  [genreKey]: 'CEO豪门、大女主复仇',
                })
                setGenreQuery('')
                setGenreOpen(false)
              }}
            >
              一键填入示例
            </button>
            <button type="button" onClick={() => navigate('/script-ideas')}>
              取消
            </button>
            <span>资料会按当前账号保存</span>
          </div>
        </form>
        <aside>
          <section className="si-card si-side-card">
            <h3>入驻之后</h3>
            {[
              '账号完成入驻，之后不用再登记',
              '随时提交新创意，每条独立审批',
              '每步进度、意见、提交内容可查',
              '创意通过后可查看后续安排',
            ].map((item, index) => (
              <p key={item}>
                <b>{index + 1}</b>
                {item}
              </p>
            ))}
          </section>
        </aside>
      </div>
    </>
  )
}

export function StagePreview({ stage }: { stage: string }) {
  const navigate = useNavigate(),
    config = stageFields[stage]
  if (!config)
    return (
      <div className="si-card">
        未找到此阶段。<button onClick={() => navigate('/script-ideas')}>返回首页</button>
      </div>
    )
  return (
    <>
      <header className="si-heading">
        <h1>{config.title}表单预览</h1>
        <p>了解本阶段的填写内容与规范。</p>
      </header>
      <div className="si-unavailable" role="status">
        请在申请详情的待办中提交内容，暂不支持单独提交字段和附件。
      </div>
      <section className="si-card si-form">
        <div className="si-form-head">
          <h2>填写{config.title}</h2>
          <span>按规范准备本阶段内容</span>
        </div>
        <div className="si-form-section">
          <h3>填写规范</h3>
          <div className="si-spec">
            <strong>▤ 按模板准备{config.title}内容</strong>
            <p>下载模板查看结构和填写说明，实际提交时将完整正文粘贴到待办编辑器中。</p>
            <a href={`/script-idea-templates/${config.template}`} download>
              ↓ 下载模板：{config.template}
            </a>
          </div>
        </div>
        <PrototypeStageFields stage={stage} />
        <button type="button" disabled>
          提交{config.title}
        </button>{' '}
        <button type="button" onClick={() => navigate('/script-ideas/list')}>
          查看我的创意
        </button>
      </section>
    </>
  )
}
