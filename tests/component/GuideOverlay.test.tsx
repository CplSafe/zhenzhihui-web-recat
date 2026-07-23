import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/workspaceSession', () => ({
  useWorkspaceSessionStore: {
    getState: () => ({ authSession: { user: { id: 7 } } }),
  },
}))

import GuideOverlay from '@/components/guide/GuideOverlay'
import { isGuideSeen, useGuideStore } from '@/stores/guide'

function resetGuide() {
  useGuideStore.setState({
    activeKey: null,
    stepIndex: 0,
    stageKey: null,
    waiting: false,
    shownStages: {},
  })
}

function HomeTargets() {
  return (
    <>
      <div data-guide="nav-smart" />
      <div data-guide="home-cases" />
      <div className="home__masonry">
        <div className="home__tpl" />
      </div>
      <div data-guide="nav-projects" />
      <div data-guide="topbar-member" />
    </>
  )
}

describe('GuideOverlay', () => {
  beforeEach(() => {
    resetGuide()
    window.localStorage.clear()
  })

  it('renders an aria modal and supports next, previous, and skip close', async () => {
    act(() => useGuideStore.getState().startGuide('home'))
    const user = userEvent.setup()
    render(
      <>
        <HomeTargets />
        <GuideOverlay />
      </>,
    )

    const dialog = await screen.findByRole('dialog', { name: '新手引导' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('从这里开始')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByText('没有灵感?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(await screen.findByText('从这里开始')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '跳过(1/4)' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新手引导' })).not.toBeInTheDocument())
    expect(isGuideSeen('home', 7)).toBe(true)
  })

  it('Escape closes and persists the current guide as seen', async () => {
    act(() => useGuideStore.getState().startGuide('home'))
    const user = userEvent.setup()
    render(
      <>
        <HomeTargets />
        <GuideOverlay />
      </>,
    )
    await screen.findByRole('dialog', { name: '新手引导' })

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新手引导' })).not.toBeInTheDocument())
    expect(isGuideSeen('home', 7)).toBe(true)
  })

  it('finishes a smart stage into waiting without closing the staged guide', async () => {
    act(() => {
      useGuideStore.getState().startGuide('smart')
      useGuideStore.getState().syncSmartStage('entry')
    })
    const user = userEvent.setup()
    render(
      <>
        <div data-guide="smart-input" />
        <div data-guide="smart-at" />
        <div data-guide="smart-skills" />
        <GuideOverlay />
      </>,
    )

    expect(await screen.findByRole('dialog', { name: '新手引导' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '开始创作' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新手引导' })).not.toBeInTheDocument())
    expect(useGuideStore.getState()).toMatchObject({ activeKey: 'smart', stageKey: 'entry', waiting: true })
    expect(isGuideSeen('smart', 7)).toBe(false)
  })
})
