import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCreator, saveCreator, type CreatorResponse } from '@/api/studentApplications'
import { scriptIdeaGenres } from '@/utils/scriptIdeaGenres'
import creatorRegions from '@/data/creatorRegions.json'

// 大陆数据以 2023 年快照为基础，并与民政部 2025 年地级区划核对；港澳台另行补充。
const regions: Record<string, string[]> = creatorRegions
const otherRegion = '其他地区'
const otherCity = '其他城市'

const joinFields = [
  ['真实姓名', '请输入真实姓名'],
  ['学生状态', '请选择'],
  ['创作身份', '请选择'],
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
  const [legacyCity, setLegacyCity] = useState('')
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
            creator: '业余创作者',
            team: '团队编剧',
            freelancer: '独立编剧',
          }
          const knownProvince = p.province && regions[p.province] ? p.province : ''
          const selectedProvince = p.province ? knownProvince || otherRegion : ''
          const knownCity = knownProvince && p.city && regions[knownProvince].includes(p.city) ? p.city : ''
          setLegacyCity(!p.province && p.city ? p.city : '')
          setProfile({
            真实姓名: p.real_name || '',
            学生状态:
              p.student_status === 'student' || (!p.student_status && p.identity_type === 'student')
                ? '在校学生'
                : p.student_status === 'graduated'
                  ? '已毕业'
                  : '',
            创作身份: identities[p.creator_type || p.identity_type] || '',
            '学校 / 机构': p.school || '',
            '年级 / 专业': p.grade_major || '',
            省份: selectedProvince,
            其他省份: p.province && !knownProvince ? p.province : '',
            所在城市: p.province && p.city ? knownCity || otherCity : '',
            其他城市: p.province && p.city && !knownCity ? p.city : '',
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
  const province = profile['省份'] === otherRegion ? profile['其他省份']?.trim() || '' : profile['省份'] || ''
  const city = profile['所在城市'] === otherCity ? profile['其他城市']?.trim() || '' : profile['所在城市'] || ''
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
              <dt>学生状态</dt>
              <dd>{profile['学生状态']}</dd>
            </div>
            <div>
              <dt>创作身份</dt>
              <dd>{profile['创作身份']}</dd>
            </div>
            <div>
              <dt>{profile['学生状态'] === '在校学生' ? '学校全称' : '机构 / 公司'}</dt>
              <dd>{profile['学校 / 机构'] || '未填写'}</dd>
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
              ['真实姓名', '学生状态', '创作身份', '联系手机', '联系邮箱', genreKey].some(
                (name) => !next[name]?.trim(),
              ) ||
              (next['学生状态'] === '在校学生' && !next['学校 / 机构']?.trim()) ||
              !province ||
              !city
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
              业余创作者: 'creator',
              团队编剧: 'team',
              独立编剧: 'freelancer',
            }
            setSaving(true)
            try {
              const expectedSchool = next['学校 / 机构']?.trim() || ''
              const expectedGradeMajor = next['学生状态'] === '在校学生' ? next['年级 / 专业']?.trim() || '' : ''
              const response = await saveCreator({
                real_name: next['真实姓名'],
                identity_type: next['学生状态'] === '在校学生' ? 'student' : identities[next['创作身份']],
                student_status: next['学生状态'] === '在校学生' ? 'student' : 'graduated',
                creator_type: identities[next['创作身份']] as 'creator' | 'team' | 'freelancer',
                school: expectedSchool,
                grade_major: expectedGradeMajor,
                province,
                city,
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
              const expectedStatus = next['学生状态'] === '在校学生' ? 'student' : 'graduated'
              if (
                response.profile?.student_status !== expectedStatus ||
                response.profile?.creator_type !== identities[next['创作身份']] ||
                (response.profile?.school || '') !== expectedSchool ||
                (response.profile?.grade_major || '') !== expectedGradeMajor ||
                (response.profile?.province || '') !== province ||
                (response.profile?.city || '') !== city
              ) {
                setSaveError(
                  '资料可能已部分保存，但服务端尚未确认学生状态、创作身份、学校或所在地信息，请联系管理员确认后再重试。',
                )
              } else if (response.workflow_synced) {
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
          {[
            {
              title: '身份信息',
              fields: ['真实姓名', '学生状态', '创作身份', '学校 / 机构', '年级 / 专业'],
            },
            { title: '所在地', fields: ['所在城市'] },
            { title: '联系方式', fields: ['联系手机', '联系邮箱', '微信 / QQ'] },
            { title: '创作方向', fields: [genreKey] },
          ].map((section) => (
            <div className="si-form-section" key={section.title}>
              <h3>{section.title}</h3>
              <div className="si-fields">
                {joinFields
                  .filter(([label]) => section.fields.includes(label))
                  .map(([label, placeholder]) => {
                    if (label === '所在城市')
                      return (
                        <fieldset className="si-field-wide si-region-field" key={label}>
                          <legend>
                            所在城市 <em>*</em>
                          </legend>
                          {legacyCity && !city && (
                            <p className="si-field-hint">原所在地：{legacyCity}。请重新选择省市。</p>
                          )}
                          <div className="si-region-selects">
                            <label>
                              <span className="si-visually-hidden">省 / 直辖市</span>
                              <select
                                aria-label="省 / 直辖市"
                                required
                                value={profile['省份'] || ''}
                                onChange={(event) => {
                                  const value = event.target.value
                                  setProfile((old) => ({
                                    ...old,
                                    省份: value,
                                    其他省份: '',
                                    所在城市: '',
                                    其他城市: '',
                                  }))
                                }}
                              >
                                <option value="">请选择省 / 直辖市</option>
                                {Object.keys(regions).map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                                <option value={otherRegion}>{otherRegion}</option>
                              </select>
                            </label>
                            <label>
                              <span className="si-visually-hidden">城市</span>
                              <select
                                aria-label="城市"
                                required
                                disabled={!profile['省份']}
                                value={profile['所在城市'] || ''}
                                onChange={(event) => {
                                  const value = event.target.value
                                  setProfile((old) => ({ ...old, 所在城市: value, 其他城市: '' }))
                                }}
                              >
                                <option value="">{profile['省份'] ? '请选择城市' : '请先选择省'}</option>
                                {(regions[profile['省份']] || []).map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                                <option value={otherCity}>{otherCity}</option>
                              </select>
                            </label>
                            {profile['省份'] === otherRegion && (
                              <label>
                                省份 / 地区名称 <em>*</em>
                                <input
                                  required
                                  value={profile['其他省份'] || ''}
                                  onChange={(event) => {
                                    const value = event.target.value
                                    setProfile((old) => ({ ...old, 其他省份: value }))
                                  }}
                                />
                              </label>
                            )}
                            {profile['所在城市'] === otherCity && (
                              <label>
                                城市名称 <em>*</em>
                                <input
                                  required
                                  value={profile['其他城市'] || ''}
                                  onChange={(event) => {
                                    const value = event.target.value
                                    setProfile((old) => ({ ...old, 其他城市: value }))
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        </fieldset>
                      )
                    if (label === '创作身份')
                      return (
                        <fieldset className="si-identity-field" key={label}>
                          <legend>
                            创作身份 <em>*</em>
                          </legend>
                          <div className="si-identity-options">
                            {[
                              ['业余创作者', '写作不是主业，用业余时间写，靠投稿拿稿费'],
                              ['独立编剧', '靠写剧本为生，自己接项目、按单结算'],
                              ['团队编剧', '已在制作团队里，按团队分工和排期写作'],
                            ].map(([value, description]) => (
                              <label className="si-identity-option" key={value}>
                                <input
                                  type="radio"
                                  name="creator-identity"
                                  required
                                  value={value}
                                  checked={profile[label] === value}
                                  onChange={() => setProfile((old) => ({ ...old, [label]: value }))}
                                />
                                <strong>{value}</strong>
                                <span>{description}</span>
                              </label>
                            ))}
                          </div>
                          <small className="si-field-hint">
                            按你现在的实际情况选，选错随时可以在入驻信息里改，不影响已提交的创意
                          </small>
                        </fieldset>
                      )
                    if (label === '年级 / 专业' && profile['学生状态'] !== '在校学生') return null
                    if (label === '学校 / 机构' && !profile['学生状态']) return null
                    const required =
                      ['真实姓名', '学生状态', '创作身份', '联系手机', '联系邮箱', genreKey].includes(label) ||
                      (label === '学校 / 机构' && profile['学生状态'] === '在校学生')
                    const displayLabel =
                      label === '学校 / 机构'
                        ? profile['学生状态'] === '在校学生'
                          ? '学校全称'
                          : '机构 / 公司（选填）'
                        : label === '年级 / 专业'
                          ? '年级 / 专业（选填）'
                          : label
                    if (label === genreKey)
                      return (
                        <div
                          className="si-field-wide si-genre-field"
                          key={label}
                          onBlur={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget)) setGenreOpen(false)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') setGenreOpen(false)
                          }}
                        >
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
                              aria-expanded={genreOpen}
                              aria-controls="si-join-genre-options"
                              onFocus={() => setGenreOpen(true)}
                              onChange={(e) => {
                                setGenreQuery(e.target.value)
                                setGenreOpen(true)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  addGenre(genreQuery)
                                }
                                if (e.key === 'ArrowDown' && genreOpen) {
                                  e.preventDefault()
                                  document.querySelector<HTMLButtonElement>('#si-join-genre-options button')?.focus()
                                }
                              }}
                            />
                          </div>
                          {genreOpen && (
                            <div id="si-join-genre-options" className="si-genre-options" aria-label="题材选项">
                              {scriptIdeaGenres
                                .filter(
                                  (item) =>
                                    !genres.includes(item) && item.toLowerCase().includes(genreQuery.toLowerCase()),
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
                        {displayLabel} {required && <em>*</em>}
                        {label === '学生状态' ? (
                          <select
                            required
                            value={profile[label] || ''}
                            onChange={(e) => {
                              const value = e.target.value
                              setProfile((old) => ({
                                ...old,
                                [label]: value,
                                ...(label === '学生状态' && old['学生状态'] && old['学生状态'] !== value
                                  ? { '学校 / 机构': '', '年级 / 专业': '' }
                                  : {}),
                              }))
                            }}
                          >
                            <option value="">请选择</option>
                            {['在校学生', '已毕业'].map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            required={required}
                            type={label === '联系邮箱' ? 'email' : 'text'}
                            value={profile[label] || ''}
                            placeholder={
                              label === '学校 / 机构' && profile['学生状态'] === '已毕业'
                                ? '请输入机构或公司名称'
                                : placeholder
                            }
                            onChange={(e) => setProfile({ ...profile, [label]: e.target.value })}
                          />
                        )}
                        {label === '真实姓名' && <small className="si-field-hint">与后续署名、结算一致</small>}
                        {label === '学校 / 机构' && profile['学生状态'] === '已毕业' && (
                          <small className="si-field-hint">个人创作者可填「个人创作者」</small>
                        )}
                      </label>
                    )
                  })}
              </div>
            </div>
          ))}
          <div className="si-agreement-section">
            <h3>协议确认</h3>
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
          <section className="si-card si-side-card">
            <h3>关于信息同步</h3>
            <p>入驻资料按当前账号保存，提交创意时可带入；入驻资料不计入「我的创意」。</p>
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
            <p>请在申请详情的待办中按阶段要求准备并提交内容。</p>
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
