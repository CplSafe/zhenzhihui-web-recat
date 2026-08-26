import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import StudioResultFeed from '@/components/studio/StudioResultFeed/StudioResultFeed'
import type { StudioResultBatch } from '@/components/studio/StudioResultFeed/StudioResultFeed'

function batch(overrides: Partial<StudioResultBatch> = {}): StudioResultBatch {
  return {
    id: 'batch-1',
    mode: 'video',
    prompt: '一只在屋顶散步的猫',
    summary: '1080p · 5s · 16:9',
    createdAt: Date.parse('2026-08-26T10:00:00Z'),
    items: [{ id: 'item-1', status: 'pending' }],
    ...overrides,
  }
}

/** 渲染结果流，默认给足历史流相关的 props。 */
function renderFeed(props: Partial<React.ComponentProps<typeof StudioResultFeed>> = {}) {
  return render(<StudioResultFeed batches={[batch()]} filter="all" onFilterChange={vi.fn()} {...props} />)
}

describe('StudioResultFeed 固定比例', () => {
  it('按批次比例给格子定形，生成中阶段就占好位', () => {
    // 比例必须在 pending 阶段就生效，否则出图瞬间会撑开布局造成跳变。
    const { container } = renderFeed({ batches: [batch({ ratio: '9:16' })] })
    const items = container.querySelector('[class*="items"]') as HTMLElement
    expect(items.style.getPropertyValue('--frame-ratio')).toBe('9 / 16')
  })

  it('比例缺失时兜底为正方形，格子仍有确定形状', () => {
    const { container } = renderFeed({ batches: [batch({ ratio: '' })] })
    const items = container.querySelector('[class*="items"]') as HTMLElement
    expect(items.style.getPropertyValue('--frame-ratio')).toBe('1 / 1')
  })

  it('同一批次的所有产物共用一个比例', () => {
    const { container } = renderFeed({
      batches: [
        batch({
          ratio: '16:9',
          items: [
            { id: 'a', status: 'done', url: '/a.mp4' },
            { id: 'b', status: 'pending' },
          ],
        }),
      ],
    })
    const items = container.querySelector('[class*="items"]') as HTMLElement
    expect(items.style.getPropertyValue('--frame-ratio')).toBe('16 / 9')
    expect(items.children).toHaveLength(2)
  })
})

describe('StudioResultFeed 历史流', () => {
  it('聊天式排列：按传入顺序渲染，旧在上新在下', () => {
    const { container } = renderFeed({
      batches: [batch({ id: 'old', prompt: '较早的创作' }), batch({ id: 'new', prompt: '最新的创作' })],
    })
    const articles = Array.from(container.querySelectorAll('article'))
    expect(articles[0].textContent).toContain('较早的创作')
    expect(articles[1].textContent).toContain('最新的创作')
  })

  it('首屏加载时展示加载态而不是空态', () => {
    // 空态会让用户误以为历史丢了，加载中必须说明正在取。
    renderFeed({ batches: [], loading: true })
    expect(screen.getByText('加载创作记录…')).toBeTruthy()
    expect(screen.queryByText('还没有创作记录')).toBeNull()
  })

  it('确实没有记录时才显示空态', () => {
    renderFeed({ batches: [], loading: false })
    expect(screen.getByText('还没有创作记录')).toBeTruthy()
  })

  it('加载更早历史时给出提示', () => {
    renderFeed({ loadingMore: true, hasMore: true })
    expect(screen.getByText('加载更早的创作…')).toBeTruthy()
  })

  it('到底后提示没有更早的创作', () => {
    renderFeed({ hasMore: false })
    expect(screen.getByText('没有更早的创作了')).toBeTruthy()
  })

  it('还有更多时不显示到底提示', () => {
    renderFeed({ hasMore: true })
    expect(screen.queryByText('没有更早的创作了')).toBeNull()
  })

  it('每条批次带锚点 id，供点击通知后定位', () => {
    const { container } = renderFeed({ batches: [batch({ id: 'batch-42' })] })
    expect(container.querySelector('#studio-batch-batch-42')).toBeTruthy()
  })

  it('按类型筛选只保留对应模式的批次', () => {
    renderFeed({
      filter: 'image',
      batches: [
        batch({ id: 'v', mode: 'video', prompt: '视频批次' }),
        batch({ id: 'i', mode: 'image', prompt: '图片批次' }),
      ],
    })
    expect(screen.getByText('图片批次')).toBeTruthy()
    expect(screen.queryByText('视频批次')).toBeNull()
  })
})

describe('StudioResultFeed 产物状态', () => {
  it('失败产物展示具体原因', () => {
    renderFeed({ batches: [batch({ items: [{ id: 'x', status: 'failed', error: '内容审核未通过' }] })] })
    expect(screen.getByText('内容审核未通过')).toBeTruthy()
  })

  it('完成的视频渲染播放器', () => {
    const { container } = renderFeed({
      batches: [batch({ mode: 'video', items: [{ id: 'x', status: 'done', url: '/out.mp4' }] })],
    })
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/out.mp4')
  })

  it('完成的图片可点击预览', () => {
    const onPreview = vi.fn()
    const { container } = renderFeed({
      batches: [batch({ mode: 'image', items: [{ id: 'x', status: 'done', url: '/out.png' }] })],
      filter: 'all',
      onPreview,
    })
    const image = container.querySelector('img') as HTMLImageElement
    image.click()
    expect(onPreview).toHaveBeenCalledTimes(1)
  })

  it('有真实进度时渲染进度条', () => {
    const { container } = renderFeed({ batches: [batch({ items: [{ id: 'x', status: 'pending', progress: 40 }] })] })
    const fill = container.querySelector('[class*="progressFill"]') as HTMLElement
    expect(fill.style.width).toBe('40%')
  })

  it('进度越界时收敛到 0~100', () => {
    const { container } = renderFeed({ batches: [batch({ items: [{ id: 'x', status: 'pending', progress: 140 }] })] })
    const fill = container.querySelector('[class*="progressFill"]') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('批次头展示参数摘要与分镜数', () => {
    const { container } = renderFeed({ batches: [batch({ shotCount: 3 })] })
    const article = container.querySelector('article') as HTMLElement
    expect(within(article).getByText(/1080p · 5s · 16:9/)).toBeTruthy()
    expect(article.textContent).toContain('3 镜')
  })
})
