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

describe('StudioResultFeed 固定比例', () => {
  it('按批次比例给格子定形，生成中阶段就占好位', () => {
    // 比例必须在 pending 阶段就生效，否则出图瞬间会撑开布局造成跳变。
    const { container } = render(
      <StudioResultFeed batches={[batch({ ratio: '9:16' })]} filter="all" onFilterChange={() => {}} />,
    )
    const item = container.querySelector('[class*="items"] > div') as HTMLElement
    expect(item.style.getPropertyValue('--studio-item-ratio')).toBe('9 / 16')
  })

  it('兼容全角冒号与斜杠写法的比例', () => {
    // 历史任务回放的比例可能来自不同模型，写法并不统一。
    const { container } = render(
      <StudioResultFeed batches={[batch({ ratio: '16：9' })]} filter="all" onFilterChange={() => {}} />,
    )
    const item = container.querySelector('[class*="items"] > div') as HTMLElement
    expect(item.style.getPropertyValue('--studio-item-ratio')).toBe('16 / 9')
  })

  it('比例非法时不注入变量，交给样式兜底为正方形', () => {
    const { container } = render(
      <StudioResultFeed batches={[batch({ ratio: '乱码' })]} filter="all" onFilterChange={() => {}} />,
    )
    const item = container.querySelector('[class*="items"] > div') as HTMLElement
    expect(item.style.getPropertyValue('--studio-item-ratio')).toBe('')
  })
})

describe('StudioResultFeed 历史流', () => {
  it('聊天式排列：按传入顺序渲染，旧在上新在下', () => {
    const { container } = render(
      <StudioResultFeed
        batches={[batch({ id: 'old', prompt: '较早的创作' }), batch({ id: 'new', prompt: '最新的创作' })]}
        filter="all"
        onFilterChange={() => {}}
      />,
    )
    const articles = Array.from(container.querySelectorAll('article'))
    expect(articles[0].textContent).toContain('较早的创作')
    expect(articles[1].textContent).toContain('最新的创作')
  })

  it('首屏加载时展示加载态而不是空态', () => {
    // 空态会让用户误以为历史丢了，加载中必须说明正在取。
    render(<StudioResultFeed batches={[]} filter="all" onFilterChange={() => {}} loading />)
    expect(screen.getByText('加载创作记录…')).toBeInTheDocument()
    expect(screen.queryByText('还没有创作记录')).toBeNull()
  })

  it('加载更早历史时给出提示', () => {
    render(<StudioResultFeed batches={[batch()]} filter="all" onFilterChange={() => {}} loadingMore hasMore />)
    expect(screen.getByText('加载更早的创作…')).toBeInTheDocument()
  })

  it('到底后提示没有更早的创作', () => {
    render(<StudioResultFeed batches={[batch()]} filter="all" onFilterChange={() => {}} />)
    expect(screen.getByText('没有更早的创作了')).toBeInTheDocument()
  })

  it('还有更多时不显示到底提示', () => {
    render(<StudioResultFeed batches={[batch()]} filter="all" onFilterChange={() => {}} hasMore />)
    expect(screen.queryByText('没有更早的创作了')).toBeNull()
  })

  it('每条批次带锚点 id，供点击通知后定位', () => {
    const { container } = render(
      <StudioResultFeed batches={[batch({ id: 'batch-42' })]} filter="all" onFilterChange={() => {}} />,
    )
    expect(container.querySelector('#studio-batch-batch-42')).toBeTruthy()
  })

  it('按类型筛选只保留对应模式的批次', () => {
    render(
      <StudioResultFeed
        batches={[
          batch({ id: 'v', mode: 'video', prompt: '视频批次' }),
          batch({ id: 'i', mode: 'image', prompt: '图片批次' }),
        ]}
        filter="image"
        onFilterChange={() => {}}
      />,
    )
    expect(screen.getByText('图片批次')).toBeInTheDocument()
    expect(screen.queryByText('视频批次')).toBeNull()
  })
})
