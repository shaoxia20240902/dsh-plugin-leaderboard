import type { LeaderboardSnapshot } from './types.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * True when `value` has the three required boards.
 * @param value - parsed JSON
 */
export function looksLikeSnapshot(value: unknown): value is LeaderboardSnapshot {
  if (!isObject(value) || !isObject(value.boards)) return false
  return isObject(value.boards.hot) && isObject(value.boards.new) && isObject(value.boards.fire)
}

/** Options for the hosted catalog GET. */
export interface OriginFetchOptions {
  readonly signal?: AbortSignal
  readonly refresh?: boolean
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal
}

function resolveOptions(second?: AbortSignal | OriginFetchOptions): OriginFetchOptions {
  if (second === undefined) return {}
  if (isAbortSignal(second)) return { signal: second }
  return second
}

/**
 * Load a snapshot from the hosted MySQL API.
 * `refresh: true` asks the origin to sync GitHub under GET_LOCK; the
 * response is still the current (or just-written) MySQL snapshot.
 * @param originUrl - e.g. http://101.34.27.122:3091
 * @param signalOrOpts - abort signal, or `{ signal, refresh }`
 */
export async function fetchOriginSnapshot(
  originUrl: string,
  signalOrOpts?: AbortSignal | OriginFetchOptions,
): Promise<LeaderboardSnapshot> {
  const opts = resolveOptions(signalOrOpts)
  const base = originUrl.replace(/\/+$/u, '')
  const timeoutMs = opts.refresh === true ? 75_000 : 12_000
  const response = await fetch(`${base}/v1/leaderboard${opts.refresh === true ? '?refresh=1' : ''}`, {
    signal: opts.signal ?? AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`origin HTTP ${response.status}`)
  const payload: unknown = await response.json()
  if (!looksLikeSnapshot(payload)) throw new Error('origin payload is not a leaderboard snapshot')
  return payload
}
