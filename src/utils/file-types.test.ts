import { describe, expect, it } from 'vitest'
import { wikiLinkTargetToUrl, wikiTargetToUrl } from './file-types'

describe('wikiTargetToUrl', () => {
  it('keeps a target that already has a recognised extension', () => {
    expect(wikiTargetToUrl('daily/2026-10-13-team-sync.md')).toBe('daily/2026-10-13-team-sync.md')
    expect(wikiTargetToUrl('diagram.mmd')).toBe('diagram.mmd')
  })

  it('appends .md to an extensionless target', () => {
    expect(wikiTargetToUrl('other-note')).toBe('other-note.md')
    expect(wikiTargetToUrl('daily/standup')).toBe('daily/standup.md')
  })

  it('leaves spaces and special characters untouched', () => {
    expect(wikiTargetToUrl('my notes/Q3 plan (draft).md')).toBe('my notes/Q3 plan (draft).md')
    expect(wikiTargetToUrl('my notes/Q3 plan')).toBe('my notes/Q3 plan.md')
  })
})

describe('wikiLinkTargetToUrl', () => {
  it('matches wikiTargetToUrl for plain targets', () => {
    expect(wikiLinkTargetToUrl('other-note')).toBe('other-note.md')
    expect(wikiLinkTargetToUrl('notes/a.md')).toBe('notes/a.md')
  })

  it('adds the extension before a heading anchor', () => {
    expect(wikiLinkTargetToUrl('page#heading')).toBe('page.md#heading')
    expect(wikiLinkTargetToUrl('page.md#heading')).toBe('page.md#heading')
  })

  it('preserves anchor-only and directory targets', () => {
    expect(wikiLinkTargetToUrl('#heading')).toBe('#heading')
    expect(wikiLinkTargetToUrl('entities/people/')).toBe('entities/people/')
    expect(wikiLinkTargetToUrl('entities/people/#top')).toBe('entities/people/#top')
  })
})
