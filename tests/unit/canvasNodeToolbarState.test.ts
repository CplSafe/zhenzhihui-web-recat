import { describe, expect, it } from 'vitest'
import { resolveNodeToolbarState } from '@/views/CanvasView'

const WS = 7

describe('resolveNodeToolbarState', () => {
  it('把只有 assetId 的节点视为有素材', () => {
    /*
     * 回归：早先只看 data.resultUrl 判断有无素材。云端拉回来的节点大多只有 assetId，
     * resultUrl 为空，于是被判成空节点——工具条上的「下载」和「截帧」直接不出现。
     */
    const state = resolveNodeToolbarState({ kind: 'video', assetId: 42 }, WS)
    expect(state.hasContent).toBe(true)
  })

  it('blob: 地址配合 assetId 同样算有素材', () => {
    // blob: 是会话级地址，刷新即失效，真正可用的是 assetId 解析出的同源地址
    const state = resolveNodeToolbarState({ kind: 'image', resultUrl: 'blob:whatever', assetId: 9 }, WS)
    expect(state.hasContent).toBe(true)
  })

  it('本地上传中的预览图也算有素材', () => {
    const state = resolveNodeToolbarState({ kind: 'image', previewUrl: 'blob:preview', uploading: true }, WS)
    expect(state.hasContent).toBe(true)
    expect(state.uploading).toBe(true)
  })

  it('直链 resultUrl 照常识别', () => {
    expect(resolveNodeToolbarState({ kind: 'video', resultUrl: 'https://cdn/x.mp4' }, WS).hasContent).toBe(true)
  })

  it('空的图片/视频节点没有素材', () => {
    expect(resolveNodeToolbarState({ kind: 'video' }, WS).hasContent).toBe(false)
    expect(resolveNodeToolbarState({ kind: 'image' }, WS).hasContent).toBe(false)
  })

  it('文本与时间线节点不参与上传/下载判断', () => {
    expect(resolveNodeToolbarState({ kind: 'text', resultUrl: 'https://cdn/x.png' }, WS).hasContent).toBe(false)
    expect(resolveNodeToolbarState({ kind: 'timeline', assetId: 3 }, WS).hasContent).toBe(false)
  })

  it('缺省 data 时退回文本节点，不抛错', () => {
    expect(resolveNodeToolbarState(undefined, WS)).toEqual({ kind: 'text', hasContent: false, uploading: false })
  })
})
