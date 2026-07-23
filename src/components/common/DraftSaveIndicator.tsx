/**
 * DraftSaveIndicator — 创作草稿云端保存状态提示。
 * 将脏数据、保存中、已保存、版本冲突和失败状态统一映射为可访问文案，并为失败状态提供重试入口。
 */
import type { DraftSaveStatus } from '@/utils/creativeDraftPersistence'

/** 根据草稿持久化状态渲染轻量提示；空闲时不占据页面布局。 */
export default function DraftSaveIndicator({ status, onRetry }: { status: DraftSaveStatus; onRetry?: () => void }) {
  if (status === 'idle') return null
  const isFailure = status === 'error' || status === 'conflict'

  return (
    <div
      className={`creative-draft-save is-${status}`}
      role={isFailure ? 'alert' : 'status'}
      aria-live={isFailure ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className="creative-draft-save__dot" aria-hidden="true" />
      <span>
        {status === 'dirty'
          ? '等待保存…'
          : status === 'saving'
            ? '云端保存中…'
            : status === 'saved'
              ? '已保存到云端'
              : status === 'conflict'
                ? '其他页面已修改，未覆盖云端'
                : '云端保存失败'}
      </span>
      {status === 'error' && onRetry ? (
        <button type="button" className="creative-draft-save__retry" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  )
}
