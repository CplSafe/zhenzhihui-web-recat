import { beforeEach, describe, expect, it } from 'vitest'
import { readVoiceLibrary, removeVoiceSample, renameVoiceSample, saveVoiceSample } from '@/utils/voiceLibrary'

describe('本机声音样本库', () => {
  beforeEach(() => localStorage.clear())
  it('按账号和空间隔离，重命名不重复，移除不影响其他样本', () => {
    saveVoiceSample('u1', 21, 1, '旁白')
    saveVoiceSample('u1', 21, 2, '角色')
    saveVoiceSample('u1', 21, 1, '新名称')
    expect(readVoiceLibrary('u1', 21)).toHaveLength(2)
    expect(readVoiceLibrary('u1', 21).find((item) => item.assetId === 1)?.title).toBe('新名称')
    expect(readVoiceLibrary('u2', 21)).toEqual([])
    expect(readVoiceLibrary('u1', 22)).toEqual([])
    removeVoiceSample('u1', 21, 1)
    expect(readVoiceLibrary('u1', 21).map((item) => item.assetId)).toEqual([2])
  })
  it('不持久化播放地址，拦截缺少身份和无效素材', () => {
    expect(() => saveVoiceSample('', 21, 1, '样本')).toThrow('登录')
    expect(() => saveVoiceSample('u', 0, 1, '样本')).toThrow('工作空间')
    expect(() => saveVoiceSample('u', 21, -1, '样本')).toThrow('尚未入库')
    saveVoiceSample('u', 21, 1, '样本')
    expect(Object.keys(readVoiceLibrary('u', 21)[0])).toEqual(['assetId', 'title', 'lastUsedAt'])
  })
  it('损坏存储安全回退，限制收藏数量', () => {
    localStorage.setItem('zzh:voice-samples:u:21', '{"bad":true}')
    expect(readVoiceLibrary('u', 21)).toEqual([])
    for (let id = 1; id <= 105; id++) saveVoiceSample('u', 21, id, '')
    expect(readVoiceLibrary('u', 21)).toHaveLength(100)
  })
  it('重命名保留最近使用时间，不把未使用的样本置顶', () => {
    saveVoiceSample('u', 21, 1, '原名称')
    const timestamp = readVoiceLibrary('u', 21)[0].lastUsedAt
    renameVoiceSample('u', 21, 1, '新名称')
    expect(readVoiceLibrary('u', 21)[0]).toMatchObject({ title: '新名称', lastUsedAt: timestamp })
    expect(() => renameVoiceSample('u', 21, 99, '不存在')).toThrow('不存在')
  })
})
