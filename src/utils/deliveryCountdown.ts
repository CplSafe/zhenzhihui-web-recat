type DeliveryKind = 't1' | 't5'

/** Only timestamps with explicit offsets are unambiguous across devices. */
function timestamp(value?: string | null): number | null {
  if (!value || !/T\d{2}:\d{2}(:\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function shanghaiDate(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ms)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function deliveryDeadline(
  kind: DeliveryKind,
  createdAt?: string | null,
  deadlineAt?: string | null,
  promisedDate?: string | null,
): number | null {
  const created = timestamp(createdAt)
  const provided = timestamp(deadlineAt)
  if (deadlineAt && provided === null) return null
  const calculated = created === null ? null : created + (kind === 't1' ? 1 : 5) * 24 * 60 * 60 * 1000
  if (provided !== null && calculated !== null && provided !== calculated) return null
  const deadline = provided ?? calculated
  if (deadline === null) return null
  if (kind === 't5' && promisedDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(promisedDate) || shanghaiDate(deadline) !== promisedDate) return null
  }
  return deadline
}

export function deliveryTimeParts(deadline: number, now: number) {
  const delta = deadline - now
  const seconds = delta > 0 ? Math.ceil(delta / 1000) : Math.floor(-delta / 1000)
  return {
    overdue: delta <= 0,
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  }
}

export function formatDeliveryTime(kind: DeliveryKind, parts: ReturnType<typeof deliveryTimeParts>): string[] {
  const pad = (value: number) => String(value).padStart(2, '0')
  const totalHours = parts.days * 24 + parts.hours
  if (kind === 't5' && parts.days >= 1) return [pad(parts.days), '天', pad(parts.hours)]
  if (totalHours >= 1) return [pad(totalHours), ':', pad(parts.minutes)]
  return [pad(totalHours), ':', pad(parts.minutes), ':', pad(parts.seconds)]
}
