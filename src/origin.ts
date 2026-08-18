import type { LeaderboardSnapshot } from './types.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function looksLikeSnapshot(value: unknown): value is LeaderboardSnapshot {
  if (!isObject(value) || !isObject(value.boards)) return false
  return isObject(value.boards.hot) && isObject(value.boards.new) && isObject(value.boards.fire)
}

/**
 * Load a snapshot from the hosted MySQL API.
 * @param originUrl - e.g. http://101.34.27.122:3091
 */
export async function fetchOriginSnapshot(
  originUrl: string,
  signal?: AbortSignal,
): Promise<LeaderboardSnapshot> {
  const base = originUrl.replace(/\/+$/u, '')
  const response = await fetch(`${base}/v1/leaderboard`, {
    signal: signal ?? AbortSignal.timeout(12_000),
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`origin HTTP ${response.status}`)
  const payload: unknown = await response.json()
  if (!looksLikeSnapshot(payload)) throw new Error('origin payload is not a leaderboard snapshot')
  return payload
}
