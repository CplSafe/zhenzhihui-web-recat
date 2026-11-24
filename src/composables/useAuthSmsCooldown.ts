import { useEffect, useState } from 'react'

const SMS_RESEND_DELAY_MS = 60_000

/** Records successful SMS sends per target for the lifetime of the current form. */
export function useAuthSmsCooldown(target: string) {
  const [resendAfter, setResendAfter] = useState<Record<string, number>>({})
  const [clock, setClock] = useState(Date.now)
  const deadline = resendAfter[target] || 0
  const hasActiveCooldown = Object.values(resendAfter).some((entry) => entry > clock)

  useEffect(() => {
    if (!hasActiveCooldown) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasActiveCooldown])

  function markSent(requestTarget: string) {
    const now = Date.now()
    setClock(now)
    setResendAfter((previous) => ({ ...previous, [requestTarget]: now + SMS_RESEND_DELAY_MS }))
  }

  return {
    remainingSeconds: Math.max(0, Math.ceil((deadline - clock) / 1000)),
    hasSentCode: deadline > 0,
    markSent,
  }
}
