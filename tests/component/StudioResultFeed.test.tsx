import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import StudioResultFeed, { type StudioResultBatch } from '@/components/studio/StudioResultFeed/StudioResultFeed'

function batch(overrides: Partial<StudioResultBatch> = {}): StudioResultBatch {
  return {
    id: 'b1',
    mode: 'video',
    prompt: '一只猫在窗台晒太阳',
    summary: '720p · 5s · 16:9 · 1 条',
    createdAt: 1_700_000_000_000,
    ratio: '16:9',
    items: [{ id: 'i1', status: 'pending' }],
    ...overrides,
  }
}

describe('StudioResultFeed 生成中', () => {
  it('生成中给出可感知的状态文案而不是空白卡片', () => {
    render(<StudioResultFeed batches={[batch()]} filter="all" onFilterChange={() => {}} />)

    expect(screen.getByText('视频生成中…')).toBeInTheDocument()
    // 读屏用户也要能感知进度变化
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('图片模式的文案与视频区分', () => {
    render(
      <StudioResultFeed
        batches={[batch({ mode: 'image', items: [{ id: 'i1', status: 'pending' }] })]}
        filter="all"
        onFilterChange={() => {}}
      />,
    )
    expect(screen.getByText('图片生成中…')).toBeInTheDocument()
  })

  it('有真实进度时展示百分比', () => {
    render(
      <StudioResultFeed
        batches={[batch({ items: [{ id: 'i1', status: 'pending', progress: 42 }] })]}
        filter="all"
        onFilterChange={() => {}}
      />,
    )
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('进度越界时收敛到 0~100，不出现 -5% 或 130%', () => {
    render(
      <StudioResultFeed
        batches={[
          batch({
            items: [
              { id: 'i1', status: 'pending', progress: 130 },
              { id: 'i2', status: 'pending', progress: -5 },
            ],
          }),
        ]}
        filter="all"
        onFilterChange={() => {}}
      />,
    )
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('后端没给进度时只显示文案，不编造百分比', () => {
    render(<StudioResultFeed batches={[batch()]} filter="all" onFilterChange={() => {}} />)
    expect(screen.queryByText(/%$/)).toBeNull()
  })

  it('完成后渲染成片并移除生成中状态', () => {
    render(
      <StudioResultFeed
        batches={[batch({ items: [{ id: 'i1', status: 'done', url: 'https://cdn.example.com/a.mp4' }] })]}
        filter="all"
        onFilterChange={() => {}}
      />,
    )
    expect(screen.queryByText('视频生成中…')).toBeNull()
    // 成片右上角带全站统一的 AI 来源标识（图标 + aria-label，非纯文本）
    expect(screen.getByLabelText('AI 生成')).toBeInTheDocument()
  })

  it('失败时给出原因', () => {
    render(
      <StudioResultFeed
        batches={[batch({ items: [{ id: 'i1', status: 'failed', error: '积分不足' }] })]}
        filter="all"
        onFilterChange={() => {}}
      />,
    )
    expect(screen.getByText('积分不足')).toBeInTheDocument()
  })

  it('空态提示用户从左侧开始', () => {
    render(<StudioResultFeed batches={[]} filter="all" onFilterChange={() => {}} />)
    expect(screen.getByText('还没有创作记录')).toBeInTheDocument()
  })
})
