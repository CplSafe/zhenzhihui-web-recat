/**
 * 营销思路拆解 · 结构化表格(按 Figma 715:5902 还原样式)。
 * 表格样式固定:左列分类 + 右列每个维度(维度名 + 提示 → 一句话描述 可编辑 + 候选标签 + 换一批)。
 * 维度/分类内容【动态】由 data.groups 驱动(AI 按产品/skill 拆解,不同产品拆出的模块可不同)。
 */
import type { MarketingBreakdownData, MarketingFieldKey } from '@/api/aiPolish'
import styles from './MarketingBreakdown.module.less'

interface MarketingBreakdownProps {
  data: MarketingBreakdownData
  onChangeDesc: (key: MarketingFieldKey, desc: string) => void
  /** 点击候选标签:把该维度的描述设为该标签 */
  onPickTag: (key: MarketingFieldKey, tag: string) => void
  /** 换一批:重新生成该维度的候选标签 */
  onRefreshTags: (key: MarketingFieldKey) => void
  refreshing?: Partial<Record<string, boolean>>
}

export default function MarketingBreakdown({
  data,
  onChangeDesc,
  onPickTag,
  onRefreshTags,
  refreshing,
}: MarketingBreakdownProps) {
  return (
    <div className={styles.mkt}>
      <div className={styles.mktHead}>
        <div className={styles.mktHeadCat}>营销点拆分</div>
        <div className={styles.mktHeadMain}>核心内容</div>
      </div>
      {(data.groups || []).map((g, gi) => (
        <div className={styles.mktRow} key={`${g.label}-${gi}`}>
          <div className={styles.mktCat}>{g.label}</div>
          <div className={styles.mktFields}>
            {g.fields.map((f) => (
              <div className={styles.mktField} key={f.key}>
                <div className={styles.mktFieldHead}>
                  <span className={styles.mktFieldLabel}>{f.label}</span>
                  {f.hint && <span className={styles.mktFieldHint}>{f.hint}</span>}
                </div>
                <div className={styles.mktBox}>
                  <textarea
                    className={styles.mktDesc}
                    value={f.desc}
                    rows={1}
                    placeholder={`${f.label}…`}
                    onChange={(e) => onChangeDesc(f.key, e.target.value)}
                  />
                  <div className={styles.mktTags}>
                    {f.tags.map((t, i) => (
                      <button
                        type="button"
                        key={`${t}-${i}`}
                        className={styles.mktTag}
                        title="点击采用该候选"
                        onClick={() => onPickTag(f.key, t)}
                      >
                        {t}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={styles.mktRefresh}
                      disabled={!!refreshing?.[f.key]}
                      onClick={() => onRefreshTags(f.key)}
                      title="换一批候选"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={refreshing?.[f.key] ? styles.mktSpin : undefined}
                      >
                        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                        <path d="M21 3v6h-6" />
                      </svg>
                      {refreshing?.[f.key] ? '换一批中…' : '换一批'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
