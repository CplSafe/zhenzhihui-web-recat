import { render, screen } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
vi.mock('@/components/common/TutorialButton', () => ({ default: () => null }))
import CanvasGlobalActions from '@/components/canvas/CanvasGlobalActions'
const base = {
  open: true,
  credits: 1,
  showExtras: false,
  canImportScript: false,
  canvasId: 76,
  workspaceId: 1,
  onToggle: vi.fn(),
  onClose: vi.fn(),
  onGuide: vi.fn(),
  onImportScript: vi.fn(),
}
it('only renders management actions when authorized callbacks are supplied', () => {
  const view = render(<CanvasGlobalActions {...base} />)
  expect(screen.queryByText('模型设置')).not.toBeInTheDocument()
  expect(screen.queryByText('创作成员')).not.toBeInTheDocument()
  expect(screen.queryByText('画布数据统计')).not.toBeInTheDocument()
  view.rerender(<CanvasGlobalActions {...base} onModels={vi.fn()} onMembers={vi.fn()} onStatistics={vi.fn()} />)
  expect(screen.getByText('模型设置')).toBeInTheDocument()
  expect(screen.getByText('创作成员')).toBeInTheDocument()
  expect(screen.getByText('画布数据统计')).toBeInTheDocument()
})
