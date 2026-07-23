import { describe, expect, it } from 'vitest'
import { bindAssetUrlToWorkspace } from '@/utils/workspaceScopedUrl'

describe('bindAssetUrlToWorkspace', () => {
  it.each([
    ['/api/v1/assets/236/download?workspace_id=21', '/api/v1/assets/236/download?workspace_id=61'],
    ['/assets/236?workspace_id=21&size=small', '/assets/236?workspace_id=61&size=small'],
    ['/api/v1/assets/236/download', '/api/v1/assets/236/download?workspace_id=61'],
  ])('将头像素材 %s 绑定到当前工作空间', (input, expected) => {
    expect(bindAssetUrlToWorkspace(input, 61)).toBe(expected)
  })

  it('不修改非素材 CDN 地址', () => {
    const url = 'https://cdn.example.com/avatar.png?workspace_id=21'
    expect(bindAssetUrlToWorkspace(url, 61)).toBe(url)
  })
})
