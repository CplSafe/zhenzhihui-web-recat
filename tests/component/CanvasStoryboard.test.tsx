import { useState } from 'react'
import { ConfigProvider } from 'antd'
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CanvasStoryboard from '@/components/canvas/CanvasStoryboard'
import type { CanvasStoryboardItem } from '@/utils/canvasStructuredText'

const initial: CanvasStoryboardItem[] = [
  { title: '开场', prompt: '清晨的客厅', shot: '缓慢推进', duration: '4' },
  { title: '结尾', prompt: '温暖的灯光', duration: '5' },
]
function Editor({ disabled = false }: { disabled?: boolean }) {
  const [items, setItems] = useState(initial)
  return <CanvasStoryboard items={items} disabled={disabled} onChange={setItems} />
}

describe('画布分镜阅读和展开编辑', () => {
  it('长镜头可单独展开、收起，卡片内编辑不丢失其他镜头', () => {
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(600)
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <Editor />
      </ConfigProvider>,
    )
    const expand = screen.getAllByRole('button', { name: '展开本镜头' })[0]
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: '收起本镜头' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(screen.getByRole('textbox', { name: '镜头 1 提示词' }), { target: { value: '卡片内直接修改' } })
    expect(screen.getByRole('textbox', { name: '镜头 2 提示词' })).toHaveValue('温暖的灯光')
    fireEvent.click(screen.getByRole('button', { name: '收起本镜头' }))
    expect(screen.getByRole('textbox', { name: '镜头 1 提示词' })).toHaveValue('卡片内直接修改')
  })
  it('卡片和展开窗口共用编辑内容，关闭后保留修改', async () => {
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <Editor />
      </ConfigProvider>,
    )
    expect(screen.getByText('缓慢推进 · 4 秒')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '展开查看' }))
    const modal = await screen.findByRole('dialog', { name: '分镜脚本 · 2 个镜头' }, { timeout: 10000 })
    await waitFor(() => expect(modal).toBeVisible())
    const scroll = vi.fn()
    within(modal).getByRole('textbox', { name: '镜头 2 提示词' }).closest('article')!.parentElement!.scrollIntoView =
      scroll
    fireEvent.click(within(modal).getByRole('button', { name: '02 · 结尾' }))
    expect(within(modal).getByRole('textbox', { name: '镜头 2 提示词' })).toHaveFocus()
    expect(scroll).toHaveBeenCalled()
    fireEvent.change(within(modal).getByRole('textbox', { name: '镜头 1 提示词' }), {
      target: { value: '更新后的开场画面' },
    })
    expect(within(modal).getByRole('textbox', { name: '镜头 2 提示词' })).toHaveValue('温暖的灯光')
    fireEvent.click(within(modal).getByRole('button', { name: '完成' }))
    expect(screen.getByRole('textbox', { name: '镜头 1 提示词' })).toHaveValue('更新后的开场画面')
    fireEvent.click(screen.getByRole('button', { name: '展开查看' }))
    const reopened = await screen.findByRole('dialog', { name: '分镜脚本 · 2 个镜头' })
    expect(within(reopened).getByRole('textbox', { name: '镜头 1 提示词' })).toHaveValue('更新后的开场画面')
  })

  it('任务运行期间允许阅读和展开，但禁止修改提示词', async () => {
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <Editor disabled />
      </ConfigProvider>,
    )
    expect(screen.getByRole('textbox', { name: '镜头 1 提示词' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '展开查看' }))
    const modal = await screen.findByRole('dialog', { name: '分镜脚本 · 2 个镜头' }, { timeout: 10000 })
    await waitFor(() => expect(modal).toBeVisible())
    expect(within(modal).getByRole('textbox', { name: '镜头 1 提示词' })).toBeDisabled()
    expect(within(modal).getByRole('navigation', { name: '镜头目录' })).toBeVisible()
  })
})
