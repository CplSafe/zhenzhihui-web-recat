import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyUserProfileOverrides, bustUserAvatarCache, saveUserAvatarOverride } from '@/utils/profileOverrides'

describe('profileOverrides', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('adds a cache version to normal avatar URLs but preserves signed URLs', () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345)

    expect(bustUserAvatarCache('/api/v1/me/avatar')).toBe('/api/v1/me/avatar?_profile_v=12345')
    expect(bustUserAvatarCache('https://cdn.example.com/avatar.png?X-Amz-Signature=secret')).toBe(
      'https://cdn.example.com/avatar.png?X-Amz-Signature=secret',
    )
  })

  it('keeps the refreshed local URL while the backend still returns the same avatar resource', () => {
    const user = { id: 7, avatar: '/avatars/7.png' }
    saveUserAvatarOverride(user, '/avatars/7.png?_profile_v=12345')

    expect(applyUserProfileOverrides(user)).toMatchObject({
      avatar: '/avatars/7.png?_profile_v=12345',
      avatar_url: '/avatars/7.png?_profile_v=12345',
      avatarUrl: '/avatars/7.png?_profile_v=12345',
    })
  })

  it('uses a genuinely newer backend avatar instead of a stale local override', () => {
    saveUserAvatarOverride({ id: 7 }, '/avatars/old.png?_profile_v=1')

    expect(applyUserProfileOverrides({ id: 7, avatar: '/avatars/new.png' })).toMatchObject({
      avatar: '/avatars/new.png',
    })
  })
})
