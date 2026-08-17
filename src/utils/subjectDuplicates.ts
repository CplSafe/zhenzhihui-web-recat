/**
 * 疑似重复主体检测。
 *
 * 背景：分镜脚本由 AI 生成，同一个产品在不同镜头可能被起成不同名字
 * （「汽车置物架」/「车载置物架」/「置物架」）。主体素材是**按名字全局共享**的
 * （见 SmartCreateView.applySubjectImage），名字一旦不一致就变成两个独立主体、
 * 各自生成素材，成片就会前后不一致——这正是难以在过程中察觉的那类问题。
 *
 * 这里只负责「找出疑似同一个东西的主体」并给出建议保留的名字，
 * 不做任何自动合并：万一真是两个不同产品（前排置物架 / 后备箱置物架），
 * 自动合并会造成更难发现的错误，决定权必须留给人。
 */

/** 单个主体在检测时需要的最小信息。 */
export interface SubjectLike {
  tag?: string
  image?: string
  refImage?: string
}

/** 一组疑似指向同一事物的主体。 */
export interface DuplicateSubjectGroup {
  /** 归一化后的核心名，仅用于分组，不展示给用户。 */
  key: string
  /** 组内出现过的原始主体名（按首次出现顺序）。 */
  names: string[]
  /** 建议统一成的名字：优先已绑定素材的，其次描述更完整（更长）的。 */
  canonical: string
}

/** AI 常加在产品名前的修饰词；去掉后才好比对核心名。 */
const QUALIFIER_PREFIX = /^(?:该|这个|那个|这款|那款|本|新款|同款|一个|一台|一只|一辆|汽车|车载|车用)/

/** 去掉 @ 前缀、空白与标点，得到可比对的紧凑名。 */
function compactName(value: string): string {
  return String(value || '')
    .replace(/^@/, '')
    .replace(/[\s·、，,。.！!？?：:；;（）()【】[\]「」《》"'"'']/g, '')
    .trim()
}

/**
 * 归一化到「核心名」：去掉修饰前缀和结构助词「的」。
 * 只剥一层前缀，避免把「新款新品」这类本身有意义的名字啃掉。
 */
export function normalizeSubjectName(value: string): string {
  const compact = compactName(value)
  if (!compact) return ''
  return compact.replace(QUALIFIER_PREFIX, '').replace(/的/g, '') || compact
}

/**
 * 判断两个核心名是否疑似同一事物。
 *
 * 除完全相同外，还接受「一个包含另一个」——「汽车置物架」去修饰后是「置物架」，
 * 而「车载置物架架体」这类扩展名同样应当被关联。要求较短的一方至少 2 个字，
 * 且长度差不超过 3，避免「架子」和「货架收纳架组合」这种远亲被硬凑到一起。
 */
export function looksLikeSameSubject(left: string, right: string): boolean {
  const a = normalizeSubjectName(left)
  const b = normalizeSubjectName(right)
  if (!a || !b) return false
  if (a === b) return true

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length < 2) return false
  if (longer.length - shorter.length > 3) return false
  return longer.includes(shorter)
}

/** 从镜头列表里收集主体，保留首次出现顺序，并记录它是否已绑定素材。 */
function collectSubjects(shots: readonly { subjects?: SubjectLike[] }[]): { name: string; hasImage: boolean }[] {
  const order: string[] = []
  const hasImage = new Map<string, boolean>()

  for (const shot of shots || []) {
    for (const subject of shot?.subjects || []) {
      const name = compactName(subject?.tag || '')
      if (!name) continue
      if (!hasImage.has(name)) {
        hasImage.set(name, false)
        order.push(name)
      }
      if (subject?.image || subject?.refImage) hasImage.set(name, true)
    }
  }

  return order.map((name) => ({ name, hasImage: hasImage.get(name) === true }))
}

/**
 * 找出疑似重复的主体分组。
 *
 * 只返回「名字不同」的组：同名主体本就共享同一张图，不存在前后不一致的风险。
 */
export function findDuplicateSubjectGroups(
  shots: readonly { subjects?: SubjectLike[] }[] | undefined,
): DuplicateSubjectGroup[] {
  const subjects = collectSubjects(shots || [])
  if (subjects.length < 2) return []

  const groups: { key: string; members: { name: string; hasImage: boolean }[] }[] = []
  for (const subject of subjects) {
    const matched = groups.find((group) =>
      group.members.some((member) => looksLikeSameSubject(member.name, subject.name)),
    )
    if (matched) matched.members.push(subject)
    else groups.push({ key: normalizeSubjectName(subject.name), members: [subject] })
  }

  return groups
    .filter((group) => group.members.length > 1)
    .map((group) => {
      // 建议保留：已绑定素材的优先（用户明确选过的那个），其次名字更完整的
      const withImage = group.members.filter((member) => member.hasImage)
      const pool = withImage.length ? withImage : group.members
      const canonical = pool.reduce((best, member) => (member.name.length > best.name.length ? member : best)).name
      return { key: group.key, names: group.members.map((member) => member.name), canonical }
    })
}
