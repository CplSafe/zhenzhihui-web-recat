/**
 * 画布节点搜索。
 *
 * 画布铺开到几十上百个节点后，「我刚才那段提示词写在哪个节点上」只能靠缩小 + 肉眼扫。
 * 小地图解决的是「大概在哪一片」，这里解决的是「精确到哪一个」——两者互补，缺一个都不够。
 *
 * 只做定位不做筛选：命中后把视口移过去并选中该节点，画布本身不做任何过滤，
 * 避免用户搜完之后面对一张「东西都不见了」的画布。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './CanvasNodeSearch.module.css'

/** 参与搜索的最小节点信息，由调用方从画布状态里摘出来。 */
export interface CanvasSearchableNode {
  id: string
  kind: string
  /** 节点上可读的文字：文本内容或提示词 */
  text: string
  /** 类型中文名，用于结果行的副标题 */
  kindLabel: string
}

export interface CanvasNodeSearchProps {
  nodes: CanvasSearchableNode[]
  /** 选中某条结果：调用方负责把视口移过去并选中节点 */
  onPick: (nodeId: string) => void
  onClose: () => void
}

/** 单次最多展示的结果数：再多就该改搜索词，长列表本身也失去了定位的意义 */
const MAX_RESULTS = 30

export default function CanvasNodeSearch({ nodes, onPick, onClose }: CanvasNodeSearchProps) {
  const [keyword, setKeyword] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return []
    return nodes.filter((node) => node.text.toLowerCase().includes(needle)).slice(0, MAX_RESULTS)
  }, [keyword, nodes])

  // 结果集变化后把高亮拉回首条，否则会停在一个已经不存在的下标上
  useEffect(() => {
    setActiveIndex(0)
  }, [keyword])

  const pick = (index: number) => {
    const hit = results[index]
    if (hit) onPick(hit.id)
  }

  return (
    <div className={`${styles.panel} nodrag nopan`} role="dialog" aria-label="搜索画布节点">
      <div className={styles.inputRow}>
        <SearchIcon />
        <input
          ref={inputRef}
          className={styles.input}
          value={keyword}
          placeholder="搜索节点内容或提示词"
          aria-label="搜索节点内容或提示词"
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              pick(activeIndex)
              return
            }
            // 上下键在结果间移动，不用把手从键盘挪到鼠标
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (!results.length) return
              const delta = event.key === 'ArrowDown' ? 1 : -1
              setActiveIndex((current) => (current + delta + results.length) % results.length)
            }
          }}
        />
        <button type="button" className={styles.close} onClick={onClose} aria-label="关闭搜索">
          ✕
        </button>
      </div>

      {keyword.trim() && (
        <div className={styles.results} role="listbox" aria-label="搜索结果">
          {results.length === 0 ? (
            <p className={styles.empty}>没有匹配的节点</p>
          ) : (
            results.map((node, index) => (
              <button
                type="button"
                key={node.id}
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.item} ${index === activeIndex ? styles.itemActive : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(index)}
              >
                <span className={styles.itemKind}>{node.kindLabel}</span>
                <span className={styles.itemText}>{node.text}</span>
              </button>
            ))
          )}
          {results.length === MAX_RESULTS && (
            // 截断必须说出来，否则「找不到」会被误判成「不存在」
            <p className={styles.more}>只显示前 {MAX_RESULTS} 条，请补充关键词</p>
          )}
        </div>
      )}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      className={styles.searchIcon}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  )
}
