import { beforeEach, describe, expect, it } from 'vitest'
import {
  armSmartGuide,
  disarmSmartGuide,
  guideKeyForPath,
  guideLabelForPath,
  isGuideSeen,
  isSmartGuideArmed,
  isSmartGuideOnboarded,
  markGuideSeen,
  useGuideStore,
} from '@/stores/guide'

const resetStore = () =>
  useGuideStore.setState({
    activeKey: null,
    stepIndex: 0,
    stageKey: null,
    waiting: false,
    shownStages: {},
  })

describe('guide store', () => {
  beforeEach(() => {
    resetStore()
    window.localStorage.clear()
  })

  it('maps supported routes and labels without matching unrelated pages', () => {
    expect(guideKeyForPath('/home')).toBe('home')
    expect(guideKeyForPath('/smart/101')).toBe('smart')
    expect(guideKeyForPath('/projects')).toBeNull()
    expect(guideLabelForPath('/home')).toBe('首页新手引导')
    expect(guideLabelForPath('/smart')).toBe('智能成片新手引导')
    expect(guideLabelForPath('/projects')).toBe('新手引导')
  })

  it('persists seen state by guide and user', () => {
    markGuideSeen('home', 7)

    expect(isGuideSeen('home', 7)).toBe(true)
    expect(isGuideSeen('home', 8)).toBe(false)
    expect(isGuideSeen('smart', 7)).toBe(false)
  })

  it('arms smart onboarding once per user and supports explicit disarm', () => {
    armSmartGuide(7)
    expect(isSmartGuideArmed()).toBe(true)
    expect(isSmartGuideOnboarded(7)).toBe(true)

    disarmSmartGuide()
    expect(isSmartGuideArmed()).toBe(false)

    armSmartGuide(7)
    expect(isSmartGuideArmed()).toBe(false)

    armSmartGuide(8)
    expect(isSmartGuideArmed()).toBe(true)
    expect(isSmartGuideOnboarded(8)).toBe(true)
  })

  it('moves a flat guide forward/backward and resets it at completion', () => {
    const store = useGuideStore.getState()
    store.startGuide('home')
    expect(useGuideStore.getState()).toMatchObject({ activeKey: 'home', stepIndex: 0, waiting: false })

    store.prev()
    expect(useGuideStore.getState().stepIndex).toBe(0)
    store.next()
    store.next()
    expect(useGuideStore.getState().stepIndex).toBe(2)
    store.prev()
    expect(useGuideStore.getState().stepIndex).toBe(1)
    store.next()
    store.next()
    store.next()

    expect(useGuideStore.getState()).toMatchObject({ activeKey: null, stepIndex: 0, stageKey: null, waiting: false })
  })

  it('shows each smart stage once, waits between stages, and fully resets on close', () => {
    const store = useGuideStore.getState()
    store.startGuide('smart')
    expect(useGuideStore.getState()).toMatchObject({ activeKey: 'smart', waiting: true, shownStages: {} })

    store.syncSmartStage('entry')
    expect(useGuideStore.getState()).toMatchObject({ stageKey: 'entry', stepIndex: 0, waiting: false })
    store.next()
    expect(useGuideStore.getState().waiting).toBe(true)

    store.syncSmartStage('entry')
    expect(useGuideStore.getState().waiting).toBe(true)
    store.syncSmartStage('process')
    expect(useGuideStore.getState()).toMatchObject({ stageKey: 'process', stepIndex: 0, waiting: false })
    store.next()
    expect(useGuideStore.getState().stepIndex).toBe(1)
    store.prev()
    expect(useGuideStore.getState().stepIndex).toBe(0)
    store.syncSmartStage('missing-stage')
    expect(useGuideStore.getState().waiting).toBe(true)

    store.close()
    expect(useGuideStore.getState()).toMatchObject({
      activeKey: null,
      stepIndex: 0,
      stageKey: null,
      waiting: false,
      shownStages: {},
    })
  })
})
