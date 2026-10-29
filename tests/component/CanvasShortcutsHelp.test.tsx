import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CANVAS_MOD } from '@/utils/canvasKeyboard'
import CanvasShortcutsHelp from '@/components/canvas/CanvasShortcutsHelp'

describe('画布快捷键说明', () => {
  it('展示新操作并在关闭后恢复焦点', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const onClose = vi.fn()
    const { unmount } = render(<CanvasShortcutsHelp onClose={onClose} />)
    expect(screen.getByText('成组（至少选中两个节点）')).toBeInTheDocument()
    expect(screen.getByText('连线：选中两个节点，按选择顺序连接')).toBeInTheDocument()
    expect(screen.getByText(`${CANVAS_MOD} + L`)).toBeInTheDocument()
    expect(screen.getByText(`${CANVAS_MOD} + D`)).toBeInTheDocument()
    expect(screen.getByText('Tab')).toBeInTheDocument()
    expect(screen.getByText('L')).toBeInTheDocument()
    expect(screen.getByText('播放 / 暂停')).toBeInTheDocument()
    expect(screen.getByText('波纹删除并补齐空隙')).toBeInTheDocument()
    expect(screen.getByText('复制节点和连线')).toBeInTheDocument()
    expect(screen.getByText('适应画布：显示全部节点')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})
