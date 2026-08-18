import { githubSearchUrl, isOfficialApi, OFFICIAL_API, resolveApiBases, type AccessMode } from './access.ts'
import { DEFAULT_TOPIC, type PluginRepo } from './types.ts'

const PER_PAGE = 100
const ATTEMPT_MS = 8_000

interface GitHubSearchItem {
  readonly full_name?: string
  readonly name?: string
  readonly html_url?: string
  readonly description?: string | null
  readonly stargazers_count?: number
  readonly forks_count?: number
  readonly created_at?: string
  readonly updated_at?: string
  readonly language?: string | null
  readonly archived?: boolean
  readonly fork?: boolean
  readonly owner?: { readonly login?: string }
}

interface GitHubSearchBody {
  readonly incomplete_results?: boolean
  readonly items?: GitHubSearchItem[]
}

/** One GitHub search pass. */
export interface SearchPass {
  readonly repos: PluginRepo[]
  readonly incomplete: boolean
  readonly apiUsed: string
}

export interface FetchCatalogOptions {
  readonly topic?: string
  readonly token?: string
  readonly signal?: AbortSignal
  readonly starPages?: number
  readonly updatedPages?: number
  readonly access?: AccessMode
  readonly apiBases?: readonly string[]
}

function isBrowser(): boolean {
  return typeof globalThis.window !== 'undefined'
}

function headers(token: string | undefined): HeadersInit {
  const next: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  }
  if (!isBrowser()) next['user-agent'] = 'dsh-plugin-leaderboard'
  if (token !== undefined && token.length > 0) next.authorization = `Bearer ${token}`
  return next
}

function mapItem(item: GitHubSearchItem): PluginRepo | undefined {
  const fullName = item.full_name ?? ''
  if (fullName.length === 0) return undefined
  return {
    fullName,
    name: item.name ?? fullName.split('/')[1] ?? fullName,
    owner: item.owner?.login ?? fullName.split('/')[0] ?? '',
    url: item.html_url ?? `https://github.com/${fullName}`,
    description: item.description ?? '',
    stars: Number(item.stargazers_count ?? 0),
    forks: Number(item.forks_count ?? 0),
    createdAt: item.created_at ?? '',
    updatedAt: item.updated_at ?? '',
    language: item.language ?? null,
    archived: item.archived === true,
    fork: item.fork === true,
  }
}

function shouldTryNext(status: number): boolean {
  return status === 403 || status === 429 || status >= 500
}

function mergeSignals(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (parent === undefined) return { signal: timeout, cancel: () => undefined }
  const pair = AbortSignal.any([parent, timeout])
  return { signal: pair, cancel: () => undefined }
}

async function searchPageOn(
  apiBase: string,
  query: string,
  page: number,
  sort: 'stars' | 'updated',
  token: string | undefined,
  signal?: AbortSignal,
): Promise<SearchPass> {
  const params = new URLSearchParams({
    q: query,
    sort,
    order: 'desc',
    per_page: String(PER_PAGE),
    page: String(page),
  })
  const url = githubSearchUrl(apiBase, params)
  const attachToken = isOfficialApi(apiBase) ? token : undefined
  const { signal: attempt } = mergeSignals(signal, ATTEMPT_MS)
  const response = await fetch(url, { headers: headers(attachToken), signal: attempt })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub search HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''} via ${apiBase}`)
  }
  const body = await response.json() as GitHubSearchBody
  const repos: PluginRepo[] = []
  for (const item of body.items ?? []) {
    const mapped = mapItem(item)
    if (mapped !== undefined) repos.push(mapped)
  }
  return { repos, incomplete: body.incomplete_results === true, apiUsed: apiBase }
}

/**
 * Run one GitHub repository search page against one API origin.
 */
export async function searchPage(
  query: string,
  page: number,
  sort: 'stars' | 'updated',
  token: string | undefined,
  signal?: AbortSignal,
  apiBase: string = OFFICIAL_API,
): Promise<SearchPass> {
  return searchPageOn(apiBase, query, page, sort, token, signal)
}

async function collectPages(
  apiBase: string,
  query: string,
  sort: 'stars' | 'updated',
  pages: number,
  token: string | undefined,
  signal?: AbortSignal,
): Promise<SearchPass> {
  const repos: PluginRepo[] = []
  let incomplete = false
  for (let page = 1; page <= pages; page += 1) {
    const pass = await searchPageOn(apiBase, query, page, sort, token, signal)
    repos.push(...pass.repos)
    if (pass.incomplete) incomplete = true
    if (pass.repos.length < PER_PAGE) break
  }
  return { repos, incomplete, apiUsed: apiBase }
}

async function fetchCatalogFrom(
  apiBase: string,
  options: FetchCatalogOptions,
): Promise<SearchPass> {
  const topic = options.topic ?? DEFAULT_TOPIC
  const query = `topic:${topic} is:public`
  const starPages = options.starPages ?? 3
  const updatedPages = options.updatedPages ?? 2
  const stars = await collectPages(apiBase, query, 'stars', starPages, options.token, options.signal)
  const updated = await collectPages(apiBase, query, 'updated', updatedPages, options.token, options.signal)
  return {
    repos: [...stars.repos, ...updated.repos],
    incomplete: stars.incomplete || updated.incomplete,
    apiUsed: apiBase,
  }
}

/**
 * Load the merged `dsh-plugin` catalog. `auto` tries the official API, then public proxies.
 * A token is attached only when talking to api.github.com.
 */
export async function fetchCatalog(options: FetchCatalogOptions = {}): Promise<SearchPass> {
  const bases = options.apiBases !== undefined && options.apiBases.length > 0
    ? options.apiBases
    : resolveApiBases(options.access ?? 'auto')
  const errors: string[] = []
  for (const apiBase of bases) {
    try {
      return await fetchCatalogFrom(apiBase, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(message)
      const statusMatch = /HTTP (\d+)/u.exec(message)
      const status = statusMatch === null ? 0 : Number(statusMatch[1])
      if (status !== 0 && !shouldTryNext(status) && options.access === 'direct') break
    }
  }
  throw new Error(`GitHub 不可达（已尝试 ${bases.join('、')}）：${errors.join('；')}`)
}

/** Resolve a GitHub token from config or the process environment. */
export function resolveGitHubToken(configured: string | undefined): string | undefined {
  if (configured !== undefined && configured.trim().length > 0) return configured.trim()
  if (typeof process === 'undefined' || process.env === undefined) return undefined
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (fromEnv === undefined || fromEnv.trim().length === 0) return undefined
  return fromEnv.trim()
}
