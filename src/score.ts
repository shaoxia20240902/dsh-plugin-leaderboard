import type { PluginRepo } from './types.ts'

const MS_PER_DAY = 86_400_000

const RELEVANCE_NEEDLES = [
  'dsh-plugin', 'deepseek-harness', 'deepseek harness', 'dsh ', ' dsh', '/dsh',
  'cordis', 'harness plugin',
] as const

export function daysSince(iso: string, nowMs: number): number {
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return 365
  return Math.max((nowMs - stamp) / MS_PER_DAY, 0)
}

function log1p(value: number): number {
  return Math.log(1 + Math.max(0, value))
}

/**
 * 1 when updated today, ~0.5 after three weeks, ~0.1 after half a year.
 */
export function freshness(updatedAt: string, nowMs: number): number {
  return 1 / (1 + daysSince(updatedAt, nowMs) / 21)
}

/**
 * 0..1: how clearly this repo looks like a real DeepSeek Harness plugin
 * rather than an unrelated project that only added the topic.
 */
export function relevance(repo: Pick<PluginRepo, 'fullName' | 'description' | 'name'>): number {
  const text = `${repo.fullName} ${repo.name} ${repo.description}`.toLowerCase()
  let hits = 0
  if (/(^|[^a-z])dsh([^a-z]|$)/u.test(text) || text.includes('dsh-')) hits += 1
  for (const needle of RELEVANCE_NEEDLES) {
    if (text.includes(needle)) hits += 1
  }
  return Math.min(1, hits / 2)
}

/**
 * 最热: long-run influence, not raw stars.
 * Log-compress stars/forks so 100k cannot bury everything, reward repos
 * that are still maintained, and nudge true DSH plugins above topic-spam.
 */
export function hotScore(repo: PluginRepo, nowMs: number): number {
  const popularity = log1p(repo.stars) + 0.55 * log1p(repo.forks)
  const maintain = 0.6 * freshness(repo.updatedAt, nowMs)
  const rel = 0.4 * relevance(repo)
  const stale = daysSince(repo.updatedAt, nowMs) > 180 ? 0.25 : 0
  return popularity + maintain + rel - stale
}

/**
 * 最新: new-and-notable. Recency of *creation* is the spine, but a same-week
 * repo with real stars beats an empty shell created an hour ago.
 */
export function newScore(repo: PluginRepo, nowMs: number): number {
  const recency = 1 / (1 + daysSince(repo.createdAt, nowMs) / 6)
  const traction = 1 + 0.9 * log1p(repo.stars) + 0.28 * log1p(repo.forks)
  return recency ** 1.8 * traction * (1 + 0.22 * relevance(repo))
}

/**
 * 最火: outbreak velocity (HN-style gravity) × recent motion × relevance.
 * A week-old 80-star plugin outruns a year-old 200-star repo that went quiet.
 */
export function fireScore(repo: PluginRepo, nowMs: number): number {
  const ageDays = Math.max(daysSince(repo.createdAt, nowMs), 0.25)
  const velocity = (repo.stars + 0.65 * repo.forks) / (ageDays + 2) ** 1.55
  return velocity * (1 + 1.2 * freshness(repo.updatedAt, nowMs)) * (1 + 0.28 * relevance(repo))
}

/** Backward-compatible alias used by older tests and stored `heat`. */
export function heatScore(repo: PluginRepo, nowMs: number): number {
  return fireScore(repo, nowMs)
}

function byName(left: PluginRepo, right: PluginRepo): number {
  return left.fullName.localeCompare(right.fullName)
}

export function compareHot(left: PluginRepo, right: PluginRepo, nowMs: number): number {
  return hotScore(right, nowMs) - hotScore(left, nowMs) || right.stars - left.stars || byName(left, right)
}

export function compareNew(left: PluginRepo, right: PluginRepo, nowMs: number): number {
  return newScore(right, nowMs) - newScore(left, nowMs)
    || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || byName(left, right)
}

export function compareFire(left: PluginRepo, right: PluginRepo, nowMs: number): number {
  return fireScore(right, nowMs) - fireScore(left, nowMs) || right.stars - left.stars || byName(left, right)
}

export interface BoardPicks {
  readonly hot: PluginRepo[]
  readonly newest: PluginRepo[]
  readonly fire: PluginRepo[]
}

/** Rank one catalog into the three computed boards. */
export function pickBoards(
  catalog: readonly PluginRepo[],
  nowMs: number,
  limits: { readonly hot: number; readonly newest: number; readonly fire: number },
): BoardPicks {
  return {
    hot: [...catalog].sort((left, right) => compareHot(left, right, nowMs)).slice(0, limits.hot),
    newest: [...catalog].sort((left, right) => compareNew(left, right, nowMs)).slice(0, limits.newest),
    fire: [...catalog].sort((left, right) => compareFire(left, right, nowMs)).slice(0, limits.fire),
  }
}
