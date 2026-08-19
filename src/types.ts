/** One public GitHub repository tagged `dsh-plugin`. */
export interface PluginRepo {
  readonly fullName: string
  readonly name: string
  readonly owner: string
  readonly url: string
  readonly description: string
  readonly stars: number
  readonly forks: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly language: string | null
  readonly archived: boolean
  readonly fork: boolean
}

/** One ranked row shown on a board. */
export interface RankedPlugin extends PluginRepo {
  readonly rank: number
  readonly heat: number
  readonly install: string
  /** Chat prompt the user pastes so the agent explains this repo. */
  readonly interpret: string
  /** Website URL that is more likely to open when github.com is blocked. */
  readonly mirrorUrl: string
  /** Why this row is on the recommend board. */
  readonly reason?: string
  /** Copies / recommends counted for the current board. */
  readonly clicks?: number
  readonly installClicks?: number
  readonly interpretClicks?: number
  readonly recommendClicks?: number
}

/** The boards this plugin publishes. */
export type BoardId = 'hot' | 'new' | 'fire' | 'download' | 'interpret' | 'recommend'

/** One named board snapshot. */
export interface Board {
  readonly id: BoardId
  readonly title: string
  readonly description: string
  readonly items: readonly RankedPlugin[]
}

/** How the hosted catalog last treated a sync request. */
export interface RefreshMeta {
  readonly status: 'idle' | 'ok' | 'busy' | 'cooldown' | 'failed' | 'joined' | string
  readonly lastSync?: string
  readonly syncing?: boolean
  readonly autoMs?: number
  readonly minManualMs?: number
  readonly ageMs?: number
  readonly error?: string
}

/** Payload served to the Web UI and returned by the tool. */
export interface LeaderboardSnapshot {
  readonly topic: string
  readonly fetchedAt: string
  readonly total: number
  readonly incomplete: boolean
  readonly source?: string
  readonly refresh?: RefreshMeta
  readonly access?: {
    readonly mode: string
    readonly apiUsed: string
    readonly htmlBase: string
    readonly cloneProxy: string
    readonly proxied: boolean
  }
  readonly boards: {
    readonly hot: Board
    readonly new: Board
    readonly fire: Board
    readonly download?: Board
    readonly interpret?: Board
    readonly recommend?: Board
  }
}

/** Default hosted API that stores catalogs in MySQL. */
export const DEFAULT_ORIGIN_URL = 'http://101.34.27.122:3091'

/** Default GitHub topic used as the catalog source. */
export const DEFAULT_TOPIC = 'dsh-plugin'

/** Default board lengths. */
export const HOT_LIMIT = 20
export const NEW_LIMIT = 20
export const FIRE_LIMIT = 10

/** The harness itself is not a community plugin. */
export const DEFAULT_EXCLUDES = ['deepseek-ai/deepseek-harness'] as const
