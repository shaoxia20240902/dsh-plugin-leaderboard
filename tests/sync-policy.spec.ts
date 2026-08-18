import { describe, expect, it } from 'vitest'
import { AUTO_INTERVAL_MS, MIN_MANUAL_INTERVAL_MS, decideSync } from '../server/sync-policy.mjs'

const NOW = Date.parse('2026-08-19T12:00:00.000Z')

describe('decideSync', () => {
  it('runs when there is no previous snapshot', () => {
    expect(decideSync({ reason: 'cron', lastSyncMs: 0, nowMs: NOW })).toBe('run')
    expect(decideSync({ reason: 'manual', lastSyncMs: 0, nowMs: NOW })).toBe('run')
  })

  it('lets force bypass the cooldown', () => {
    expect(decideSync({
      reason: 'force',
      lastSyncMs: NOW - 1_000,
      nowMs: NOW,
    })).toBe('run')
  })

  it('keeps cron quiet for 30 minutes after a write', () => {
    expect(decideSync({
      reason: 'cron',
      lastSyncMs: NOW - AUTO_INTERVAL_MS + 1,
      nowMs: NOW,
    })).toBe('cooldown')
    expect(decideSync({
      reason: 'cron',
      lastSyncMs: NOW - AUTO_INTERVAL_MS,
      nowMs: NOW,
    })).toBe('run')
  })

  it('lets a user refresh after two minutes', () => {
    expect(decideSync({
      reason: 'manual',
      lastSyncMs: NOW - MIN_MANUAL_INTERVAL_MS + 1,
      nowMs: NOW,
    })).toBe('cooldown')
    expect(decideSync({
      reason: 'manual',
      lastSyncMs: NOW - MIN_MANUAL_INTERVAL_MS,
      nowMs: NOW,
    })).toBe('run')
  })
})
