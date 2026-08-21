/**
 * 从后端模型记录里抽取「用于展示」的信息：厂商、特点标签、耗时、是否新上线、单价。
 *
 * 目录层（generationModelCatalog）只映射了 id / 名称 / operation / 不可用原因，
 * 其余原始字段都原样留在 source 里没人读，于是模型选择器只能干列一串名字：
 * 用户要在十几个模型之间做选择，却看不到快慢、贵贱、新旧。
 *
 * 这里的取值一律「宽进严出」：字段名按候选列表匹配（后端各处命名并不统一），
 * 数据形状兼容数字/字符串/区间对象/数组；**读不到就返回空，不编造**。
 * 编一个「高质量」标签出来比不显示更糟——用户会照着它做选择。
 */

/** 归一化键名：aspect_ratio / aspectRatio / aspect-ratio 视作同一个键。 */
function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 在记录及其常见嵌套容器里按候选键名找值。
 *
 * 后端把扩展信息塞进 meta/extra/attributes 这类容器是常态，只看顶层会漏掉一半。
 */
function pickField(model: unknown, candidates: readonly string[]): unknown {
  if (!isRecord(model)) return undefined
  const wanted = new Set(candidates.map(normalizeKey))
  const containers: unknown[] = [model]
  for (const key of ['meta', 'metadata', 'extra', 'extras', 'attributes', 'attrs', 'info', 'profile', 'ext']) {
    const nested = model[key]
    if (isRecord(nested)) containers.push(nested)
  }
  for (const container of containers) {
    if (!isRecord(container)) continue
    for (const [key, value] of Object.entries(container)) {
      if (value === null || value === undefined || value === '') continue
      if (wanted.has(normalizeKey(key))) return value
    }
  }
  return undefined
}

function readText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

const PROVIDER_KEYS = [
  'provider',
  'provider_name',
  'providerName',
  'vendor',
  'vendor_name',
  'vendorName',
  'supplier',
  'brand',
  'company',
  'organization',
  'org',
] as const

const LOGO_KEYS = [
  'logo',
  'logo_url',
  'logoUrl',
  'logo_rel',
  'logoRel',
  'icon',
  'icon_url',
  'iconUrl',
  'avatar',
  'avatar_url',
  'avatarUrl',
  'image',
  'image_url',
  'imageUrl',
  'thumbnail',
] as const

const TAG_KEYS = [
  'tags',
  'labels',
  'features',
  'feature_tags',
  'featureTags',
  'highlights',
  'traits',
  'keywords',
  'badges',
  'characteristics',
] as const

const DURATION_KEYS = [
  'estimated_duration',
  'estimatedDuration',
  'estimate_duration',
  'duration_estimate',
  'durationEstimate',
  'estimated_time',
  'estimatedTime',
  'estimated_seconds',
  'estimatedSeconds',
  'average_duration',
  'averageDuration',
  'avg_duration',
  'generation_time',
  'generationTime',
  'eta',
] as const

const NEW_KEYS = ['is_new', 'isNew', 'new', 'is_latest', 'isLatest', 'recently_added', 'recentlyAdded'] as const

const PRICE_KEYS = [
  'price',
  'unit_price',
  'unitPrice',
  'credits',
  'credit',
  'credit_cost',
  'creditCost',
  'points',
  'point_cost',
  'pointCost',
  'cost',
  'consumption',
] as const

/** 展示用的模型信息；每一项都可能缺失，缺了就不渲染对应元素。 */
export interface ModelPresentation {
  /** 模型图标地址（后端 logo 字段）；缺失时列表退回首字母标记。 */
  logo: string
  /** 厂商名，用于头像/图标与副标题。 */
  provider: string
  /** 特点标签，如「轻量快速」「高质量」。已去重并限长。 */
  tags: string[]
  /** 耗时展示文案，如「5 ~ 10s」。 */
  durationLabel: string
  /** 是否新上线，用于 NEW 徽标。 */
  isNew: boolean
  /** 单次消耗积分的展示文案。 */
  priceLabel: string
}

/** 标签最多展示几个：再多会把一行挤成两行，反而看不清模型名。 */
const MAX_TAGS = 3

/** 逐项转文本 + 去重 + 限长；支持字符串数组、逗号/顿号分隔字符串、{label} 对象数组。 */
function readTags(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、/|]/) : []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of raw) {
    const text = readText(isRecord(item) ? (item.label ?? item.name ?? item.text ?? item.value) : item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    tags.push(text)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

function readSeconds(value: unknown): number {
  const num = typeof value === 'string' ? Number(value.replace(/[^\d.]/g, '')) : Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

/**
 * 耗时兼容四种形状：数字（秒）、字符串（"5~10s" 原样用）、{min,max}、[min,max]。
 * 单值也写成区间口径的单点，避免同一列表里一半写「8s」一半写「5 ~ 10s」。
 */
function readDurationLabel(value: unknown): string {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    // 已经是「5~10s」「5-10 秒」这类完整文案就原样采用，不重新拼装
    if (/[~\-—]/.test(text)) return text
    const seconds = readSeconds(text)
    return seconds ? `${seconds}s` : text
  }
  if (typeof value === 'number') {
    const seconds = readSeconds(value)
    return seconds ? `${seconds}s` : ''
  }
  const pair = Array.isArray(value)
    ? { min: value[0], max: value[1] }
    : isRecord(value)
      ? {
          min: value.min ?? value.minimum ?? value.from ?? value.low,
          max: value.max ?? value.maximum ?? value.to ?? value.high,
        }
      : null
  if (!pair) return ''
  const min = readSeconds(pair.min)
  const max = readSeconds(pair.max)
  if (min && max) return min === max ? `${min}s` : `${min} ~ ${max}s`
  const single = min || max
  return single ? `${single}s` : ''
}

/**
 * 图标地址：只接受看得出是「地址」的值。
 *
 * 后端这个字段有时会塞进模型代号之类的普通文本，直接当 src 用会渲染出一个碎图，
 * 比退回首字母更难看、也更难发现是数据的问题。
 * 相对路径原样保留（由浏览器按当前源解析），data: 内联图同样放行。
 */
function readImageSource(value: unknown): string {
  const text = readText(value)
  if (!text) return ''
  if (/^(https?:)?\/\//i.test(text) || text.startsWith('data:image/')) return text
  // 相对路径：以 / 或 ./ 开头，或带常见图片扩展名
  if (/^\.?\//.test(text) || /\.(png|jpe?g|webp|svg|gif|avif)(\?.*)?$/i.test(text)) return text
  return ''
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  const text = normalizeKey(value)
  return text === 'true' || text === '1' || text === 'yes' || text === 'new'
}

/**
 * 读取展示信息。传入目录里的 option 或后端原始记录都可以——
 * schema 与扩展字段挂在 option.source 上，只收一种形状的话调用方迟早拆漏。
 */
export function readModelPresentation(model: unknown): ModelPresentation {
  const record = isRecord(model) && isRecord(model.source) ? model.source : model
  const empty: ModelPresentation = {
    logo: '',
    provider: '',
    tags: [],
    durationLabel: '',
    isNew: false,
    priceLabel: '',
  }
  if (!isRecord(record)) return empty

  const price = readText(pickField(record, PRICE_KEYS))
  return {
    logo: readImageSource(pickField(record, LOGO_KEYS)),
    provider: readText(pickField(record, PROVIDER_KEYS)),
    tags: readTags(pickField(record, TAG_KEYS)),
    durationLabel: readDurationLabel(pickField(record, DURATION_KEYS)),
    isNew: readBoolean(pickField(record, NEW_KEYS)),
    // 纯数字补上单位，后端已经带单位（如「150 积分」）就原样用
    priceLabel: price && /^\d+(\.\d+)?$/.test(price) ? `${price} 积分` : price,
  }
}

/**
 * 列表里那个方形标记上显示的字符。
 *
 * 取**模型名**而不是厂商名：Seedance 的厂商是火山、HappyHorse 挂在字节名下，
 * 按厂商取就成了「V」「B」，和紧挨着的模型名对不上，读起来像贴错了标签。
 * 模型名没有可用字符时才退回厂商名。
 */
export function readModelInitial(displayName: string, provider = ''): string {
  for (const source of [displayName, provider]) {
    const text = String(source || '').trim()
    // 跳过引号、括号等无意义的起始字符，取第一个字母/数字/汉字
    const match = text.match(/[\p{L}\p{N}]/u)
    if (match) return match[0].toLocaleUpperCase()
  }
  return ''
}

/**
 * 由名称派生一个稳定色相，让不同系列的标记互相区分。
 *
 * 全部同色时，一列标记只是重复的装饰；换算成色相后，Seedance 与 MiniMax
 * 在余光里就是两种颜色，扫读时先按颜色分组、再读名字。
 * 用名称哈希而不是随机值：同一个模型每次打开都得是同一个颜色。
 */
export function readModelAccentHue(displayName: string): number {
  const text = String(displayName || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360
  }
  return hash
}
