import { isProxiedApi, resolveAccess } from './access.ts'
import { fetchCatalog, resolveGitHubToken } from './github.ts'
import { fetchOriginSnapshot } from './origin.ts'
import { buildLeaderboard } from './rank.ts'
import type { Config } from './config.ts'
import type { LeaderboardSnapshot } from './types.ts'

interface CacheEntry {
  readonly expiresAt: number
  readonly snapshot: LeaderboardSnapshot
}

/**
 * In-memory leaderboard cache shared by the tool, the slash command, and the HTTP route.
 * Reads are never blocked on GitHub when a previous snapshot exists.
 */
export class LeaderboardCatalog {
  private cache: CacheEntry | undefined
  private inflight: Promise<LeaderboardSnapshot> | undefined
  private inflightForce = false

  /**
   * @param config - plugin config captured at apply time
   */
  constructor(private readonly config: Config) {}

  /**
   * Return a cached snapshot, serving stale data while a background refresh runs.
   * @param force - ask the origin to sync GitHub (locked); wait for that response
   * @param signal - abort the in-flight request
   */
  async snapshot(force = false, signal?: AbortSignal): Promise<LeaderboardSnapshot> {
    if (!force && this.cache !== undefined) {
      if (this.cache.expiresAt <= Date.now()) {
        void this.startRefresh(false, signal).catch(() => undefined)
      }
      return this.cache.snapshot
    }
    return this.startRefresh(force, signal)
  }

  private startRefresh(force: boolean, signal?: AbortSignal): Promise<LeaderboardSnapshot> {
    if (this.inflight !== undefined) {
      if (force && !this.inflightForce) {
        return this.inflight.then(() => this.startRefresh(true, signal))
      }
      if (!force && this.cache !== undefined) return Promise.resolve(this.cache.snapshot)
      return this.inflight
    }
    this.inflightForce = force
    this.inflight = this.refresh(force, signal).finally(() => {
      this.inflight = undefined
      this.inflightForce = false
    })
    return this.inflight
  }

  private async refresh(force: boolean, signal?: AbortSignal): Promise<LeaderboardSnapshot> {
    const origin = this.config.originUrl?.trim() ?? ''
    if (origin.length > 0) {
      try {
        const remote = await fetchOriginSnapshot(origin, { signal, refresh: force })
        this.cache = { expiresAt: Date.now() + this.config.cacheTtlMs, snapshot: remote }
        return remote
      } catch {
        if (this.cache !== undefined) return this.cache.snapshot
      }
    }
    const access = resolveAccess(this.config)
    const pass = await fetchCatalog({
      topic: this.config.topic,
      token: resolveGitHubToken(this.config.githubToken),
      starPages: this.config.starPages,
      updatedPages: this.config.updatedPages,
      signal,
      access: access.mode,
      apiBases: access.apiBases,
    })
    const snapshot = buildLeaderboard(pass.repos, {
      topic: this.config.topic,
      incomplete: pass.incomplete,
      excludes: this.config.excludes,
      access,
      snapshotAccess: {
        mode: access.mode,
        apiUsed: pass.apiUsed,
        htmlBase: access.htmlBase,
        cloneProxy: access.cloneProxy,
        proxied: isProxiedApi(pass.apiUsed),
      },
    })
    this.cache = {
      expiresAt: Date.now() + this.config.cacheTtlMs,
      snapshot,
    }
    return snapshot
  }
}
