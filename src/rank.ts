import {
  browseUrl, DEFAULT_HTML_MIRROR, installCommand as buildInstall,
  type AccessLinks, type SnapshotAccess,
} from './access.ts'
import { interpretPrompt } from './interpret.ts'
import {
  DEFAULT_EXCLUDES,
  FIRE_LIMIT,
  HOT_LIMIT,
  NEW_LIMIT,
  type Board,
  type BoardId,
  type LeaderboardSnapshot,
  type PluginRepo,
  type RankedPlugin,
} from './types.ts'

const MS_PER_DAY = 86_400_000

/** Titles and one-line explanations for the three boards. */
export const BOARD_COPY: Record<BoardId, { title: string; description: string }> = {
  hot: {
    title: '最热',
    description: '按 GitHub star 数从高到低，看长期人气最高的插件。',
  },
  new: {
    title: '最新',
    description: '按仓库创建时间从新到旧，看刚进生态的插件。',
  },
  fire: {
    title: '最火 Top 10',
    description: '按星标密度和近期活跃度打分，取当前最火的 10 个。',
  },
  recommend: {
    title: '推荐',
    description: '人工精选、适合先装的插件。',
  },
}

/**
 * Heat score: stars per day of age, boosted when the repo was updated recently.
 * A week-old 70-star plugin outranks a year-old 200-star plugin that went quiet.
 */
export function heatScore(repo: PluginRepo, nowMs: number): number {
  const created = Date.parse(repo.createdAt)
  const updated = Date.parse(repo.updatedAt)
  const ageDays = Number.isFinite(created)
    ? Math.max((nowMs - created) / MS_PER_DAY, 1)
    : 365
  const recencyDays = Number.isFinite(updated)
    ? Math.max((nowMs - updated) / MS_PER_DAY, 0.25)
    : 365
  const density = (repo.stars + repo.forks * 0.5) / ageDays
  const recencyBoost = 1 + 7 / (recencyDays + 1)
  return density * recencyBoost
}

/** Ready-to-run install command for one GitHub-hosted plugin. */
export function installCommand(fullName: string, cloneProxy = ''): string {
  return buildInstall(fullName, cloneProxy)
}

function decorate(
  repos: readonly PluginRepo[],
  nowMs: number,
  access?: Pick<AccessLinks, 'htmlBase' | 'cloneProxy'>,
): RankedPlugin[] {
  const htmlBase = access?.htmlBase ?? DEFAULT_HTML_MIRROR
  const cloneProxy = access?.cloneProxy ?? ''
  return repos.map((repo, index) => ({
    ...repo,
    rank: index + 1,
    heat: heatScore(repo, nowMs),
    install: installCommand(repo.fullName, cloneProxy),
    interpret: interpretPrompt(repo, { htmlBase, cloneProxy }),
    mirrorUrl: browseUrl(repo.fullName, htmlBase),
  }))
}

function compareStars(left: PluginRepo, right: PluginRepo): number {
  return right.stars - left.stars || right.forks - left.forks
    || left.fullName.localeCompare(right.fullName)
}

function compareCreated(left: PluginRepo, right: PluginRepo): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || compareStars(left, right)
}

function compareHeat(left: PluginRepo, right: PluginRepo, nowMs: number): number {
  return heatScore(right, nowMs) - heatScore(left, nowMs) || compareStars(left, right)
}

/** Drop archived repos, forks, and the configured exclude list. */
export function catalogize(
  repos: readonly PluginRepo[],
  excludes: readonly string[] = DEFAULT_EXCLUDES,
): PluginRepo[] {
  const blocked = new Set(excludes.map(name => name.toLowerCase()))
  const seen = new Set<string>()
  const catalog: PluginRepo[] = []
  for (const repo of repos) {
    const key = repo.fullName.toLowerCase()
    if (seen.has(key) || blocked.has(key) || repo.archived || repo.fork) continue
    if (repo.fullName.length === 0) continue
    seen.add(key)
    catalog.push(repo)
  }
  return catalog
}

function board(
  id: BoardId,
  repos: readonly PluginRepo[],
  nowMs: number,
  access?: Pick<AccessLinks, 'htmlBase' | 'cloneProxy'>,
): Board {
  const copy = BOARD_COPY[id]
  return {
    id,
    title: copy.title,
    description: copy.description,
    items: decorate(repos, nowMs, access),
  }
}

/**
 * Build the three boards from a merged GitHub catalog.
 * @param repos - raw search hits, possibly overlapping or excluded
 * @param options - topic label, fetch time, and incomplete-result flag
 */
export function buildLeaderboard(
  repos: readonly PluginRepo[],
  options: {
    readonly topic: string
    readonly fetchedAt?: string
    readonly incomplete?: boolean
    readonly nowMs?: number
    readonly excludes?: readonly string[]
    readonly hotLimit?: number
    readonly newLimit?: number
    readonly fireLimit?: number
    readonly access?: Pick<AccessLinks, 'htmlBase' | 'cloneProxy'>
    readonly snapshotAccess?: SnapshotAccess
  },
): LeaderboardSnapshot {
  const nowMs = options.nowMs ?? Date.now()
  const catalog = catalogize(repos, options.excludes)
  const hotLimit = options.hotLimit ?? HOT_LIMIT
  const newLimit = options.newLimit ?? NEW_LIMIT
  const fireLimit = options.fireLimit ?? FIRE_LIMIT
  const hot = [...catalog].sort(compareStars).slice(0, hotLimit)
  const newest = [...catalog].sort(compareCreated).slice(0, newLimit)
  const fire = [...catalog]
    .sort((left, right) => compareHeat(left, right, nowMs))
    .slice(0, fireLimit)
  return {
    topic: options.topic,
    fetchedAt: options.fetchedAt ?? new Date(nowMs).toISOString(),
    total: catalog.length,
    incomplete: options.incomplete === true,
    ...options.snapshotAccess === undefined ? {} : { access: options.snapshotAccess },
    boards: {
      hot: board('hot', hot, nowMs, options.access),
      new: board('new', newest, nowMs, options.access),
      fire: board('fire', fire, nowMs, options.access),
      recommend: board('recommend', [], nowMs, options.access),
    },
  }
}

/** Resolve a board id from slash-command or tool input. */
export function parseBoardId(raw: string | undefined): BoardId | 'all' {
  const value = (raw ?? 'all').trim().toLowerCase()
  if (value === '' || value === 'all' || value === '全部') return 'all'
  if (value === 'hot' || value === '最热' || value === 'stars') return 'hot'
  if (value === 'new' || value === '最新' || value === 'newest') return 'new'
  if (value === 'fire' || value === '最火' || value === 'hotfire' || value === 'top') return 'fire'
  if (value === 'recommend' || value === '推荐' || value === 'rec') return 'recommend'
  return 'all'
}
