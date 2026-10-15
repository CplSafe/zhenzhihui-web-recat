import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
    expect(screen.getByText('L')).toBeInTheDocument()
    expect(screen.getByText('Shift + D')).toBeInTheDocument()
    expect(screen.getByText('N')).toBeInTheDocument()
    expect(screen.queryByText('Tab')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})
