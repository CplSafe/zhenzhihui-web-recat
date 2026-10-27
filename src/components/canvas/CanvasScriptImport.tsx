import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from 'antd'
import {
  MAX_SCRIPT_IMPORT_BYTES,
  parseCanvasScriptImport,
  type CanvasScriptImport as ImportResult,
} from '@/utils/canvasScriptImport'
import styles from './CanvasGettingStarted.module.css'

export default function CanvasScriptImport({
  onClose,
  onImport,
}: {
  onClose: () => void
  onImport: (value: ImportResult) => void
}) {
  const [format, setFormat] = useState<'text' | 'storyboard'>('text')
  const [value, setValue] = useState('')
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const readVersion = useRef(0)
  useEffect(
    () => () => {
      readVersion.current++
    },
    [],
  )
  const preview = useMemo(() => {
    try {
      return { result: parseCanvasScriptImport(value, format), error: '' }
    } catch (error) {
      return { result: null, error: (error as Error).message }
    }
  }, [value, format])
  const close = () => {
    readVersion.current++
    onClose()
  }
  return (
    <Modal zIndex={1800} open title="导入文字或分镜" onCancel={close} width={720} footer={null} destroyOnClose>
      <div className={styles.importBody}>
        <p>内容先预览，确认后加入一个文本或分镜节点。导入不会调用 AI，也不会消耗生成积分。</p>
        <label>
          导入格式
          <select
            aria-label="导入格式"
            value={format}
            onChange={(event) => setFormat(event.target.value as 'text' | 'storyboard')}
          >
            <option value="text">普通文字</option>
            <option value="storyboard">分镜 JSON</option>
          </select>
        </label>
        <label className={styles.fileLabel}>
          选择文件（TXT / MD / JSON，1MB 以内）
          <input
            type="file"
            accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json"
            aria-label="选择导入文件"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              const version = ++readVersion.current
              setFileError('')
              setReading(false)
              if (!/\.(txt|md|markdown|json)$/i.test(file.name)) {
                setFileError('请选择 TXT、MD 或 JSON 文件')
                return
              }
              if (file.size > MAX_SCRIPT_IMPORT_BYTES) {
                setFileError('文件超过 1MB，请拆分后导入')
                return
              }
              setReading(true)
              try {
                const content = await file.text()
                if (version !== readVersion.current) return
                setValue(content)
                setFormat(/\.json$/i.test(file.name) ? 'storyboard' : 'text')
              } catch {
                if (version === readVersion.current) setFileError('文件读取失败，请重新选择或粘贴内容')
              } finally {
                if (version === readVersion.current) setReading(false)
              }
            }}
          />
        </label>
        <label>
          或粘贴内容
          <textarea
            aria-label="导入内容"
            value={value}
            rows={7}
            disabled={reading}
            onChange={(event) => {
              setValue(event.target.value)
              setFileError('')
            }}
            placeholder={
              format === 'text'
                ? '粘贴剧本、创作思路或已有文案'
                : '[{"title":"镜头一","prompt":"主体、场景和动作","duration":"4","shot":"推进"}]'
            }
          />
        </label>
        {format === 'storyboard' && (
          <p>
            支持镜头数组，或 storyboard / shots / scenes 数组。每个镜头须有 prompt（画面描述），可选
            title、duration、shot。
          </p>
        )}
        {(fileError || (value.trim() && preview.error)) && (
          <p role="alert" className={styles.error}>
            {fileError || preview.error}
          </p>
        )}
        {preview.result && !fileError && (
          <section className={styles.preview} aria-label="导入预览">
            <strong>
              {preview.result.shotCount
                ? `${preview.result.shotCount} 个镜头 · 确认后可继续编辑`
                : `${preview.result.text.length} 字 · 将保留原文`}
            </strong>
            <pre>
              {preview.result.shotCount
                ? JSON.parse(preview.result.text)
                    .map(
                      (shot: { title: string; prompt: string }, i: number) => `${i + 1}. ${shot.title}\n${shot.prompt}`,
                    )
                    .join('\n\n')
                : preview.result.text}
            </pre>
          </section>
        )}
        <div className={styles.footer}>
          <button type="button" aria-label="取消导入" onClick={close}>
            取消
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!preview.result || !!fileError || reading}
            onClick={() => {
              if (preview.result && !reading && !fileError) {
                onImport(preview.result)
                close()
              }
            }}
          >
            {reading ? '正在读取…' : '确认导入'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
