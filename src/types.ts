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
}

/** The three boards this plugin publishes. */
export type BoardId = 'hot' | 'new' | 'fire'

/** One named board snapshot. */
export interface Board {
  readonly id: BoardId
  readonly title: string
  readonly description: string
  readonly items: readonly RankedPlugin[]
}

/** Payload served to the Web UI and returned by the tool. */
export interface LeaderboardSnapshot {
  readonly topic: string
  readonly fetchedAt: string
  readonly total: number
  readonly incomplete: boolean
  readonly boards: {
    readonly hot: Board
    readonly new: Board
    readonly fire: Board
  }
}

/** Default GitHub topic used as the catalog source. */
export const DEFAULT_TOPIC = 'dsh-plugin'

/** Default board lengths. */
export const HOT_LIMIT = 20
export const NEW_LIMIT = 20
export const FIRE_LIMIT = 10

/** The harness itself is not a community plugin. */
export const DEFAULT_EXCLUDES = ['deepseek-ai/deepseek-harness'] as const
