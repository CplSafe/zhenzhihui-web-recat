import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFullscreenVideoSpaceToggle } from '@/utils/fullscreenVideoSpace'

function setFullscreenElement(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element })
}

function pressSpace(target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('全屏视频时空格只做播放 / 暂停', () => {
  let uninstall: () => void
  let video: HTMLVideoElement
  let paused: boolean

  beforeEach(() => {
    uninstall = installFullscreenVideoSpaceToggle()
    video = document.createElement('video')
    document.body.appendChild(video)
    paused = false
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused })
    vi.spyOn(video, 'pause').mockImplementation(() => {
      paused = true
    })
    vi.spyOn(video, 'play').mockImplementation(() => {
      paused = false
      return Promise.resolve()
    })
  })

  afterEach(() => {
    uninstall()
    setFullscreenElement(null)
    video.remove()
  })

  it('全屏时空格切换播放状态，并且不会触发焦点所在的关闭按钮', () => {
    const closeButton = document.createElement('button')
    const onClose = vi.fn()
    closeButton.addEventListener('keydown', onClose)
    document.body.appendChild(closeButton)
    setFullscreenElement(video)

    const event = pressSpace(closeButton)
    expect(event.defaultPrevented).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    expect(video.pause).toHaveBeenCalledTimes(1)

    pressSpace(closeButton)
    expect(video.play).toHaveBeenCalledTimes(1)
    closeButton.remove()
  })

  it('外层容器全屏时同样作用于里面的视频', () => {
    const wrapper = document.createElement('div')
    wrapper.appendChild(video)
    document.body.appendChild(wrapper)
    setFullscreenElement(wrapper)
    pressSpace()
    expect(video.pause).toHaveBeenCalledTimes(1)
    wrapper.remove()
  })

  it('不全屏时完全不接管空格', () => {
    setFullscreenElement(null)
    const event = pressSpace()
    expect(event.defaultPrevented).toBe(false)
    expect(video.pause).not.toHaveBeenCalled()
  })

  it('在输入框里打空格不受影响', () => {
    setFullscreenElement(video)
    const input = document.createElement('input')
    document.body.appendChild(input)
    const event = pressSpace(input)
    expect(event.defaultPrevented).toBe(false)
    expect(video.pause).not.toHaveBeenCalled()
    input.remove()
  })
})
