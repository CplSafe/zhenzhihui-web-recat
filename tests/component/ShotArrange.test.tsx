import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Shot } from '@/components/smart/ScriptStoryboardTable'

vi.mock('@/components/smart/ShotList', () => ({
  default: (props: any) => (
    <section aria-label="分镜列表测试替身">
      <output aria-label="当前选中镜头">{String(props.selectedId ?? '')}</output>
      <button type="button" onClick={() => props.onSelect(props.shots[1]?.id)} disabled={!props.shots[1]}>
        选择第二镜头
      </button>
      <button type="button" onClick={() => props.onEditShot(props.shots[0])} disabled={!props.shots[0]}>
        编辑第一镜头
      </button>
      <button type="button" onClick={() => props.onInsertShot(props.shots.length)}>
        末尾插入镜头
      </button>
      <button
        type="button"
        onClick={() => props.onShotsChange(props.shots.filter((shot: Shot) => shot.id !== props.selectedId))}
        disabled={props.selectedId == null}
      >
        删除选中镜头
      </button>
      <button type="button" onClick={() => props.onPreview('https://cdn.example.com/preview.png')}>
        预览镜头
      </button>
    </section>
  ),
}))

vi.mock('@/components/smart/ShotEditPanel', () => ({
  default: (props: any) => (
    <section aria-label="镜头编辑面板测试替身">
      <output aria-label="编辑中的镜头">{String(props.shot.id)}</output>
      <output aria-label="镜头生成状态">{props.regenerating ? '生成中' : '空闲'}</output>
      <button type="button" onClick={() => props.onPatch({ line: `已修改-${props.shot.id}` })}>
        提交字段修改
      </button>
      <button
        type="button"
        onClick={() => void props.onPolishText?.('line', props.shot.line || '')}
        disabled={!props.onPolishText}
      >
        调用文本润色
      </button>
    </section>
  ),
}))

vi.mock('@/components/smart/ShotEditDialog', () => ({
  default: (props: any) =>
    props.open ? (
      <section aria-label="分镜编辑弹窗测试替身">
        <output aria-label="弹窗模式">{props.mode}</output>
        <button
          type="button"
          onClick={() => void props.onUpload?.(new File(['image'], 'reference.png', { type: 'image/png' }))}
          disabled={!props.onUpload}
        >
          上传参考图
        </button>
        <button
          type="button"
          onClick={() => void props.onPolish?.('原始描述', ['https://cdn.example.com/reference.png'])}
          disabled={!props.onPolish}
        >
          润色描述
        </button>
        <button
          type="button"
          onClick={() => void props.onGenerate('新描述', ['https://cdn.example.com/reference.png'])}
        >
          生成分镜
        </button>
        <button type="button" onClick={props.onClose}>
          关闭弹窗
        </button>
      </section>
    ) : null,
}))

vi.mock('@/components/smart/ShotTrashBin/ShotTrashBin', () => ({
  default: () => null,
}))

import ShotArrange from '@/components/smart/ShotArrange/ShotArrange'

const makeShot = (id: string, patch: Partial<Shot> = {}): Shot => ({
  id,
  no: `镜头${id.slice(-1)}`,
  duration: '5s',
  desc: `${id}描述`,
  subjects: [],
  line: `${id}台词`,
  image: `https://cdn.example.com/${id}.png`,
  ...patch,
})

function ControlledArrange({
  initialShots,
  onChange = vi.fn(),
  ...props
}: {
  initialShots: Shot[]
  onChange?: (shots: Shot[]) => void
  [key: string]: any
}) {
  const [shots, setShots] = useState(initialShots)
  return (
    <ShotArrange
      {...props}
      shots={shots}
      onShotsChange={(next) => {
        onChange(next)
        setShots(next)
      }}
    />
  )
}

beforeEach(() => vi.clearAllMocks())

describe('ShotArrange orchestration', () => {
  it('renders the empty state when no shot exists', () => {
    render(<ShotArrange shots={[]} onShotsChange={vi.fn()} />)
    expect(screen.getByText('请选择左侧分镜进行编辑')).toBeInTheDocument()
    expect(screen.queryByLabelText('镜头编辑面板测试替身')).not.toBeInTheDocument()
  })

  it('selects, patches, and recovers selection after the active shot disappears', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledArrange initialShots={[makeShot('shot-1'), makeShot('shot-2')]} onChange={onChange} />)

    expect(screen.getByLabelText('编辑中的镜头')).toHaveTextContent('shot-1')
    await user.click(screen.getByRole('button', { name: '选择第二镜头' }))
    expect(screen.getByLabelText('编辑中的镜头')).toHaveTextContent('shot-2')

    await user.click(screen.getByRole('button', { name: '提交字段修改' }))
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'shot-1', line: 'shot-1台词' }),
      expect.objectContaining({ id: 'shot-2', line: '已修改-shot-2' }),
    ])

    await user.click(screen.getByRole('button', { name: '删除选中镜头' }))
    await waitFor(() => expect(screen.getByLabelText('编辑中的镜头')).toHaveTextContent('shot-1'))
  })

  it('derives the selected-shot loading state from single and batch generation flags', () => {
    const { rerender } = render(
      <ShotArrange shots={[makeShot('shot-1')]} generating={{ 'shot-1': true }} onShotsChange={vi.fn()} />,
    )
    expect(screen.getByLabelText('镜头生成状态')).toHaveTextContent('生成中')

    rerender(
      <ShotArrange shots={[makeShot('shot-1', { image: '' })]} generating={{}} generatingAll onShotsChange={vi.fn()} />,
    )
    expect(screen.getByLabelText('镜头生成状态')).toHaveTextContent('生成中')

    rerender(<ShotArrange shots={[makeShot('shot-1')]} generating={{}} generatingAll onShotsChange={vi.fn()} />)
    expect(screen.getByLabelText('镜头生成状态')).toHaveTextContent('空闲')
  })

  it('forwards upload, prompt polish, text polish, and edit-generation actions with exact arguments', async () => {
    const user = userEvent.setup()
    const onUploadRef = vi.fn().mockResolvedValue({ url: 'uploaded', assetId: 5 })
    const onPolishPrompt = vi.fn().mockResolvedValue('润色描述')
    const onPolishText = vi.fn().mockResolvedValue('润色台词')
    const onGenerateShot = vi.fn().mockResolvedValue(true)
    render(
      <ControlledArrange
        initialShots={[makeShot('shot-1')]}
        onUploadRef={onUploadRef}
        onPolishPrompt={onPolishPrompt}
        onPolishText={onPolishText}
        onGenerateShot={onGenerateShot}
      />,
    )

    await user.click(screen.getByRole('button', { name: '调用文本润色' }))
    expect(onPolishText).toHaveBeenCalledWith('line', 'shot-1台词')

    await user.click(screen.getByRole('button', { name: '编辑第一镜头' }))
    expect(screen.getByLabelText('弹窗模式')).toHaveTextContent('edit')
    await user.click(screen.getByRole('button', { name: '上传参考图' }))
    expect(onUploadRef).toHaveBeenCalledOnce()
    expect(onUploadRef.mock.calls[0][0]).toEqual(expect.objectContaining({ name: 'reference.png', type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: '润色描述' }))
    expect(onPolishPrompt).toHaveBeenCalledWith('原始描述', ['https://cdn.example.com/reference.png'])

    await user.click(screen.getByRole('button', { name: '生成分镜' }))
    expect(onGenerateShot).toHaveBeenCalledWith(makeShot('shot-1'), {
      mode: 'edit',
      intent: '新描述',
      uploadRefUrls: ['https://cdn.example.com/reference.png'],
    })
  })

  it('removes an uncommitted placeholder when an insert dialog is cancelled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledArrange initialShots={[makeShot('shot-1')]} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '末尾插入镜头' }))
    expect(screen.getByLabelText('弹窗模式')).toHaveTextContent('insert')
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'shot-1', no: '镜头1' }),
      expect.objectContaining({ isNew: true, no: '镜头2' }),
    ])

    await user.click(screen.getByRole('button', { name: '关闭弹窗' }))
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'shot-1', no: '镜头1' })])
    expect(screen.queryByLabelText('分镜编辑弹窗测试替身')).not.toBeInTheDocument()
  })

  it('auto-generates each inserted shot once and remains usable after rejected generation', async () => {
    const user = userEvent.setup()
    const onGenerateShot = vi.fn().mockRejectedValue(new Error('生成服务暂不可用'))
    render(<ControlledArrange initialShots={[makeShot('shot-1')]} onGenerateShot={onGenerateShot} />)

    await user.click(screen.getByRole('button', { name: '末尾插入镜头' }))
    await waitFor(() => expect(onGenerateShot).toHaveBeenCalledTimes(1))
    expect(onGenerateShot.mock.calls[0][1]).toEqual({ mode: 'insert', intent: '', uploadRefUrls: [] })

    await user.click(screen.getByRole('button', { name: '末尾插入镜头' }))
    await waitFor(() => expect(onGenerateShot).toHaveBeenCalledTimes(2))
    expect(onGenerateShot.mock.calls[1][0].id).not.toBe(onGenerateShot.mock.calls[0][0].id)
  })

  it('opens and closes the preview lightbox through accessible controls', async () => {
    const user = userEvent.setup()
    render(<ShotArrange shots={[makeShot('shot-1')]} onShotsChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '预览镜头' }))
    expect(screen.getByRole('dialog', { name: '分镜图放大' }).querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/preview.png',
    )
    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
