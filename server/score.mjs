/** Same ranking math as src/score.ts — keep the two files in lockstep. */

const MS_PER_DAY = 86_400_000
const RELEVANCE_NEEDLES = [
  'dsh-plugin', 'deepseek-harness', 'deepseek harness', 'dsh ', ' dsh', '/dsh',
  'cordis', 'harness plugin',
]

export function daysSince(iso, nowMs) {
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return 365
  return Math.max((nowMs - stamp) / MS_PER_DAY, 0)
}

function log1p(value) {
  return Math.log(1 + Math.max(0, value))
}

export function freshness(updatedAt, nowMs) {
  return 1 / (1 + daysSince(updatedAt, nowMs) / 21)
}

export function relevance(repo) {
  const text = `${repo.fullName} ${repo.name} ${repo.description}`.toLowerCase()
  let hits = 0
  if (/(^|[^a-z])dsh([^a-z]|$)/u.test(text) || text.includes('dsh-')) hits += 1
  for (const needle of RELEVANCE_NEEDLES) {
    if (text.includes(needle)) hits += 1
  }
  return Math.min(1, hits / 2)
}

export function hotScore(repo, nowMs) {
  const popularity = log1p(repo.stars) + 0.55 * log1p(repo.forks)
  const maintain = 0.6 * freshness(repo.updatedAt, nowMs)
  const rel = 0.4 * relevance(repo)
  const stale = daysSince(repo.updatedAt, nowMs) > 180 ? 0.25 : 0
  return popularity + maintain + rel - stale
}

export function newScore(repo, nowMs) {
  const recency = 1 / (1 + daysSince(repo.createdAt, nowMs) / 6)
  const traction = 1 + 0.9 * log1p(repo.stars) + 0.28 * log1p(repo.forks)
  return recency ** 1.8 * traction * (1 + 0.22 * relevance(repo))
}

export function fireScore(repo, nowMs) {
  const ageDays = Math.max(daysSince(repo.createdAt, nowMs), 0.25)
  const velocity = (repo.stars + 0.65 * repo.forks) / (ageDays + 2) ** 1.55
  return velocity * (1 + 1.2 * freshness(repo.updatedAt, nowMs)) * (1 + 0.28 * relevance(repo))
}

function byName(left, right) {
  return left.fullName.localeCompare(right.fullName)
}

export function compareHot(left, right, nowMs) {
  return hotScore(right, nowMs) - hotScore(left, nowMs) || right.stars - left.stars || byName(left, right)
}

export function compareNew(left, right, nowMs) {
  return newScore(right, nowMs) - newScore(left, nowMs)
    || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || byName(left, right)
}

export function compareFire(left, right, nowMs) {
  return fireScore(right, nowMs) - fireScore(left, nowMs) || right.stars - left.stars || byName(left, right)
}

export function pickBoards(catalog, nowMs, limits) {
  return {
    hot: [...catalog].sort((left, right) => compareHot(left, right, nowMs)).slice(0, limits.hot),
    newest: [...catalog].sort((left, right) => compareNew(left, right, nowMs)).slice(0, limits.newest),
    fire: [...catalog].sort((left, right) => compareFire(left, right, nowMs)).slice(0, limits.fire),
  }
}
