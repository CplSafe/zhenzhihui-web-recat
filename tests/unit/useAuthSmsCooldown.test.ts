import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useAuthSmsCooldown } from '@/composables/useAuthSmsCooldown'

it('carries phone-wide login cooldown into registration without treating its code as sent', () => {
  vi.useFakeTimers()
  try {
    const deadline = Date.now() + 45_000
    const { result } = renderHook(() => useAuthSmsCooldown('register:13800000000', deadline))
    expect(result.current.remainingSeconds).toBe(45)
    expect(result.current.hasSentCode).toBe(false)
    act(() => {
      vi.advanceTimersByTime(45_000)
    })
    expect(result.current.remainingSeconds).toBe(0)
    act(() => {
      result.current.markSent('register:13800000000')
    })
    expect(result.current.remainingSeconds).toBe(60)
    expect(result.current.hasSentCode).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})
