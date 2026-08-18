import {
  browseUrl, cardUrl, DEFAULT_HTML_MIRROR, installCommand as buildInstall,
  type AccessLinks, type SnapshotAccess,
} from './access.ts'
import { interpretPrompt } from './interpret.ts'
import { heatScore, pickBoards } from './score.ts'

export { fireScore, heatScore, hotScore, newScore } from './score.ts'
import {
  DEFAULT_EXCLUDES,
  DEFAULT_ORIGIN_URL,
  FIRE_LIMIT,
  HOT_LIMIT,
  NEW_LIMIT,
  type Board,
  type BoardId,
  type LeaderboardSnapshot,
  type PluginRepo,
  type RankedPlugin,
} from './types.ts'

/** Titles and one-line explanations for the boards. */
export const BOARD_COPY: Record<BoardId, { title: string; description: string }> = {
  hot: {
    title: '最热',
    description: '长期影响力：star/fork 取对数，叠加是否还在维护、是不是真 DSH 插件。',
  },
  new: {
    title: '最新',
    description: '新锐榜：越新越好，同样新的仓库里已经有人用的排前面。',
  },
  fire: {
    title: '最火 Top 10',
    description: '爆发力：单位时间涨星（重力衰减）× 近期是否还在动。',
  },
  recommend: {
    title: '推荐',
    description: '人工精选、适合先装的插件。',
  },
}

/** Ready-to-run install command for one GitHub-hosted plugin. */
export function installCommand(fullName: string, cloneProxy = ''): string {
  return buildInstall(fullName, cloneProxy)
}

function decorate(
  repos: readonly PluginRepo[],
  nowMs: number,
  access?: { readonly htmlBase?: string; readonly cloneProxy?: string; readonly cardBase?: string },
): RankedPlugin[] {
  const htmlBase = access?.htmlBase ?? DEFAULT_HTML_MIRROR
  const cloneProxy = access?.cloneProxy ?? ''
  const cardBase = access?.cardBase?.trim() ?? ''
  return repos.map((repo, index) => ({
    ...repo,
    rank: index + 1,
    heat: heatScore(repo, nowMs),
    install: installCommand(repo.fullName, cloneProxy),
    interpret: interpretPrompt(repo, { htmlBase, cloneProxy, cardUrl: cardBase.length > 0 ? cardUrl(cardBase, repo.fullName) : undefined }),
    mirrorUrl: cardBase.length > 0 ? cardUrl(cardBase, repo.fullName) : browseUrl(repo.fullName, htmlBase),
  }))
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
  access?: { readonly htmlBase?: string; readonly cloneProxy?: string; readonly cardBase?: string },
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
    readonly cardBase?: string
    readonly snapshotAccess?: SnapshotAccess
  },
): LeaderboardSnapshot {
  const nowMs = options.nowMs ?? Date.now()
  const catalog = catalogize(repos, options.excludes)
  const picked = pickBoards(catalog, nowMs, {
    hot: options.hotLimit ?? HOT_LIMIT,
    newest: options.newLimit ?? NEW_LIMIT,
    fire: options.fireLimit ?? FIRE_LIMIT,
  })
  const hot = picked.hot
  const newest = picked.newest
  const fire = picked.fire
  const access = { ...options.access, cardBase: options.cardBase ?? DEFAULT_ORIGIN_URL }
  return {
    topic: options.topic,
    fetchedAt: options.fetchedAt ?? new Date(nowMs).toISOString(),
    total: catalog.length,
    incomplete: options.incomplete === true,
    ...options.snapshotAccess === undefined ? {} : { access: options.snapshotAccess },
    boards: {
      hot: board('hot', hot, nowMs, access),
      new: board('new', newest, nowMs, access),
      fire: board('fire', fire, nowMs, access),
      recommend: board('recommend', [], nowMs, access),
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
