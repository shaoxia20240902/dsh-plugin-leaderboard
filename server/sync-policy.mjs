/**
 * Sync cadence and lock name for the hosted catalog.
 * Cron waits 30 minutes after the last successful write; a manual
 * refresh may run sooner, but not more than once per two minutes.
 */

export const SYNC_LOCK = 'dsh_plugin_board_sync'
export const AUTO_INTERVAL_MS = 30 * 60 * 1000
export const MIN_MANUAL_INTERVAL_MS = 2 * 60 * 1000

/**
 * Decide whether this process should hit GitHub.
 * @param {{
 *   reason: 'cron' | 'manual' | 'force'
 *   lastSyncMs: number
 *   nowMs: number
 *   autoMs?: number
 *   manualMs?: number
 * }} input
 * @returns {'run' | 'cooldown'}
 */
export function decideSync(input) {
  if (input.reason === 'force' || input.lastSyncMs <= 0) return 'run'
  const age = input.nowMs - input.lastSyncMs
  const autoMs = input.autoMs ?? AUTO_INTERVAL_MS
  const manualMs = input.manualMs ?? MIN_MANUAL_INTERVAL_MS
  if (input.reason === 'cron' && age < autoMs) return 'cooldown'
  if (input.reason === 'manual' && age < manualMs) return 'cooldown'
  return 'run'
}
