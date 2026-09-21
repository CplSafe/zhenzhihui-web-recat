import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import TutorialButton from '@/components/common/TutorialButton'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TutorialButton />
    </MemoryRouter>,
  )
}

describe('TutorialButton', () => {
  it('没有教程的页面不渲染按钮', () => {
    renderAt('/home')
    expect(screen.queryByRole('button', { name: /操作手册/ })).toBeNull()
  })

  it('创作页显示按钮，点击弹出该页面的视频，Esc 关闭', () => {
    renderAt('/hot-copy/1200')
    const btn = screen.getByRole('button', { name: /操作手册/ })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)

    const dialog = screen.getByRole('dialog', { name: '爆款复刻 · 操作手册' })
    expect(dialog).toBeInTheDocument()
    const video = screen.getByTestId('tutorial-video') as HTMLVideoElement
    expect(video.getAttribute('src')).toBe('/tutorials/hot-copy.mp4')
    expect(btn).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('点击遮罩关闭，点击弹窗内部不关闭', () => {
    renderAt('/canvas/1')
    fireEvent.click(screen.getByRole('button', { name: /操作手册/ }))
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('tutorial-modal-mask'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
