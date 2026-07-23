import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceSwitchBridge from '@/router/WorkspaceSwitchBridge'

function renderBridge(initialEntry: string | { pathname: string; state?: Record<string, unknown> }) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/workspace-switch" element={<WorkspaceSwitchBridge />} />
        <Route path="/home" element={<div>home-ready</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('WorkspaceSwitchBridge', () => {
  afterEach(() => vi.useRealTimers())

  it('recovers a direct visit to Home immediately', () => {
    renderBridge('/workspace-switch')
    expect(screen.getByText('home-ready')).toBeInTheDocument()
  })

  it('keeps the synchronous switch bridge briefly, then self-recovers if the switch is interrupted', () => {
    vi.useFakeTimers()
    renderBridge({ pathname: '/workspace-switch', state: { workspaceSwitchInProgress: true } })

    expect(screen.getByLabelText('正在切换空间')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByText('home-ready')).toBeInTheDocument()
  })
})
