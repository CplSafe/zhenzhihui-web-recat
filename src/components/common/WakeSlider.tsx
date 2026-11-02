import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import './WakeSlider.css'

export interface WakeSliderOption {
  value: string | number
  label?: string
  disabled?: boolean
}

export interface WakeSliderProps {
  options: WakeSliderOption[]
  value: string | number
  onChange: (value: string | number) => void
  ariaLabel: string
  disabled?: boolean
  bars?: number
  wake?: number
  className?: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const numericOptionValue = (option: WakeSliderOption) => {
  const match = String(option.value).match(/[+-]?(?:\d+\.?\d*|\.\d+)/)
  return match ? Number(match[0]) : Number.NaN
}

/** Discrete, accessible range picker with a velocity-responsive bar wake. */
export default function WakeSlider({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  bars = 36,
  wake = 60,
  className,
}: WakeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const energyRef = useRef<number[]>([])
  const frameRef = useRef<number | null>(null)
  const pointerRef = useRef<{ x: number; time: number } | null>(null)
  const lastIndexRef = useRef(0)
  const safeOptions = useMemo(() => {
    const values = options.map(numericOptionValue)
    if (!values.every(Number.isFinite)) return options
    return [...options].sort((left, right) => numericOptionValue(left) - numericOptionValue(right))
  }, [options])
  const selectedIndex = Math.max(
    0,
    safeOptions.findIndex((option) => String(option.value) === String(value)),
  )
  const selected = safeOptions[selectedIndex]
  const barCount = Math.max(8, Math.min(72, bars))

  const numericValues = safeOptions.map(numericOptionValue)
  const firstNumber = numericValues.length ? Math.min(...numericValues) : 0
  const lastNumber = numericValues.length ? Math.max(...numericValues) : 1
  const hasNumericScale = safeOptions.length > 1 && numericValues.every(Number.isFinite) && lastNumber > firstNumber
  const positionForIndex = (index: number) => {
    if (safeOptions.length <= 1) return 0
    if (hasNumericScale)
      return clamp((numericOptionValue(safeOptions[index]) - firstNumber) / (lastNumber - firstNumber), 0, 1)
    return index / (safeOptions.length - 1)
  }
  const position = positionForIndex(selectedIndex)

  const paint = useCallback(() => {
    const track = trackRef.current
    if (!track) {
      frameRef.current = null
      return
    }
    const nodes = track.querySelectorAll<HTMLElement>('.wks-bar')
    let active = false
    const dt = 1 / 60
    for (let index = 0; index < nodes.length; index += 1) {
      const energy = energyRef.current[index] || 0
      if (energy > 0.005) active = true
      energyRef.current[index] = energy * Math.exp(-dt * 6.5)
      nodes[index].style.transform = `scaleY(${1 + energy * 1.6})`
      nodes[index].toggleAttribute('data-on', energy > 0.16)
    }
    if (active) frameRef.current = window.requestAnimationFrame(paint)
    else frameRef.current = null
  }, [])

  const ignite = useCallback(
    (from: number, to: number, speed: number) => {
      const push = (1 - Math.exp(-speed / 900)) * (wake / 100)
      for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
        energyRef.current[index] = Math.max(energyRef.current[index] || 0, push)
      }
      if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(paint)
    },
    [paint, wake],
  )

  useEffect(() => {
    energyRef.current = Array(barCount).fill(0)
    const track = trackRef.current
    if (track) {
      track.querySelectorAll<HTMLElement>('.wks-bar').forEach((bar) => {
        bar.style.transform = 'scaleY(1)'
        bar.removeAttribute('data-on')
      })
    }
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    }
  }, [barCount])

  const indexFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return clamp(Math.floor(((clientX - rect.left) / rect.width) * barCount), 0, barCount - 1)
  }

  const indexForPosition = (positionValue: number) => clamp(Math.round(positionValue * (barCount - 1)), 0, barCount - 1)

  const nearestEnabledIndex = (index: number, direction: -1 | 1): number => {
    if (!safeOptions[index]?.disabled) return index
    for (let distance = 1; distance < safeOptions.length; distance += 1) {
      const preferred = index + distance * direction
      if (preferred >= 0 && preferred < safeOptions.length && !safeOptions[preferred].disabled) return preferred
      const alternate = index - distance * direction
      if (alternate >= 0 && alternate < safeOptions.length && !safeOptions[alternate].disabled) return alternate
    }
    return selectedIndex
  }

  const onPointerDown = (event: PointerEvent<HTMLInputElement>) => {
    pointerRef.current = { x: event.clientX, time: performance.now() }
    lastIndexRef.current = indexFromPointer(event.clientX)
  }

  const onPointerMove = (event: PointerEvent<HTMLInputElement>) => {
    if (!pointerRef.current || disabled) return
    const now = performance.now()
    const elapsed = Math.max(1, now - pointerRef.current.time)
    const nextIndex = indexFromPointer(event.clientX)
    const speed = (Math.abs(event.clientX - pointerRef.current.x) / elapsed) * 1000
    ignite(lastIndexRef.current, nextIndex, speed)
    lastIndexRef.current = nextIndex
    pointerRef.current = { x: event.clientX, time: now }
  }

  const onPointerUp = () => {
    pointerRef.current = null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key))
      return
    event.preventDefault()
    const direction = ['ArrowRight', 'ArrowUp', 'PageUp', 'End'].includes(event.key) ? 1 : -1
    let next = selectedIndex
    if (event.key === 'Home') next = safeOptions.findIndex((option) => !option.disabled)
    else if (event.key === 'End') {
      next = safeOptions.length - 1
      while (next >= 0 && safeOptions[next].disabled) next -= 1
    } else next = nearestEnabledIndex(clamp(selectedIndex + direction, 0, safeOptions.length - 1), direction as -1 | 1)
    if (next < 0 || next === selectedIndex) return
    ignite(indexForPosition(positionForIndex(selectedIndex)), indexForPosition(positionForIndex(next)), 260)
    onChange(safeOptions[next].value)
  }

  if (!safeOptions.length || !selected) return null

  return (
    <div className={`wks ${className || ''}${disabled ? ' wks-disabled' : ''}`}>
      <div className="wks-control" ref={trackRef}>
        <span className="wks-fill" style={{ transform: `scaleX(${position})` }} aria-hidden="true" />
        <div className="wks-bars" aria-hidden="true">
          {Array.from({ length: barCount }, (_, index) => (
            <span
              className="wks-bar"
              key={index}
              style={{ '--bar-height': `${24 + ((index * 17 + 5) % 17)}px` } as CSSProperties}
            />
          ))}
        </div>
        <input
          ref={inputRef}
          className="wks-input"
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(position * 1000)}
          aria-label={ariaLabel}
          aria-valuetext={String(selected.label ?? selected.value)}
          disabled={disabled || safeOptions.length < 2 || safeOptions.every((option) => option.disabled)}
          onChange={(event) => {
            const nextPosition = Number(event.target.value) / 1000
            const nearest = safeOptions.reduce(
              (best, option, index) => {
                if (option.disabled) return best
                return Math.abs(positionForIndex(index) - nextPosition) <
                  Math.abs(positionForIndex(best) - nextPosition)
                  ? index
                  : best
              },
              safeOptions.findIndex((option) => !option.disabled),
            )
            if (nearest >= 0 && nearest !== selectedIndex) {
              ignite(
                indexForPosition(positionForIndex(selectedIndex)),
                indexForPosition(positionForIndex(nearest)),
                Math.abs(nextPosition - position) * 1800,
              )
              onChange(safeOptions[nearest].value)
            }
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        />
        <span
          className="wks-thumb"
          style={{ left: `calc(4px + ${position * 100}% - ${position * 8}px)` }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
