import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSmartEntryDraft,
  clearSmartEntryDraftsForUser,
  loadSmartEntryDraft,
  saveSmartEntryDraft,
  setSmartEntryDraftScope,
} from '@/utils/smartEntryDraft'

beforeEach(() => {
  setSmartEntryDraftScope('', 0)
})

describe('SmartEntry session draft isolation', () => {
  it('isolates drafts by user and workspace', () => {
    setSmartEntryDraftScope('user-a', 21)
    saveSmartEntryDraft({ text: 'A / 21' })
    setSmartEntryDraftScope('user-a', 22)
    saveSmartEntryDraft({ text: 'A / 22' })
    setSmartEntryDraftScope('user-b', 21)
    saveSmartEntryDraft({ text: 'B / 21' })

    expect(loadSmartEntryDraft()?.text).toBe('B / 21')
    setSmartEntryDraftScope('user-a', 21)
    expect(loadSmartEntryDraft()?.text).toBe('A / 21')
    setSmartEntryDraftScope('user-a', 22)
    expect(loadSmartEntryDraft()?.text).toBe('A / 22')
  })

  it('clears only the current workspace when using the existing clear call', () => {
    setSmartEntryDraftScope('user-a', 21)
    saveSmartEntryDraft({ text: 'A / 21' })
    setSmartEntryDraftScope('user-a', 22)
    saveSmartEntryDraft({ text: 'A / 22' })

    clearSmartEntryDraft()

    expect(loadSmartEntryDraft()).toBeNull()
    setSmartEntryDraftScope('user-a', 21)
    expect(loadSmartEntryDraft()?.text).toBe('A / 21')
  })

  it('clears all workspaces for one logged-out account without touching another', () => {
    setSmartEntryDraftScope('user-a', 21)
    saveSmartEntryDraft({ text: 'A / 21' })
    setSmartEntryDraftScope('user-a', 22)
    saveSmartEntryDraft({ text: 'A / 22' })
    setSmartEntryDraftScope('user-b', 21)
    saveSmartEntryDraft({ text: 'B / 21' })

    clearSmartEntryDraftsForUser('user-a')

    setSmartEntryDraftScope('user-a', 21)
    expect(loadSmartEntryDraft()).toBeNull()
    setSmartEntryDraftScope('user-a', 22)
    expect(loadSmartEntryDraft()).toBeNull()
    setSmartEntryDraftScope('user-b', 21)
    expect(loadSmartEntryDraft()?.text).toBe('B / 21')
  })

  it('clears a user by exact scope without removing a prefixed account', () => {
    setSmartEntryDraftScope('a', 21)
    saveSmartEntryDraft({ text: 'user a' })
    setSmartEntryDraftScope('a_ws7', 21)
    saveSmartEntryDraft({ text: 'user a_ws7' })

    clearSmartEntryDraftsForUser('a')

    setSmartEntryDraftScope('a', 21)
    expect(loadSmartEntryDraft()).toBeNull()
    setSmartEntryDraftScope('a_ws7', 21)
    expect(loadSmartEntryDraft()?.text).toBe('user a_ws7')
  })

  it('deletes an ownerless legacy draft without assigning it to any session', () => {
    window.sessionStorage.setItem('zzh.smart-entry.draft', JSON.stringify({ text: 'ownerless legacy' }))
    setSmartEntryDraftScope('', 0)
    expect(loadSmartEntryDraft()).toBeNull()
    expect(window.sessionStorage.getItem('zzh.smart-entry.draft')).toBeNull()
    expect(window.sessionStorage.getItem('zzh.smart-entry.draft.v2_uanon_ws0')).toBeNull()

    window.sessionStorage.setItem('zzh.smart-entry.draft', JSON.stringify({ text: 'unowned legacy' }))
    setSmartEntryDraftScope('user-a', 21)
    expect(loadSmartEntryDraft()).toBeNull()
    expect(window.sessionStorage.getItem('zzh.smart-entry.draft')).toBeNull()
  })
})
