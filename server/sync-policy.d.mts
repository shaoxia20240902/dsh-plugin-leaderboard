export const SYNC_LOCK: string
export const AUTO_INTERVAL_MS: number
export const MIN_MANUAL_INTERVAL_MS: number

export function decideSync(input: {
  readonly reason: 'cron' | 'manual' | 'force'
  readonly lastSyncMs: number
  readonly nowMs: number
  readonly autoMs?: number
  readonly manualMs?: number
}): 'run' | 'cooldown'
