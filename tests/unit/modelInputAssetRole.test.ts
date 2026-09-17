import { describe, expect, it } from 'vitest'
import { resolveModelInputAssetRole, resolveModelInputAssetRoleSafe } from '@/utils/modelInputAssetRole'

describe('operation-aware image asset roles', () => {
  it('uses reference_image for image editing without changing legacy video callers', () => {
    expect(resolveModelInputAssetRole({})).toBe('image')
    expect(resolveModelInputAssetRole({}, 'video.generate')).toBe('image')
    expect(resolveModelInputAssetRole({}, 'image.image_to_image')).toBe('reference_image')
  })

  it('uses the current operation whitelist before a conflicting generic schema role', () => {
    const model = {
      params_schema: { fields: [{ name: 'input_asset_role', default: 'image' }] },
      input_constraints: {
        'image.image_to_image': { roles: [{ role: 'mask' }, { role: 'reference_image' }] },
        'video.generate': { roles: [{ role: 'image' }] },
      },
    }
    expect(resolveModelInputAssetRole(model, 'image.image_to_image')).toBe('reference_image')
    expect(resolveModelInputAssetRole(model, 'video.generate')).toBe('image')
    expect(
      resolveModelInputAssetRole(
        { input_constraints: { 'image.image_to_image': { roles: [{ role: 'image' }] } } },
        'image.image_to_image',
      ),
    ).toBe('image')
  })

  it('keeps explicit schema roles and operation-specific rendering fallback', () => {
    const explicit = { params_schema: { fields: [{ name: 'input_asset_role', default: 'reference_image' }] } }
    expect(resolveModelInputAssetRole(explicit, 'video.generate')).toBe('reference_image')
    const ambiguous = {
      params_schema: { fields: [{ name: 'input_asset_role', required: true, options: ['first_frame', 'last_frame'] }] },
    }
    expect(() => resolveModelInputAssetRole(ambiguous)).toThrow()
    expect(resolveModelInputAssetRoleSafe(ambiguous)).toBe('image')
    expect(resolveModelInputAssetRoleSafe(ambiguous, 'image.image_to_image')).toBe('reference_image')
  })
})
