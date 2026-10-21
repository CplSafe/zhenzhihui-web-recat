import { useEffect, useRef, useState } from 'react'
import { polishEntryPrompt } from '@/api/entryPromptPolish'
import { useToast } from '@/composables/useToast'
import styles from './PromptPolishActions.module.css'

interface Props {
  value: string
  inputText?: string
  onChange: (value: string) => void
  workspaceId: number
  scopeKey: string
  kind: string
  images: string[]
  imageAssetIds: number[]
  disabled?: boolean
  authRequired?: boolean
  onAuthRequired?: () => void
}

/** 保留原文以供复原；异步返回仅回填同一份输入。 */
export default function PromptPolishActions(props: Props) {
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const request = useRef<AbortController | null>(null)
  const latest = useRef(props)
  latest.current = props
  const fingerprint = (p: Props) =>
    JSON.stringify([p.scopeKey, p.workspaceId, p.kind, p.value, p.inputText, p.images, p.imageAssetIds])
  useEffect(() => {
    setHistory([])
    setBusy(false)
    return () => {
      request.current?.abort()
      request.current = null
    }
  }, [props.scopeKey, props.workspaceId])

  const polish = async () => {
    if (request.current || props.disabled) return
    if (props.authRequired) {
      props.onAuthRequired?.()
      return
    }
    const input = (props.inputText ?? props.value).trim()
    if (!input) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    const original = props.value
    const snapshot = fingerprint(props)
    try {
      const result = await polishEntryPrompt(input, props.workspaceId, props.kind, {
        images: props.images,
        imageAssetIds: props.imageAssetIds,
        signal: controller.signal,
      })
      if (controller.signal.aborted || fingerprint(latest.current) !== snapshot || latest.current.disabled) return
      if (!result.trim()) throw new Error('AI 未返回可用的润色内容，请稍后重试')
      setHistory((items) => [...items, original])
      props.onChange(result)
    } catch (error) {
      if (!controller.signal.aborted && fingerprint(latest.current) === snapshot)
        showToast(error instanceof Error ? error.message : '润色失败，请稍后重试', 'error')
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }
  return (
    <span className={styles.actions}>
      {history.length > 0 && (
        <button
          type="button"
          className={styles.button}
          disabled={busy || props.disabled}
          onClick={() => {
            props.onChange(history[history.length - 1])
            setHistory((items) => items.slice(0, -1))
          }}
        >
          复原
        </button>
      )}
      <button
        type="button"
        className={styles.button}
        disabled={busy || props.disabled || !(props.inputText ?? props.value).trim()}
        aria-busy={busy}
        onClick={() => void polish()}
      >
        {busy ? '润色中…' : '我帮你写'}
      </button>
    </span>
  )
}
