import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShotTrashBin from '@/components/smart/ShotTrashBin/ShotTrashBin'

interface LayoutBox {
  left: number
  top: number
  right: number
  bottom: number
}

const BOUNDARY_SELECTOR = '.shot-trash-test-boundary'
const OBSTACLE_SELECTOR = '.shot-trash-test-obstacle'
const STORAGE_KEY = 'shot_trash_fab_pos:test-position'

let disposeLayout: (() => void) | undefined

function toDomRect(box: LayoutBox): DOMRect {
  return {
    x: box.left,
    y: box.top,
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    width: box.right - box.left,
    height: box.bottom - box.top,
    toJSON: () => ({ ...box }),
  } as DOMRect
}

function installLayout() {
  let boundaryBox: LayoutBox = { left: 100, top: 50, right: 500, bottom: 450 }
  const obstacleBox: LayoutBox = { left: 100, top: 80, right: 500, bottom: 140 }
  const boundary = document.createElement('div')
  const obstacle = document.createElement('div')
  boundary.className = BOUNDARY_SELECTOR.slice(1)
  obstacle.className = OBSTACLE_SELECTOR.slice(1)
  vi.spyOn(boundary, 'getBoundingClientRect').mockImplementation(() => toDomRect(boundaryBox))
  vi.spyOn(obstacle, 'getBoundingClientRect').mockImplementation(() => toDomRect(obstacleBox))
  document.body.append(boundary, obstacle)
  disposeLayout = () => {
    boundary.remove()
    obstacle.remove()
  }

  return {
    setBoundaryBox(next: LayoutBox) {
      boundaryBox = next
    },
  }
}

function renderTrashBin() {
  return render(
    <ShotTrashBin
      dragStorageKey="test-position"
      dragBoundarySelector={BOUNDARY_SELECTOR}
      dragTopObstacleSelector={OBSTACLE_SELECTOR}
    />,
  )
}

afterEach(() => {
  disposeLayout?.()
  disposeLayout = undefined
})

describe('ShotTrashBin floating position', () => {
  it('clamps pointer dragging to the boundary and top obstacle', async () => {
    installLayout()
    renderTrashBin()
    const button = screen.getByRole('button', { name: '打开分镜回收站' })

    await waitFor(() => expect(button).toHaveStyle({ left: '108px', top: '222.68px' }))

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(button, { pointerId: 1, clientX: -1_000, clientY: 1_000 })
    expect(button).toHaveStyle({ left: '100px', top: '392px' })

    fireEvent.pointerMove(button, { pointerId: 1, clientX: 1_000, clientY: -1_000 })
    expect(button).toHaveStyle({ left: '442px', top: '143px' })
    fireEvent.pointerUp(button, { pointerId: 1 })
  })

  it('clamps the current position on resize without rebinding the listener on ordinary rerenders', async () => {
    const layout = installLayout()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 400, y: 350 }))
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const { rerender } = renderTrashBin()
    const button = screen.getByRole('button', { name: '打开分镜回收站' })

    await waitFor(() => expect(button).toHaveStyle({ left: '400px', top: '350px' }))
    expect(addEventListener.mock.calls.filter(([eventName]) => eventName === 'resize')).toHaveLength(1)

    rerender(
      <ShotTrashBin
        items={[]}
        dragStorageKey="test-position"
        dragBoundarySelector={BOUNDARY_SELECTOR}
        dragTopObstacleSelector={OBSTACLE_SELECTOR}
      />,
    )
    expect(addEventListener.mock.calls.filter(([eventName]) => eventName === 'resize')).toHaveLength(1)

    layout.setBoundaryBox({ left: 100, top: 50, right: 300, bottom: 260 })
    fireEvent(window, new Event('resize'))

    await waitFor(() => expect(button).toHaveStyle({ left: '242px', top: '202px' }))
  })

  it('restores a saved local position without StrictMode overwriting it with the initial default', async () => {
    installLayout()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 320, y: 300 }))

    render(
      <StrictMode>
        <ShotTrashBin
          dragStorageKey="test-position"
          dragBoundarySelector={BOUNDARY_SELECTOR}
          dragTopObstacleSelector={OBSTACLE_SELECTOR}
        />
      </StrictMode>,
    )
    const button = screen.getByRole('button', { name: '打开分镜回收站' })

    await waitFor(() => expect(button).toHaveStyle({ left: '320px', top: '300px' }))
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')).toEqual({ x: 320, y: 300 })
  })
})
