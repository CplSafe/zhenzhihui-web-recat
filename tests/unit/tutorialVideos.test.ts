import { describe, expect, it } from 'vitest'
import { getTutorialByKey, getTutorialForPath, MANUAL_DOC_URL, TUTORIAL_BASE_URL } from '@/utils/tutorialVideos'

describe('tutorialVideos', () => {
  it('创作页按前缀映射到对应教程，含带 id 的子路由和查询串', () => {
    expect(getTutorialForPath('/smart')?.key).toBe('smart-create')
    expect(getTutorialForPath('/smart/1188')?.key).toBe('smart-create')
    expect(getTutorialForPath('/real-person-video/3')?.key).toBe('smart-create')
    expect(getTutorialForPath('/hot-copy')?.key).toBe('hot-copy')
    expect(getTutorialForPath('/hot-copy/1200?x=1')?.key).toBe('hot-copy')
    expect(getTutorialForPath('/canvas')?.key).toBe('canvas')
    expect(getTutorialForPath('/canvas/118#a')?.key).toBe('canvas')
  })

  it('没有教程的页面返回 null，且前缀不做模糊匹配', () => {
    expect(getTutorialForPath('/home')).toBeNull()
    expect(getTutorialForPath('/projects')).toBeNull()
    expect(getTutorialForPath('/smartx')).toBeNull()
    expect(getTutorialForPath('')).toBeNull()
  })

  it('视频地址由基址 + key 组成', () => {
    const t = getTutorialByKey('canvas')
    expect(t.src).toBe(`${TUTORIAL_BASE_URL}canvas.mp4`)
    expect(t.title).toContain('无限画布')
  })

  it('每个教程都带上统一的图文手册地址', () => {
    expect(getTutorialByKey('smart-create').docUrl).toBe(MANUAL_DOC_URL)
    expect(getTutorialByKey('hot-copy').docUrl).toBe(MANUAL_DOC_URL)
    expect(typeof MANUAL_DOC_URL).toBe('string')
  })
})
