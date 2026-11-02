import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { buildMentionRegex } from '@/utils/canvasMentions'
import styles from './CanvasNodePanel.module.css'

export interface CanvasMentionInputHandle {
  focus: () => void
  setSelectionRange: (start: number, end: number) => void
  readonly selectionStart: number
  readonly selectionEnd: number
}
export interface PromptMention {
  label: string
  kind: string
  thumbnailUrl?: string
  video?: boolean
}

/** Read storage text, counting a thumbnail chip as its original @label, never as image markup. */
export function readMentionInput(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\u00a0/g, ' ')
  if (node instanceof HTMLElement) {
    if (node.hasAttribute('data-caret-end')) return ''
    if (node.hasAttribute('data-mention')) return node.getAttribute('data-mention') || ''
    if (node.tagName === 'BR') return '\n'
  }
  return Array.from(node.childNodes).map(readMentionInput).join('')
}

export function selectionOffsets(root: HTMLElement): [number, number] {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
    const end = readMentionInput(root).length
    return [end, end]
  }
  const range = selection.getRangeAt(0)
  const prefix = document.createRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = readMentionInput(prefix.cloneContents()).length
  prefix.setEnd(range.endContainer, range.endOffset)
  return [start, readMentionInput(prefix.cloneContents()).length]
}

export function setSelection(root: HTMLElement, start: number, end: number) {
  const point = (offset: number): [Node, number] => {
    let remaining = Math.max(0, offset)
    for (const [index, child] of Array.from(root.childNodes).entries()) {
      const length = readMentionInput(child).length
      if (child.nodeType === Node.TEXT_NODE && remaining <= length) return [child, remaining]
      if (remaining < length) return [root, index + (remaining > 0 ? 1 : 0)]
      if (remaining === length && length > 0) return [root, index + 1]
      remaining -= length
    }
    return [root, Math.max(0, root.childNodes.length - 1)]
  }
  const range = document.createRange()
  range.setStart(...point(start))
  range.setEnd(...point(end))
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const CanvasMentionInput = forwardRef<
  CanvasMentionInputHandle,
  {
    value: string
    mentions: PromptMention[]
    placeholder: string
    className: string
    disabled?: boolean
    onChange: (event: { target: { value: string; selectionStart: number } }) => void
    onSelect: () => void
    onFocus: () => void
    onBlur: () => void
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
    onPreview: (label: string) => void
  }
>(function CanvasMentionInput(props, forwardedRef) {
  const rootRef = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const [compositionVersion, setCompositionVersion] = useState(0)
  const pendingSelection = useRef<[number, number] | null>(null)
  const history = useRef<string[]>([])
  const redo = useRef<string[]>([])
  const lastValue = useRef(props.value)

  useImperativeHandle(forwardedRef, () => ({
    focus: () => rootRef.current?.focus(),
    setSelectionRange: (start, end) => {
      if (rootRef.current) setSelection(rootRef.current, start, end)
    },
    get selectionStart() {
      return rootRef.current ? selectionOffsets(rootRef.current)[0] : 0
    },
    get selectionEnd() {
      return rootRef.current ? selectionOffsets(rootRef.current)[1] : 0
    },
  }))

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || composing.current) return
    const focused = document.activeElement === root
    if (focused && props.value !== lastValue.current) {
      history.current.push(lastValue.current)
      if (history.current.length > 100) history.current.shift()
      redo.current = []
    }
    const selection = pendingSelection.current || (focused ? selectionOffsets(root) : null)
    pendingSelection.current = null
    const fragment = document.createDocumentFragment()
    const regex = buildMentionRegex(props.mentions.map((mention) => mention.label))
    let last = 0
    for (const match of props.value.matchAll(regex)) {
      fragment.append(document.createTextNode(props.value.slice(last, match.index)))
      const label = match[0].slice(1)
      const mention = props.mentions.find((item) => item.label === label)
      const chip = document.createElement('span')
      chip.setAttribute('contenteditable', 'false')
      chip.dataset.mention = match[0]
      chip.className = `${styles.promptRefTag} ${styles.promptRefImageTag}`
      chip.setAttribute('role', 'button')
      chip.setAttribute('aria-label', `查看引用${mention?.kind === 'video' ? '视频' : '图片'}：${label}`)
      chip.tabIndex = -1
      if (mention?.thumbnailUrl) {
        const thumbnail = document.createElement(mention.video ? 'video' : 'img')
        thumbnail.className = styles.promptRefImageThumb
        thumbnail.src = mention.thumbnailUrl
        thumbnail.setAttribute('aria-hidden', 'true')
        if (thumbnail instanceof HTMLVideoElement) {
          thumbnail.muted = true
          thumbnail.preload = 'metadata'
          thumbnail.playsInline = true
        } else {
          thumbnail.alt = ''
          thumbnail.draggable = false
        }
        chip.append(thumbnail)
      }
      const text = document.createElement('span')
      text.textContent = match[0]
      chip.append(text)
      fragment.append(chip)
      last = match.index! + match[0].length
    }
    fragment.append(document.createTextNode(props.value.slice(last)))
    // The final BR gives the native caret a line box, including after a chip or a trailing newline.
    const end = document.createElement('br')
    end.dataset.caretEnd = 'true'
    fragment.append(end)
    root.replaceChildren(fragment)
    root.dataset.value = props.value
    root.dataset.empty = String(props.value.length === 0)
    lastValue.current = props.value
    if (focused && selection) setSelection(root, ...selection)
  }, [props.value, props.mentions, compositionVersion])

  const emit = (value: string, caret: number, record = true) => {
    // Update during IME composition too, when rebuilding the editor DOM is deferred.
    if (rootRef.current) rootRef.current.dataset.empty = String(value.length === 0)
    if (record && value !== lastValue.current) {
      history.current.push(lastValue.current)
      if (history.current.length > 100) history.current.shift()
      redo.current = []
    }
    lastValue.current = value
    pendingSelection.current = [caret, caret]
    props.onChange({ target: { value, selectionStart: caret } })
  }
  const insertText = (text: string) => {
    const root = rootRef.current!
    const [start, end] = selectionOffsets(root)
    const value = readMentionInput(root)
    emit(value.slice(0, start) + text + value.slice(end), start + text.length)
  }

  return (
    <div
      ref={rootRef}
      className={`${props.className} ${styles.richPrompt}`}
      role="textbox"
      aria-label={props.placeholder}
      aria-multiline="true"
      aria-disabled={props.disabled || undefined}
      {...{ placeholder: props.placeholder }}
      data-placeholder={props.placeholder}
      data-empty={props.value.length === 0 ? 'true' : 'false'}
      contentEditable={!props.disabled}
      suppressContentEditableWarning
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onInput={() => {
        const root = rootRef.current!
        emit(readMentionInput(root), selectionOffsets(root)[0])
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={() => {
        composing.current = false
        const root = rootRef.current!
        emit(readMentionInput(root), selectionOffsets(root)[0])
        setCompositionVersion((version) => version + 1)
      }}
      onKeyUp={props.onSelect}
      onMouseUp={props.onSelect}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('[data-mention]')) event.preventDefault()
      }}
      onClick={(event) => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-mention]')
        if (chip) props.onPreview((chip.dataset.mention || '').slice(1))
      }}
      onPaste={(event) => {
        event.preventDefault()
        if (!props.disabled) insertText(event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'))
      }}
      onDrop={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation()
        props.onKeyDown(event)
        if (event.defaultPrevented || event.nativeEvent.isComposing || composing.current || props.disabled) return
        if ((event.ctrlKey || event.metaKey) && /^(z|y)$/i.test(event.key)) {
          event.preventDefault()
          const undo = event.key.toLowerCase() === 'z' && !event.shiftKey
          const source = undo ? history.current : redo.current
          const target = undo ? redo.current : history.current
          const value = source.pop()
          if (value !== undefined) {
            target.push(lastValue.current)
            emit(value, value.length, false)
          }
        } else if (event.key === 'Enter') {
          event.preventDefault()
          insertText('\n')
        }
      }}
    />
  )
})

export default CanvasMentionInput
