import ScriptStoryboardTable, { type Shot } from '@/components/smart/ScriptStoryboardTable'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestConfirm: vi.fn(),
  showToast: vi.fn(),
  trashBin: vi.fn(() => null),
}))

vi.mock('@/stores/ui', () => ({
  requestConfirm: mocks.requestConfirm,
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock('@/components/smart/ShotTrashBin/ShotTrashBin', () => ({
  default: mocks.trashBin,
}))

function shot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: 'shot-1',
    no: '镜头1',
    duration: '5s',
    desc: '产品在晨光中出现',
    subjects: [],
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function getMaterialItem(name: string) {
  return screen.getByRole('group', { name })
}

async function editDuration(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.click(screen.getByRole('button', { name: from }))
  const input = screen.getByRole('textbox')
  await user.clear(input)
  await user.type(input, `${to}{Enter}`)
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.requestConfirm.mockResolvedValue(true)
  mocks.trashBin.mockReturnValue(null)
})

describe('empty, insertion and regeneration states', () => {
  it('renders the empty count and inserts the first shot through an accessible button', async () => {
    const user = userEvent.setup()
    const onInsertShot = vi.fn()
    render(<ScriptStoryboardTable shots={[]} onInsertShot={onInsertShot} showSubjects={false} />)

    expect(screen.getByText('共 0 个镜头')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '新增第一条分镜' }))
    expect(onInsertShot).toHaveBeenCalledWith(0)
  })

  it('keeps insertion controls visible but disabled while generation is active', () => {
    render(<ScriptStoryboardTable shots={[shot()]} onInsertShot={vi.fn()} insertDisabled showSubjects={false} />)

    const before = screen.getByRole('button', { name: '在镜头1前新增分镜' })
    const after = screen.getByRole('button', { name: '在镜头1后新增分镜' })
    expect(before).toBeDisabled()
    expect(after).toBeDisabled()
    expect(before).toHaveAttribute('title', '生成进行中，暂时不能新增分镜')
  })

  it('runs regeneration once and exposes its disabled loading state', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    const { rerender } = render(
      <ScriptStoryboardTable shots={[shot()]} onRegenerate={onRegenerate} showSubjects={false} />,
    )

    await user.click(screen.getByRole('button', { name: '重新生成' }))
    expect(onRegenerate).toHaveBeenCalledOnce()

    rerender(<ScriptStoryboardTable shots={[shot()]} onRegenerate={onRegenerate} regenerating showSubjects={false} />)
    expect(screen.getByRole('button', { name: '生成中…' })).toBeDisabled()
  })
})

describe('duration editing boundaries', () => {
  it('confirms and persists a valid duration change', async () => {
    const user = userEvent.setup()
    const onShotsChange = vi.fn()
    render(<ScriptStoryboardTable shots={[shot()]} onShotsChange={onShotsChange} showSubjects={false} />)

    await editDuration(user, '5', '6')

    await waitFor(() => expect(mocks.requestConfirm).toHaveBeenCalledOnce())
    expect(mocks.requestConfirm).toHaveBeenCalledWith(
      '镜头「镜头1」时长从 5s 改为 6s，确认修改吗？',
      expect.objectContaining({ title: '确认时长' }),
    )
    expect(onShotsChange).toHaveBeenCalledWith([expect.objectContaining({ duration: '6s' })])
  })

  it('does not persist when duration confirmation is cancelled', async () => {
    const user = userEvent.setup()
    const onShotsChange = vi.fn()
    mocks.requestConfirm.mockResolvedValue(false)
    render(<ScriptStoryboardTable shots={[shot()]} onShotsChange={onShotsChange} showSubjects={false} />)

    await editDuration(user, '5', '6')

    await waitFor(() => expect(mocks.requestConfirm).toHaveBeenCalledOnce())
    expect(onShotsChange).not.toHaveBeenCalled()
  })

  it('waits for deferred confirmation before committing', async () => {
    const user = userEvent.setup()
    const confirmation = deferred<boolean>()
    const onShotsChange = vi.fn()
    mocks.requestConfirm.mockReturnValue(confirmation.promise)
    render(<ScriptStoryboardTable shots={[shot()]} onShotsChange={onShotsChange} showSubjects={false} />)

    await editDuration(user, '5', '7')
    expect(onShotsChange).not.toHaveBeenCalled()

    confirmation.resolve(true)
    await waitFor(() => expect(onShotsChange).toHaveBeenCalledWith([expect.objectContaining({ duration: '7s' })]))
  })

  it.each([
    ['0', ''],
    ['16', '最长仅支持15秒，请修改秒数'],
  ])('rejects duration boundary %s without updating', async (value, toast) => {
    const user = userEvent.setup()
    const onShotsChange = vi.fn()
    render(<ScriptStoryboardTable shots={[shot()]} onShotsChange={onShotsChange} showSubjects={false} />)

    await editDuration(user, '5', value)

    expect(onShotsChange).not.toHaveBeenCalled()
    expect(mocks.requestConfirm).not.toHaveBeenCalled()
    if (toast) expect(mocks.showToast).toHaveBeenCalledWith(toast, 'error')
  })

  it('allows the combined duration to be reduced below five seconds', async () => {
    const user = userEvent.setup()
    const onShotsChange = vi.fn()
    render(<ScriptStoryboardTable shots={[shot()]} onShotsChange={onShotsChange} showSubjects={false} />)

    await editDuration(user, '5', '1')

    await waitFor(() => expect(onShotsChange).toHaveBeenCalledWith([expect.objectContaining({ duration: '1s' })]))
    expect(mocks.requestConfirm).toHaveBeenCalledWith(
      '镜头「镜头1」时长从 5s 改为 1s，确认修改吗？',
      expect.objectContaining({ title: '确认时长' }),
    )
  })

  it('rejects a change that would push the combined duration over 15 seconds', async () => {
    const user = userEvent.setup()
    const onShotsChange = vi.fn()
    render(
      <ScriptStoryboardTable
        shots={[shot(), shot({ id: 'shot-2', no: '镜头2', duration: '9s' })]}
        onShotsChange={onShotsChange}
        showSubjects={false}
      />,
    )

    await editDuration(user, '5', '7')

    expect(onShotsChange).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('总时长不能超过15秒（改后为 16s），请调整', 'error')
  })

  it('preserves a decimal duration instead of silently truncating it', async () => {
    const user = userEvent.setup()
    const onShotsChange = vi.fn()
    render(<ScriptStoryboardTable shots={[shot()]} onShotsChange={onShotsChange} showSubjects={false} />)

    await editDuration(user, '5', '6.5')

    await waitFor(() => expect(onShotsChange).toHaveBeenCalled())
    expect(mocks.requestConfirm).toHaveBeenCalledWith(expect.stringContaining('从 5s 改为 6.5s'), expect.anything())
    expect(onShotsChange).toHaveBeenCalledWith([expect.objectContaining({ duration: '6.5s' })])
  })

  it('defers range validation and confirmation while still accepting only a positive duration', async () => {
    const user = userEvent.setup()
    const onShotsChange = vi.fn()
    render(
      <ScriptStoryboardTable
        shots={[shot()]}
        onShotsChange={onShotsChange}
        deferDurationValidation
        showSubjects={false}
      />,
    )

    await editDuration(user, '5', '16.5')

    expect(mocks.requestConfirm).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
    expect(onShotsChange).toHaveBeenCalledWith([expect.objectContaining({ duration: '16.5s' })])
  })
})

describe('description and loading accessibility', () => {
  it('edits a description with the documented double-click interaction', async () => {
    const user = userEvent.setup()
    const onShotsChange = vi.fn()
    render(<ScriptStoryboardTable shots={[shot()]} onShotsChange={onShotsChange} showSubjects={false} />)

    await user.dblClick(screen.getByRole('button', { name: '产品在晨光中出现' }))
    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, '新的画面描述{Enter}')

    expect(onShotsChange).toHaveBeenCalledWith([expect.objectContaining({ desc: '新的画面描述' })])
  })

  it('marks a generating description busy and announces a polite status', () => {
    render(
      <ScriptStoryboardTable
        shots={[shot()]}
        shotTextGenerating={{ 'shot-1': true }}
        onShotsChange={vi.fn()}
        showSubjects={false}
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('正在生成分镜词…')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status.parentElement).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: '产品在晨光中出现' })).not.toBeInTheDocument()
  })
})

describe('subject material actions', () => {
  it('keeps the original row material layout while showing each repeated subject only once', () => {
    render(
      <ScriptStoryboardTable
        shots={[
          shot({
            subjects: [
              { tag: '@年轻男性篮球手', kind: '人物' },
              { tag: '@室外篮球场', kind: '场景' },
              { tag: '@篮球', kind: '物体' },
              { tag: '@篮球', kind: '物体' },
            ],
          }),
          shot({
            id: 'shot-2',
            no: '镜头2',
            subjects: [
              { tag: '@年轻男性篮球手', kind: '人物' },
              { tag: '@篮球', kind: '物体' },
              { tag: '@篮筐', kind: '物体' },
            ],
          }),
          shot({
            id: 'shot-3',
            no: '镜头3',
            subjects: [
              { tag: '@篮球', kind: '物体' },
              { tag: '@室外篮球场', kind: '场景' },
              { tag: '@落日天空', kind: '场景' },
            ],
          }),
        ]}
      />,
    )

    const firstShotMaterials = screen.getByRole('group', { name: '镜头1准备素材' })
    const secondShotMaterials = screen.getByRole('group', { name: '镜头2准备素材' })
    const thirdShotMaterials = screen.getByRole('group', { name: '镜头3准备素材' })

    expect(within(firstShotMaterials).getByText('@年轻男性篮球手')).toBeInTheDocument()
    expect(within(firstShotMaterials).getByText('@室外篮球场')).toBeInTheDocument()
    expect(within(firstShotMaterials).getByText('@篮球')).toBeInTheDocument()
    expect(within(secondShotMaterials).queryByText('@年轻男性篮球手')).not.toBeInTheDocument()
    expect(within(secondShotMaterials).queryByText('@篮球')).not.toBeInTheDocument()
    expect(within(secondShotMaterials).getByText('@篮筐')).toBeInTheDocument()
    expect(within(thirdShotMaterials).queryByText('@篮球')).not.toBeInTheDocument()
    expect(within(thirdShotMaterials).queryByText('@室外篮球场')).not.toBeInTheDocument()
    expect(within(thirdShotMaterials).getByText('@落日天空')).toBeInTheDocument()
    expect(screen.getAllByText('@年轻男性篮球手')).toHaveLength(1)
    expect(screen.getAllByText('@室外篮球场')).toHaveLength(1)
    expect(screen.getAllByText('@篮球')).toHaveLength(1)
    expect(screen.getAllByText('@篮筐')).toHaveLength(1)
    expect(screen.getAllByText('@落日天空')).toHaveLength(1)
    expect(screen.queryByText('@待补充')).not.toBeInTheDocument()
  })

  it('uses the same material-column width class for the header and every shot row', () => {
    render(
      <ScriptStoryboardTable
        shots={[
          shot({ subjects: [{ tag: '@短名称' }] }),
          shot({
            id: 'shot-2',
            no: '镜头2',
            subjects: [{ tag: '@这是一个不会再撑宽第二条分镜素材列的很长素材名称' }],
          }),
        ]}
      />,
    )

    const materialHeader = screen.getByText('准备素材').parentElement
    const materialColumns = [
      screen.getByRole('group', { name: '镜头1准备素材' }),
      screen.getByRole('group', { name: '镜头2准备素材' }),
    ]
    expect(materialHeader).not.toBeNull()
    const sharedColumnClasses = [...(materialHeader?.classList || [])].filter((className) =>
      materialColumns.every((column) => column.classList.contains(className)),
    )
    expect(sharedColumnClasses).toHaveLength(1)
  })

  it('hides the original material column during the storyboard-only step', () => {
    render(<ScriptStoryboardTable shots={[shot({ subjects: [{ tag: '@产品' }] })]} showSubjects={false} />)

    expect(screen.queryByText('准备素材')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '镜头1准备素材' })).not.toBeInTheDocument()
  })

  it('generates, opens and removes a subject image', async () => {
    const user = userEvent.setup()
    const onGenerateSubject = vi.fn()
    const onOpenSubject = vi.fn()
    const onRemoveSubject = vi.fn()
    render(
      <ScriptStoryboardTable
        shots={[
          shot({
            subjects: [{ tag: '@咖啡杯', kind: '产品', image: '/coffee.png' }],
          }),
        ]}
        onGenerateSubject={onGenerateSubject}
        onOpenSubject={onOpenSubject}
        onRemoveSubject={onRemoveSubject}
      />,
    )

    await user.click(within(getMaterialItem('素材：@咖啡杯')).getByRole('button', { name: '为咖啡杯AI自动生成' }))
    expect(onGenerateSubject).toHaveBeenCalledWith('咖啡杯')

    await user.click(screen.getByRole('button', { name: '咖啡杯' }))
    expect(onOpenSubject).toHaveBeenCalledWith('咖啡杯')

    await user.click(screen.getByRole('button', { name: '去掉咖啡杯素材图' }))
    expect(onRemoveSubject).toHaveBeenCalledWith('咖啡杯')
  })

  it('falls back to opening auto-generation and handles an empty-subject shot', async () => {
    const user = userEvent.setup()
    const onOpenSubject = vi.fn()
    const onGenerateMaterial = vi.fn()
    const { rerender } = render(
      <ScriptStoryboardTable shots={[shot({ subjects: [{ tag: '@模特' }] })]} onOpenSubject={onOpenSubject} />,
    )

    await user.click(within(getMaterialItem('素材：@模特')).getByRole('button', { name: '为模特AI自动生成' }))
    expect(onOpenSubject).toHaveBeenCalledWith('模特', true)

    rerender(
      <ScriptStoryboardTable
        shots={[shot({ subjects: [{ tag: '@模特' }] }), shot({ id: 'shot-2', no: '镜头2', subjects: [] })]}
        onGenerateMaterial={onGenerateMaterial}
      />,
    )
    const emptyMaterialItem = getMaterialItem('待补充素材：镜头2')
    await user.click(within(emptyMaterialItem).getByRole('button', { name: '为镜头2AI自动生成素材' }))
    expect(onGenerateMaterial).toHaveBeenCalledWith(expect.objectContaining({ id: 'shot-2' }))
  })

  it('runs batch generation and exposes batch/subject loading states', async () => {
    const user = userEvent.setup()
    const onGenerateAll = vi.fn()
    const { rerender } = render(
      <ScriptStoryboardTable shots={[shot({ subjects: [{ tag: '@产品' }] })]} onGenerateAll={onGenerateAll} />,
    )

    await user.click(screen.getByRole('button', { name: 'AI一键生成图片' }))
    expect(onGenerateAll).toHaveBeenCalledOnce()

    rerender(
      <ScriptStoryboardTable
        shots={[shot({ subjects: [{ tag: '@产品' }] })]}
        onGenerateAll={onGenerateAll}
        batchGenning
        subjectGenerating={{ 产品: true }}
      />,
    )
    expect(screen.getByRole('button', { name: '批量素材生成中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '产品生成中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '产品素材生成中' })).toBeInTheDocument()
    expect(within(getMaterialItem('素材：@产品')).getByRole('status')).toHaveTextContent('生成中…')
    expect(screen.queryByRole('button', { name: '去掉产品素材图' })).not.toBeInTheDocument()
  })

  it('suppresses immediate duplicate subject and batch generation clicks', async () => {
    const user = userEvent.setup()
    const onGenerateSubject = vi.fn()
    const onGenerateAll = vi.fn()
    render(
      <ScriptStoryboardTable
        shots={[shot({ subjects: [{ tag: '@产品' }] })]}
        onGenerateSubject={onGenerateSubject}
        onGenerateAll={onGenerateAll}
      />,
    )

    await user.dblClick(screen.getByRole('button', { name: '为产品AI自动生成' }))
    await user.dblClick(screen.getByRole('button', { name: 'AI一键生成图片' }))

    expect(onGenerateSubject).toHaveBeenCalledOnce()
    expect(onGenerateAll).toHaveBeenCalledOnce()
  })
})

describe('shot deletion and trash forwarding', () => {
  it('cancels deletion without invoking the callback', async () => {
    const user = userEvent.setup()
    const onDeleteShot = vi.fn()
    mocks.requestConfirm.mockResolvedValue(false)
    render(<ScriptStoryboardTable shots={[shot()]} onDeleteShot={onDeleteShot} showSubjects={false} />)

    await user.click(screen.getByRole('button', { name: '删除镜头' }))

    expect(mocks.requestConfirm).toHaveBeenCalledWith(
      '确认删除「镜头1」吗？',
      expect.objectContaining({ danger: true }),
    )
    expect(onDeleteShot).not.toHaveBeenCalled()
  })

  it('deletes after confirmation and reports callback failures through the shared toast', async () => {
    const user = userEvent.setup()
    const onDeleteShot = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('后端删除失败'))
    render(<ScriptStoryboardTable shots={[shot()]} onDeleteShot={onDeleteShot} showSubjects={false} />)

    await user.click(screen.getByRole('button', { name: '删除镜头' }))
    await waitFor(() => expect(onDeleteShot).toHaveBeenCalledWith(expect.objectContaining({ id: 'shot-1' }), 0))

    await user.click(screen.getByRole('button', { name: '删除镜头' }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('后端删除失败', 'error'))
  })

  it('suppresses rapid duplicate deletion while confirmation is pending', async () => {
    const user = userEvent.setup()
    const confirmation = deferred<boolean>()
    const onDeleteShot = vi.fn()
    mocks.requestConfirm.mockReturnValue(confirmation.promise)
    render(<ScriptStoryboardTable shots={[shot()]} onDeleteShot={onDeleteShot} showSubjects={false} />)

    await user.dblClick(screen.getByRole('button', { name: '删除镜头' }))
    expect(mocks.requestConfirm).toHaveBeenCalledOnce()

    confirmation.resolve(true)
    await waitFor(() => expect(onDeleteShot).toHaveBeenCalledOnce())
  })

  it('forwards trash data, loading and callbacks to the trash-bin component', () => {
    const onLoadTrash = vi.fn()
    const onRestoreTrash = vi.fn()
    const onDeleteTrash = vi.fn()
    const trashItems = [
      {
        id: 9,
        title: '已删镜头',
        duration: '5s',
        thumb: '',
        detail: '描述',
        deletedAt: '刚刚',
      },
    ]
    render(
      <ScriptStoryboardTable
        shots={[shot()]}
        showSubjects={false}
        trashItems={trashItems}
        trashLoading
        onLoadTrash={onLoadTrash}
        onRestoreTrash={onRestoreTrash}
        onDeleteTrash={onDeleteTrash}
      />,
    )

    expect(mocks.trashBin).toHaveBeenCalledWith(
      expect.objectContaining({
        items: trashItems,
        loading: true,
        onLoad: onLoadTrash,
        onRestore: onRestoreTrash,
        onDelete: onDeleteTrash,
        dataGuide: 'smart-script-trash',
      }),
      {},
    )
  })
})
