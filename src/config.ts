import Schema from 'schemastery'
import { DEFAULT_EXCLUDES, DEFAULT_ORIGIN_URL, DEFAULT_TOPIC } from './types.ts'

/** Plugin configuration accepted from cordis.yml. */
export interface Config {
  /** Optional GitHub token; falls back to GITHUB_TOKEN / GH_TOKEN. Never sent through a public proxy. */
  githubToken?: string
  /**
   * How to reach GitHub: auto (official then proxies), direct, or proxy.
   * auto is the default so machines that cannot open github.com still load the board.
   */
  access: string
  /** Extra API origins, comma-separated. Official or `https://<proxy>/https://api.github.com`. */
  githubApiBase?: string
  /** Website used by「打开仓库」. Default kkgithub.com unless access=direct. */
  githubHtmlBase?: string
  /** Prefix prepended to `https://github.com/owner/repo.git` for clone/install. */
  githubCloneProxy?: string
  /** GitHub topic that defines the catalog. */
  topic: string
  /** How long the host reuses a successful origin snapshot in memory. */
  cacheTtlMs: number
  /** Star-sorted GitHub search pages (100 repos each). */
  starPages: number
  /** Recently-updated GitHub search pages (100 repos each). */
  updatedPages: number
  /** Repositories dropped from every board, as owner/name. */
  excludes: string[]
  /**
   * Hosted MySQL API. Tried first so users who cannot reach GitHub still get
   * the boards, including the curated recommend list.
   */
  originUrl: string
}

/** Schemastery schema. Defaults live on the fields. */
export const Config: Schema<Config> = Schema.object({
  githubToken: Schema.string(),
  access: Schema.string().default('auto'),
  githubApiBase: Schema.string(),
  githubHtmlBase: Schema.string(),
  githubCloneProxy: Schema.string(),
  topic: Schema.string().default(DEFAULT_TOPIC),
  cacheTtlMs: Schema.number().default(5 * 60 * 1000),
  starPages: Schema.number().default(3),
  updatedPages: Schema.number().default(2),
  excludes: Schema.array(Schema.string()).default([...DEFAULT_EXCLUDES]),
  originUrl: Schema.string().default(DEFAULT_ORIGIN_URL),
})
