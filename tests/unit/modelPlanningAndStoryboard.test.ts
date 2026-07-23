import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_PLAN_CANDIDATES,
  buildModelPlanCandidatesFromBillingPlans,
  buildModelPlanCandidatesFromSession,
  normalizeModelPlanCandidate,
  normalizePlanCandidates,
} from '@/utils/modelPlans'
import { MODEL_NOT_FOUND_CODE, chooseModelCandidate, isRetryableModelSelectionError } from '@/utils/modelSelection'
import { buildStoryboardImageParams } from '@/utils/storyboardTasks'

describe('model plan candidates', () => {
  it.each([
    [null, []],
    ['', []],
    ['Enterprise Annual', ['enterprise']],
    ['团队专业版', ['team']],
    ['Professional', ['pro']],
    ['Starter', ['free']],
    ['Custom_Plan', ['custom_plan']],
    [{ code: 'PRO' }, ['pro']],
    [
      [{ name: '团队版' }, 'free'],
      ['team', 'free'],
    ],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeModelPlanCandidate(input)).toEqual(expected)
  })

  it('deduplicates candidates and appends a unique fallback', () => {
    expect(normalizePlanCandidates(['PRO', 'pro', 'team'], ['free', 'team'])).toEqual(['pro', 'team', 'free'])
    expect(normalizePlanCandidates([], ['starter'])).toEqual(['starter'])
    expect(normalizePlanCandidates(undefined)).toEqual(DEFAULT_MODEL_PLAN_CANDIDATES)
  })

  it('collects plan shapes from session, workspace and member', () => {
    expect(
      buildModelPlanCandidatesFromSession(
        {
          plan_code: 'pro-monthly',
          subscription: { plan: { code: 'enterprise' } },
          activeSubscription: { plan_code: 'starter' },
        },
        { subscription: { plan_code: 'team-yearly' } },
        { plan: 'custom-member' },
      ),
    ).toEqual(['pro', 'enterprise', 'free', 'team', 'custom-member'])
  })

  it('falls back to workspace and member embedded in the session', () => {
    expect(
      buildModelPlanCandidatesFromSession(
        {
          workspaces: [{ plan: 'team' }],
          currentMember: { plan_code: 'pro' },
        },
        undefined,
        undefined,
      ),
    ).toEqual(['team', 'pro', 'free'])
  })

  it('normalizes backend billing-plan variants', () => {
    expect(
      buildModelPlanCandidatesFromBillingPlans([
        { code: 'PRO' },
        { plan_code: 'team' },
        { planCode: 'enterprise' },
        { name: 'Starter' },
      ]),
    ).toEqual(['pro', 'team', 'enterprise', 'free'])
    expect(buildModelPlanCandidatesFromBillingPlans(null as never)).toEqual(['free'])
  })
})

describe('model selection', () => {
  const models = [
    {
      id: 1,
      enabled: false,
      provider: 'disabled-provider',
      operation_codes: ['video.generate'],
    },
    {
      id: 2,
      enabled: true,
      provider: 'ByteDance',
      model: 'seedance-pro',
      operation_codes: ['video.generate'],
    },
    {
      id: 3,
      enabled: true,
      display_name: 'HappyHorse Edit',
      operation_codes: ['video.edit'],
    },
  ]

  it('filters by operation and preferred keyword', () => {
    expect(
      chooseModelCandidate(models, { operationCode: 'video.generate', preferredKeywords: ['seedance'] }),
    ).toMatchObject({ id: 2 })
    expect(chooseModelCandidate(models, { operationCode: 'video.edit', preferredKeywords: ['horse'] })).toMatchObject({
      id: 3,
    })
  })

  it('does not silently fall back when an explicit preferred model is unavailable', () => {
    expect(chooseModelCandidate(models, { operationCode: 'video.generate', preferredKeywords: ['missing'] })).toBeNull()
  })

  it('falls back only among enabled and operation-compatible models', () => {
    expect(chooseModelCandidate(models, { operationCode: 'video.generate' })).toMatchObject({ id: 2 })
    expect(chooseModelCandidate(models, { operationCode: 'audio.generate' })).toBeNull()
    expect(chooseModelCandidate(models)).toMatchObject({ id: 2 })
    expect(chooseModelCandidate([{ id: 9, enabled: false }])).toMatchObject({ id: 9 })
    expect(chooseModelCandidate(null)).toBeNull()
  })

  it.each([
    [{ code: MODEL_NOT_FOUND_CODE }, true],
    [{ code: 'MODEL_NOT_ALLOWED_BY_PLAN' }, true],
    [{ message: 'Model is not included in current plan' }, true],
    [{ message: 'Not available without an active subscription' }, true],
    [{ code: 'VALIDATION_ERROR', message: 'bad params' }, false],
    [null, false],
  ])('classifies retryable selection error %p as %p', (error, expected) => {
    expect(isRetryableModelSelectionError(error)).toBe(expected)
  })
})

describe('storyboard image parameters', () => {
  it('uses safe defaults without a provider schema', () => {
    expect(buildStoryboardImageParams({}, '16:9')).toEqual({ ratio: '16:9', quality: 'low', count: 1 })
    expect(buildStoryboardImageParams({}, 'unsupported')).toEqual({ ratio: '9:16', quality: 'low', count: 1 })
  })

  it('only sends fields declared by the model', () => {
    const model = {
      params_schema: {
        fields: [
          { name: 'aspectRatio', options: ['4:5', '16:9'] },
          { name: 'quality' },
          { name: 'size', options: ['1K', '2K'] },
          { name: 'count' },
          { name: 'watermark' },
        ],
      },
    }
    expect(buildStoryboardImageParams(model, '4:5')).toEqual({
      aspectRatio: '4:5',
      quality: 'low',
      size: '2K',
      count: 1,
      watermark: false,
    })
  })

  it.each([
    ['9:16', ['16:9', '3:4'], '3:4'],
    ['1:1', ['landscape_16_9', 'square'], 'square'],
    ['9:16', ['landscape_16_9', 'portrait_16_9'], 'portrait_16_9'],
    ['4:3', ['1024x768', '768×1024'], '1024x768'],
    ['invalid', ['4:5', '16:9'], '4:5'],
  ])('snaps requested ratio %s within %p to %s', (requested, options, expected) => {
    expect(buildStoryboardImageParams({ paramsSchema: { fields: [{ name: 'ratio', options }] } }, requested)).toEqual({
      ratio: expected,
    })
  })

  it('uses a ratio-like size option when 2K is unavailable', () => {
    expect(
      buildStoryboardImageParams(
        { params_schema: { fields: [{ name: 'size', options: ['1024x1024', '1920x1080'] }] } },
        '16:9',
      ),
    ).toEqual({ size: '1920x1080' })
  })

  it('uses 2K when a size field has no options and omits invalid source fields', () => {
    expect(
      buildStoryboardImageParams(
        { params_schema: JSON.stringify({ fields: [{ name: 'size' }, { name: 'unknown' }] }) },
        '9:16',
      ),
    ).toEqual({ size: '2K' })
  })
})
