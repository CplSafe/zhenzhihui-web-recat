/**
 * CreativeTopbar — 创意页顶部步骤进度条
 * 展示当前步骤序号和进度，支持步骤间导航。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import './CreativeTopbar.css'

interface CreativeTopbarProps {
  activeStep?: string
  maxStepIndex?: number
  disableSaveDraft?: boolean
  projectName?: string
  canRename?: boolean
  onSaveDraft?: () => void
  onOpenDrafts?: () => void
  onRedraw?: () => void
  onSwitchStep?: (step: string) => void
  onRename?: (name: string) => void | Promise<unknown>
}

const stepOrder = ['script', 'storyboard', 'timeline', 'video']

export default function CreativeTopbar({
  activeStep = 'script',
  maxStepIndex = 0,
  disableSaveDraft = false,
  projectName = '',
  canRename = false,
  onSaveDraft,
  onOpenDrafts,
  onRedraw,
  onSwitchStep,
  onRename,
}: CreativeTopbarProps) {
  const activeStepIndex = useMemo(() => stepOrder.indexOf(activeStep), [activeStep])
  const displayProjectName = useMemo(
    () => String(projectName || '').trim() || '未命名项目',
    [projectName],
  )

  // ── 项目名行内编辑 ──
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  function startRename() {
    if (!canRename || !onRename) return
    setNameDraft(displayProjectName)
    setEditingName(true)
  }

  function cancelRename() {
    setEditingName(false)
  }

  function commitRename() {
    if (!editingName) return
    setEditingName(false)
    const next = nameDraft.trim()
    if (!next || next === displayProjectName) return
    onRename?.(next)
  }

  // 进入编辑态后自动聚焦并选中文本
  useEffect(() => {
    if (editingName) {
      const el = nameInputRef.current
      el?.focus()
      el?.select()
    }
  }, [editingName])

  function canSelectStep(step: string) {
    const targetIndex = stepOrder.indexOf(step)
    if (targetIndex === -1) return false
    return targetIndex <= Math.max(activeStepIndex, maxStepIndex)
  }

  function selectStep(step: string) {
    if (!canSelectStep(step)) {
      return
    }
    onSwitchStep?.(step)
  }

  function handleStepKeydown(step: string, event: React.KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectStep(step)
      return
    }
    const currentIndex = stepOrder.indexOf(step)
    if (event.key === 'ArrowLeft' && currentIndex > 0) {
      event.preventDefault()
      const prev = stepOrder[currentIndex - 1]
      const el = document.querySelector<HTMLElement>(`[data-step="${prev}"]`)
      el?.focus()
    }
    if (event.key === 'ArrowRight' && currentIndex < stepOrder.length - 1) {
      event.preventDefault()
      const next = stepOrder[currentIndex + 1]
      const el = document.querySelector<HTMLElement>(`[data-step="${next}"]`)
      el?.focus()
    }
  }

  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  function toggleMore() {
    setMoreOpen((v) => !v)
  }

  function closeMore() {
    setMoreOpen(false)
  }

  useEffect(() => {
    function onGlobalPointerDown(e: PointerEvent) {
      if (!moreOpen) return
      const el = moreRef.current
      if (!el) return
      if (el.contains(e.target as Node)) return
      closeMore()
    }

    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && moreOpen) closeMore()
    }

    window.addEventListener('pointerdown', onGlobalPointerDown, true)
    window.addEventListener('keydown', onKeydown, true)
    return () => {
      window.removeEventListener('pointerdown', onGlobalPointerDown, true)
      window.removeEventListener('keydown', onKeydown, true)
    }
  }, [moreOpen])

  function openDrafts() {
    onOpenDrafts?.()
    closeMore()
  }

  function redraw() {
    onRedraw?.()
    closeMore()
  }

  function saveDraft() {
    if (disableSaveDraft) return
    onSaveDraft?.()
    closeMore()
  }

  return (
    <header className="topbar" aria-label="顶部信息栏">
      <div className="project-name">
        <span>项目</span>
        <b>/</b>
        {editingName ? (
          <input
            ref={nameInputRef}
            className="project-name-input"
            value={nameDraft}
            maxLength={60}
            aria-label="编辑项目名称"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelRename()
              }
            }}
          />
        ) : (
          <em
            title={canRename ? '点击重命名' : displayProjectName}
            className={canRename ? 'is-editable' : ''}
            onClick={startRename}
          >
            {displayProjectName}
          </em>
        )}
        {canRename && !editingName && (
          <button
            type="button"
            className="project-name-edit"
            aria-label="重命名项目"
            onClick={startRename}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M6.41667 1.75C6.57136 1.75002 6.71971 1.81149 6.82909 1.92089C6.93846 2.03028 6.99991 2.17864 6.99991 2.33333C6.99991 2.48803 6.93846 2.63639 6.82909 2.74578C6.71971 2.85517 6.57136 2.91664 6.41667 2.91667H2.91667V11.0833H11.0833V7.58333L11.0874 7.51508C11.105 7.36744 11.1783 7.23208 11.2923 7.13665C11.4063 7.04123 11.5524 6.99294 11.7009 7.00165C11.8493 7.01036 11.9888 7.07542 12.0908 7.18354C12.1929 7.29165 12.2498 7.43465 12.25 7.58333V11.0833C12.25 11.3928 12.1271 11.6895 11.9083 11.9083C11.6895 12.1271 11.3928 12.25 11.0833 12.25H2.91667C2.60725 12.25 2.3105 12.1271 2.09171 11.9083C1.87292 11.6895 1.75 11.3928 1.75 11.0833V2.91667C1.75 2.60725 1.87292 2.3105 2.09171 2.09171C2.3105 1.87292 2.60725 1.75 2.91667 1.75H6.41667ZM12.0867 1.92092C12.196 2.03031 12.2575 2.17865 12.2575 2.33333C12.2575 2.48801 12.196 2.63636 12.0867 2.74575L6.72467 8.10833C6.61465 8.21459 6.4673 8.27339 6.31435 8.27206C6.1614 8.27073 6.01509 8.20938 5.90694 8.10123C5.79878 7.99307 5.73744 7.84677 5.73611 7.69382C5.73478 7.54087 5.79357 7.39352 5.89983 7.2835L11.2618 1.9215C11.3712 1.81214 11.5196 1.75071 11.6742 1.75071C11.8289 1.75071 11.9773 1.81214 12.0867 1.9215V1.92092Z"
                fill="#666666"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="flow" aria-label="创作流程">
        <span className="flow-track"></span>
        <span
          className={[
            'flow-fill',
            activeStep === 'storyboard' ? 'is-storyboard' : '',
            activeStep === 'timeline' ? 'is-timeline' : '',
            activeStep === 'video' ? 'is-video' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        ></span>
        <span
          className={[
            'flow-dot first',
            activeStep === 'script' ? 'active' : '',
            ['storyboard', 'timeline', 'video'].includes(activeStep) ? 'done' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="10" fill="#5B6BE8" />
            <circle cx="10" cy="10" r="11" stroke="white" strokeOpacity="0.6" strokeWidth="2" />
            <path
              d="M9.98286 13.8625H10.972C11.2523 13.8625 11.4057 14.0167 11.4057 14.3004C11.4057 14.543 11.4126 14.7855 11.3791 15.0221C11.3414 15.2765 11.2182 15.5105 11.0299 15.6857C10.8416 15.861 10.5993 15.9669 10.3429 15.9863C10.0669 16.0099 9.78926 16.003 9.51486 15.9658C8.97486 15.8912 8.56686 15.4061 8.55314 14.8601C8.54647 14.6648 8.54647 14.4692 8.55314 14.2739C8.56 14.0313 8.71343 13.8693 8.95429 13.8693C9.29457 13.8625 9.64171 13.8625 9.98286 13.8625ZM9.61686 4.85623V4.41826C9.61686 4.17485 9.77714 4.00686 9.99743 4C10.2177 4 10.3849 4.16885 10.3849 4.4114V5.30105C10.3849 5.54361 10.2177 5.71245 9.99743 5.71245C9.77714 5.71245 9.61686 5.53675 9.61 5.2942C9.61686 5.15278 9.61686 5.0045 9.61686 4.85623ZM4.84771 10.465H4.40029C4.174 10.4581 4 10.2961 4 10.0802C4 9.85731 4.16714 9.68933 4.40029 9.68933H5.28229C5.51629 9.68933 5.68943 9.85817 5.68943 10.0802C5.68943 10.303 5.51629 10.465 5.28229 10.4718C5.14171 10.465 4.99514 10.465 4.84771 10.465ZM15.1523 10.465H14.7049C14.6011 10.465 14.5016 10.4238 14.4282 10.3504C14.3548 10.277 14.3136 10.1775 14.3136 10.0737C14.3136 9.96996 14.3548 9.87044 14.4282 9.79707C14.5016 9.72369 14.6011 9.68247 14.7049 9.68247C15.0049 9.67647 15.2989 9.67647 15.5997 9.68247C15.826 9.68247 16 9.85131 16 10.0673C16 10.2901 15.8329 10.4581 15.5997 10.465H15.1523ZM6.64429 7.10779C6.59114 7.08036 6.49086 7.05379 6.41714 6.98608C6.19187 6.77115 5.97153 6.5511 5.75629 6.32613C5.72018 6.29013 5.69166 6.24726 5.67241 6.20005C5.65316 6.15284 5.64357 6.10225 5.64421 6.05127C5.64485 6.00029 5.65571 5.94996 5.67613 5.90324C5.69656 5.85653 5.72615 5.81439 5.76314 5.77931C5.79834 5.74339 5.84035 5.71485 5.88671 5.69537C5.93307 5.67589 5.98285 5.66586 6.03314 5.66586C6.08343 5.66586 6.13321 5.67589 6.17958 5.69537C6.22594 5.71485 6.26795 5.74339 6.30314 5.77931C6.52429 5.99529 6.74457 6.21813 6.958 6.44783C7.078 6.56782 7.09857 6.71696 7.02486 6.87809C6.96486 7.02036 6.84486 7.09407 6.64429 7.10779ZM13.93 5.66531C14.1237 5.67817 14.2437 5.73902 14.3106 5.88044C14.3843 6.02272 14.3843 6.17699 14.2771 6.29184C14.0431 6.54897 13.8031 6.79067 13.5486 7.02722C13.4089 7.16178 13.1757 7.1275 13.048 6.99294C12.9083 6.84466 12.8886 6.62268 13.0283 6.4744C13.2554 6.23099 13.4894 5.99529 13.7294 5.76645C13.7894 5.7056 13.8837 5.68503 13.93 5.66531ZM6.63743 13.0328C6.838 13.0465 6.958 13.1142 7.03171 13.2625C7.09857 13.4108 7.09171 13.5591 6.98457 13.6739C6.75829 13.9225 6.51743 14.159 6.27743 14.3879C6.13 14.5301 5.90286 14.5027 5.76314 14.3613C5.62257 14.213 5.60286 13.9842 5.74943 13.829C5.96971 13.5925 6.19686 13.3636 6.43771 13.1408C6.49086 13.0808 6.59114 13.0534 6.63743 13.0328ZM13.3754 13.0328C13.4294 13.0671 13.5357 13.1014 13.6026 13.1682C13.8169 13.3705 14.0226 13.5856 14.23 13.7948C14.3971 13.9705 14.3971 14.2062 14.2369 14.3613C14.0834 14.5156 13.8494 14.5096 13.6831 14.3476L13.042 13.7005C12.9855 13.6458 12.9479 13.5745 12.9347 13.497C12.9214 13.4195 12.9332 13.3397 12.9683 13.2694C13.042 13.1211 13.1689 13.0465 13.3754 13.0328ZM13.3891 9.73047C13.2143 7.7146 11.3191 6.27813 9.36229 6.64839C7.96 6.91837 6.88514 8.00344 6.598 9.4322C6.33057 10.7804 6.93229 12.2032 8.10657 12.9788C8.194 13.0388 8.314 13.0731 8.42029 13.0731C8.93457 13.08 9.45571 13.08 9.97 13.08C10.4843 13.08 11.0054 13.086 11.5189 13.08C11.6191 13.08 11.7331 13.0594 11.8129 13.0054C12.9683 12.2169 13.5091 11.1249 13.3891 9.72961V9.73047ZM9.58857 8.98823C9.27486 9.13651 9.05457 9.36535 8.914 9.68247C8.84029 9.86503 8.65343 9.93959 8.47343 9.89845C8.30629 9.85817 8.18629 9.70304 8.18629 9.49391C8.19314 9.4742 8.19314 9.4202 8.21286 9.37306C8.30498 9.13053 8.4454 8.90923 8.62559 8.72256C8.80578 8.5359 9.022 8.38777 9.26114 8.28714C9.35258 8.24617 9.4565 8.243 9.55027 8.27832C9.64403 8.31364 9.72004 8.38458 9.76171 8.47569C9.856 8.66425 9.78914 8.90081 9.58857 8.98823Z"
              fill="white"
            />
          </svg>
        </span>
        <span
          className={[
            'flow-dot second',
            activeStep === 'storyboard' ? 'active' : '',
            ['timeline', 'video'].includes(activeStep) ? 'done' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="10" fill="#D5DAFF" />
            <path
              d="M7.92316 9.38824C8.13447 9.38824 8.31448 9.46274 8.46318 9.61176C8.61188 9.76078 8.68623 9.94118 8.68623 10.1529C8.68623 10.3569 8.61188 10.5353 8.46318 10.6882C8.31448 10.8412 8.13447 10.9176 7.92316 10.9176C7.71185 10.9176 7.53184 10.8412 7.38314 10.6882C7.23444 10.5353 7.16009 10.3569 7.16009 10.1529C7.16009 9.94118 7.23444 9.76078 7.38314 9.61176C7.53184 9.46274 7.71185 9.38824 7.92316 9.38824ZM13.8399 5C14.1843 5 14.4895 5.06078 14.7556 5.18235C15.0217 5.30392 15.2467 5.46078 15.4306 5.65294C15.6145 5.8451 15.7554 6.06275 15.8533 6.30588C15.9511 6.54902 16 6.78824 16 7.02353V13.0353C16 13.2157 15.9589 13.3922 15.8767 13.5647C15.7946 13.7373 15.685 13.8941 15.548 14.0353C15.4111 14.1765 15.2545 14.2902 15.0784 14.3765C14.9023 14.4627 14.7204 14.5059 14.5326 14.5059V7.92941C14.5326 7.72549 14.4934 7.53529 14.4152 7.35882C14.3369 7.18235 14.2312 7.02745 14.0982 6.89412C13.9651 6.76078 13.8106 6.6549 13.6345 6.57647C13.4584 6.49804 13.2686 6.45882 13.0651 6.45882H6.46745C6.46745 6.28627 6.50658 6.11373 6.58485 5.94118C6.66311 5.76863 6.76877 5.61176 6.90181 5.47059C7.03486 5.32941 7.19139 5.21569 7.3714 5.12941C7.55141 5.04314 7.74315 5 7.94664 5H13.8399ZM12.8186 7.2C13.1708 7.2 13.4212 7.29608 13.5699 7.48824C13.7186 7.68039 13.793 7.93725 13.793 8.25882V15.1882C13.793 15.3843 13.7108 15.5686 13.5464 15.7412C13.3821 15.9137 13.1747 16 12.9242 16H5.81003C5.59872 16 5.41089 15.9137 5.24653 15.7412C5.08218 15.5686 5 15.3608 5 15.1176V8.05882C5 7.80784 5.06848 7.60196 5.20544 7.44118C5.3424 7.28039 5.52437 7.2 5.75133 7.2H12.8186ZM12.3372 8.98824C12.3372 8.90196 12.3099 8.83137 12.2551 8.77647C12.2003 8.72157 12.1298 8.69412 12.0438 8.69412H6.7492C6.66311 8.69412 6.59267 8.72157 6.53789 8.77647C6.4831 8.83137 6.45571 8.90196 6.45571 8.98824V11.6118C6.52615 11.698 6.59071 11.7941 6.64941 11.9C6.70811 12.0059 6.78051 12.1059 6.8666 12.2C6.95269 12.2941 7.06617 12.3745 7.20704 12.4412C7.34792 12.5078 7.54358 12.5412 7.79402 12.5412C8.16186 12.5412 8.46122 12.4824 8.6921 12.3647C8.92298 12.2471 9.12647 12.098 9.30256 11.9176C9.47866 11.7373 9.64301 11.5431 9.79562 11.3353C9.94824 11.1275 10.1302 10.9314 10.3415 10.7471C10.5528 10.5627 10.815 10.4059 11.1281 10.2765C11.4411 10.1471 11.8442 10.0745 12.3372 10.0588V8.98824Z"
              fill="white"
            />
          </svg>
        </span>
        <span
          className={[
            'flow-dot third',
            activeStep === 'timeline' ? 'active' : '',
            activeStep === 'video' ? 'done' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="10" fill="#D5DAFF" />
            <path
              d="M16.3488 7.66667H6.2559C6.0832 7.66667 5.91758 7.59643 5.79546 7.4714C5.67335 7.34638 5.60474 7.17681 5.60474 7C5.60474 6.82319 5.67335 6.65362 5.79546 6.5286C5.91758 6.40357 6.0832 6.33333 6.2559 6.33333H16.3488C16.5215 6.33333 16.6872 6.40357 16.8093 6.5286C16.9314 6.65362 17 6.82319 17 7C17 7.17681 16.9314 7.34638 16.8093 7.4714C16.6872 7.59643 16.5215 7.66667 16.3488 7.66667ZM4.95358 12.3333C4.95318 12.5395 4.89034 12.7405 4.77372 12.9086C4.6571 13.0767 4.49245 13.2037 4.30243 13.272V14.6667C4.30243 14.7551 4.26812 14.8399 4.20707 14.9024C4.14601 14.9649 4.0632 15 3.97685 15C3.8905 15 3.80769 14.9649 3.74663 14.9024C3.68557 14.8399 3.65127 14.7551 3.65127 14.6667V13.272C3.46099 13.204 3.29608 13.0771 3.17938 12.9089C3.06269 12.7407 3 12.5395 3 12.3332C3 12.1268 3.06269 11.9256 3.17938 11.7574C3.29608 11.5892 3.46099 11.4623 3.65127 11.3943V7.93867C3.4611 7.87063 3.29631 7.74373 3.17971 7.57556C3.0631 7.40738 3.00047 7.20624 3.00047 7C3.00047 6.79376 3.0631 6.59262 3.17971 6.42444C3.29631 6.25627 3.4611 6.12937 3.65127 6.06133V5.33333C3.65127 5.24493 3.68557 5.16014 3.74663 5.09763C3.80769 5.03512 3.8905 5 3.97685 5C4.0632 5 4.14601 5.03512 4.20707 5.09763C4.26812 5.16014 4.30243 5.24493 4.30243 5.33333V6.06133C4.49259 6.12937 4.65739 6.25627 4.77399 6.42444C4.89059 6.59262 4.95323 6.79376 4.95323 7C4.95323 7.20624 4.89059 7.40738 4.77399 7.57556C4.65739 7.74373 4.49259 7.87063 4.30243 7.93867V11.3947C4.49245 11.463 4.6571 11.5899 4.77372 11.758C4.89034 11.9262 4.95318 12.1271 4.95358 12.3333ZM6.2559 8.33333H11.7907C11.9634 8.33333 12.1291 8.40357 12.2512 8.5286C12.3733 8.65362 12.4419 8.82319 12.4419 9C12.4419 9.17681 12.3733 9.34638 12.2512 9.4714C12.1291 9.59643 11.9634 9.66667 11.7907 9.66667H6.2559C6.0832 9.66667 5.91758 9.59643 5.79546 9.4714C5.67335 9.34638 5.60474 9.17681 5.60474 9C5.60474 8.82319 5.67335 8.65362 5.79546 8.5286C5.91758 8.40357 6.0832 8.33333 6.2559 8.33333ZM6.2559 11.6667H16.3488C16.5215 11.6667 16.6871 11.7369 16.8092 11.862C16.9313 11.987 16.9999 12.1565 16.9999 12.3333C16.9999 12.5101 16.9313 12.6797 16.8092 12.8047C16.6871 12.9297 16.5215 13 16.3488 13H6.2559C6.08322 13 5.91761 12.9297 5.79551 12.8047C5.67341 12.6797 5.60482 12.5101 5.60482 12.3333C5.60482 12.1565 5.67341 11.987 5.79551 11.862C5.91761 11.7369 6.08322 11.6667 6.2559 11.6667ZM6.2559 13.6667H11.7907C11.9634 13.6667 12.129 13.7369 12.2511 13.862C12.3732 13.987 12.4418 14.1565 12.4418 14.3333C12.4418 14.5101 12.3732 14.6797 12.2511 14.8047C12.129 14.9297 11.9634 15 11.7907 15H6.2559C6.08322 15 5.91761 14.9297 5.79551 14.8047C5.67341 14.6797 5.60482 14.5101 5.60482 14.3333C5.60482 14.1565 5.67341 13.987 5.79551 13.862C5.91761 13.7369 6.08322 13.6667 6.2559 13.6667Z"
              fill="white"
            />
          </svg>
        </span>
        <span
          className={['flow-dot fourth', activeStep === 'video' ? 'active' : ''].filter(Boolean).join(' ')}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="10" fill="#D5DAFF" />
            <g transform="translate(4 4)">
              <path
                d="M6 0C7.98873 0.0272282 9.63509 0.372954 10.6172 1.38281C11.627 2.36491 11.9728 4.01127 12 6C11.9728 7.98873 11.627 9.63509 10.6172 10.6172C9.63509 11.627 7.98873 11.9728 6 12C4.01127 11.9728 2.36491 11.627 1.38281 10.6172C0.372954 9.63509 0.0272282 7.98873 0 6C0.0272282 4.01127 0.372954 2.36491 1.38281 1.38281C2.36491 0.372954 4.01127 0.0272282 6 0ZM4.94238 3.63379C4.52138 3.39961 4.00391 3.70368 4.00391 4.18555V7.81348C4.00399 8.29524 4.52143 8.59929 4.94238 8.36523L8.20215 6.55176C8.63485 6.31086 8.63485 5.68816 8.20215 5.44727L4.94238 3.63379Z"
                fill="white"
              />
            </g>
          </svg>
        </span>
        <button
          type="button"
          className={[
            'flow-label flow-label-button first',
            ['script', 'storyboard', 'timeline', 'video'].includes(activeStep) ? 'active' : '',
            !canSelectStep('script') ? 'is-disabled' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={!canSelectStep('script')}
          aria-current={activeStep === 'script' ? 'step' : undefined}
          aria-label="创意脚本步骤"
          data-step="script"
          onClick={() => selectStep('script')}
          onKeyDown={(e) => handleStepKeydown('script', e)}
        >
          创意脚本
        </button>
        <button
          type="button"
          className={[
            'flow-label flow-label-button second',
            ['storyboard', 'timeline', 'video'].includes(activeStep) ? 'active' : '',
            !canSelectStep('storyboard') ? 'is-disabled' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-current={activeStep === 'storyboard' ? 'step' : undefined}
          aria-label="分镜图片步骤"
          data-step="storyboard"
          onKeyDown={(e) => handleStepKeydown('storyboard', e)}
          disabled={!canSelectStep('storyboard')}
          onClick={() => selectStep('storyboard')}
        >
          分镜图片
        </button>
        <button
          type="button"
          className={[
            'flow-label flow-label-button third',
            ['timeline', 'video'].includes(activeStep) ? 'active' : '',
            !canSelectStep('timeline') ? 'is-disabled' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={!canSelectStep('timeline')}
          aria-current={activeStep === 'timeline' ? 'step' : undefined}
          aria-label="镜头编排步骤"
          data-step="timeline"
          onKeyDown={(e) => handleStepKeydown('timeline', e)}
          onClick={() => selectStep('timeline')}
        >
          镜头编排
        </button>
        <button
          type="button"
          className={[
            'flow-label flow-label-button fourth',
            activeStep === 'video' ? 'active' : '',
            !canSelectStep('video') ? 'is-disabled' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={!canSelectStep('video')}
          aria-current={activeStep === 'video' ? 'step' : undefined}
          aria-label="视频生成步骤"
          data-step="video"
          onKeyDown={(e) => handleStepKeydown('video', e)}
          onClick={() => selectStep('video')}
        >
          视频生成
        </button>
        <button
          type="button"
          className="flow-dot-button first"
          aria-label="切换到创意脚本"
          disabled={!canSelectStep('script')}
          onClick={() => selectStep('script')}
        ></button>
        <button
          type="button"
          className="flow-dot-button second"
          aria-label="切换到分镜图片"
          disabled={!canSelectStep('storyboard')}
          onClick={() => selectStep('storyboard')}
        ></button>
        <button
          type="button"
          className="flow-dot-button third"
          aria-label="切换到镜头编排"
          disabled={!canSelectStep('timeline')}
          onClick={() => selectStep('timeline')}
        ></button>
        <button
          type="button"
          className="flow-dot-button fourth"
          aria-label="切换到视频生成"
          disabled={!canSelectStep('video')}
          onClick={() => selectStep('video')}
        ></button>
      </div>

      <div ref={moreRef} className="topbar-more">
        <button
          type="button"
          className="topbar-more-btn"
          aria-label="更多操作"
          aria-expanded={moreOpen}
          onClick={toggleMore}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="4.5" r="1.4" />
            <circle cx="10" cy="10" r="1.4" />
            <circle cx="10" cy="15.5" r="1.4" />
          </svg>
        </button>
        {moreOpen && (
          <div className="topbar-more-menu" role="menu" aria-label="更多操作菜单">
            <button type="button" className="topbar-more-item" role="menuitem" onClick={openDrafts}>
              历史草稿
            </button>
            <button type="button" className="topbar-more-item" role="menuitem" onClick={redraw}>
              重新绘制
            </button>
            <button
              type="button"
              className="topbar-more-item"
              role="menuitem"
              disabled={disableSaveDraft}
              onClick={saveDraft}
            >
              保存草稿
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
