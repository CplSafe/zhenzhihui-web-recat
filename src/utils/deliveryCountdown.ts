type DeliveryKind = 't1' | 't5'

/** Only timestamps with explicit offsets are unambiguous across devices. */
function timestamp(value?: string | null): number | null {
  if (!value || !/T\d{2}:\d{2}(:\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function deliveryDeadline(
  kind: DeliveryKind,
  createdAt?: string | null,
  _deadlineAt?: string | null,
  _promisedDate?: string | null,
): number | null {
  const created = timestamp(createdAt)
  if (created === null) return null
  // 按提交时刻计算，不用改期字段覆盖固定的 24 小时 / 5 自然日倒计时。
  return created + (kind === 't1' ? 1 : 5) * 24 * 60 * 60 * 1000
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
  if (kind === 't5' && parts.days >= 1) return [pad(parts.days), '天', pad(parts.hours), '小时']
  if (totalHours >= 1) return [pad(totalHours), '小时', pad(parts.minutes), '分']
  return [pad(parts.minutes), '分', pad(parts.seconds), '秒']
}
