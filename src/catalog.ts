import { fetchCatalog, resolveGitHubToken } from './github.ts'
import { buildLeaderboard } from './rank.ts'
import type { Config } from './config.ts'
import type { LeaderboardSnapshot } from './types.ts'

interface CacheEntry {
  readonly expiresAt: number
  readonly snapshot: LeaderboardSnapshot
}

/**
 * In-memory leaderboard cache shared by the tool, the slash command, and the HTTP route.
 */
export class LeaderboardCatalog {
  private cache: CacheEntry | undefined
  private inflight: Promise<LeaderboardSnapshot> | undefined

  /**
   * @param config - plugin config captured at apply time
   */
  constructor(private readonly config: Config) {}

  /**
   * Return a cached snapshot or refresh from GitHub.
   * @param force - bypass the TTL
   * @param signal - abort the GitHub requests
   */
  async snapshot(force = false, signal?: AbortSignal): Promise<LeaderboardSnapshot> {
    const now = Date.now()
    if (!force && this.cache !== undefined && this.cache.expiresAt > now) {
      return this.cache.snapshot
    }
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.refresh(signal)
    try {
      return await this.inflight
    } finally {
      this.inflight = undefined
    }
  }

  private async refresh(signal?: AbortSignal): Promise<LeaderboardSnapshot> {
    const pass = await fetchCatalog({
      topic: this.config.topic,
      token: resolveGitHubToken(this.config.githubToken),
      starPages: this.config.starPages,
      updatedPages: this.config.updatedPages,
      signal,
    })
    const snapshot = buildLeaderboard(pass.repos, {
      topic: this.config.topic,
      incomplete: pass.incomplete,
      excludes: this.config.excludes,
    })
    this.cache = {
      expiresAt: Date.now() + this.config.cacheTtlMs,
      snapshot,
    }
    return snapshot
  }
}
