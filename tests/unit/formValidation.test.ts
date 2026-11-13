import { describe, expect, it } from 'vitest'
import { isValidMobile, isValidOptionalHttpUrl } from '@/utils/formValidation'

describe('表单联系方式校验', () => {
  it.each(['13800000000', ' 19912345678 '])('接受手机号 %s', (value) => {
    expect(isValidMobile(value)).toBe(true)
  })
  it.each(['', '水电费收到', '12345678901', '1380000000', '138000000000', '138-0000-0000'])(
    '拒绝手机号 %s',
    (value) => {
      expect(isValidMobile(value)).toBe(false)
    },
  )
  it.each(['', '  ', 'https://example.com/video', 'http://example.com'])('接受选填链接 %s', (value) => {
    expect(isValidOptionalHttpUrl(value)).toBe(true)
  })
  it.each(['not-a-url', 'example.com', 'ftp://example.com', 'https://', 'https://example.com/a b'])(
    '拒绝链接 %s',
    (value) => {
      expect(isValidOptionalHttpUrl(value)).toBe(false)
    },
  )
})
