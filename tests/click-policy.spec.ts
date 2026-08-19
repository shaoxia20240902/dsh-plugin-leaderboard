import { describe, expect, it } from 'vitest'
import { CLICK_WINDOW_MS, decideClick, parseClickKind } from '../server/click-policy.mjs'

describe('parseClickKind', () => {
  it('accepts install / interpret / recommend aliases', () => {
    expect(parseClickKind('copy')).toBe('install')
    expect(parseClickKind('download')).toBe('install')
    expect(parseClickKind('explain')).toBe('interpret')
    expect(parseClickKind('rec')).toBe('recommend')
    expect(parseClickKind('nope')).toBe('')
  })
})

describe('decideClick', () => {
  const now = Date.parse('2026-08-19T12:00:00.000Z')

  it('counts the first click and cools down for 15 minutes', () => {
    expect(decideClick(0, now)).toBe('count')
    expect(decideClick(now - CLICK_WINDOW_MS + 1, now)).toBe('cooldown')
    expect(decideClick(now - CLICK_WINDOW_MS, now)).toBe('count')
  })
})
