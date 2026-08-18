import { DEFAULT_TOPIC, type PluginRepo } from './types.ts'

const SEARCH_URL = 'https://api.github.com/search/repositories'
const PER_PAGE = 100

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
}

export interface FetchCatalogOptions {
  readonly topic?: string
  readonly token?: string
  readonly signal?: AbortSignal
  readonly starPages?: number
  readonly updatedPages?: number
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

/**
 * Run one GitHub repository search page.
 * @param query - full search qualifier string
 * @param page - 1-based page
 * @param sort - GitHub search sort
 * @param token - optional personal access token
 * @param signal - abort the request
 */
export async function searchPage(
  query: string,
  page: number,
  sort: 'stars' | 'updated',
  token: string | undefined,
  signal?: AbortSignal,
): Promise<SearchPass> {
  const url = new URL(SEARCH_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('sort', sort)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', String(PER_PAGE))
  url.searchParams.set('page', String(page))
  const response = await fetch(url, { headers: headers(token), signal })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub search HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`)
  }
  const body = await response.json() as GitHubSearchBody
  const repos: PluginRepo[] = []
  for (const item of body.items ?? []) {
    const mapped = mapItem(item)
    if (mapped !== undefined) repos.push(mapped)
  }
  return { repos, incomplete: body.incomplete_results === true }
}

async function collectPages(
  query: string,
  sort: 'stars' | 'updated',
  pages: number,
  token: string | undefined,
  signal?: AbortSignal,
): Promise<SearchPass> {
  const repos: PluginRepo[] = []
  let incomplete = false
  for (let page = 1; page <= pages; page += 1) {
    const pass = await searchPage(query, page, sort, token, signal)
    repos.push(...pass.repos)
    if (pass.incomplete) incomplete = true
    if (pass.repos.length < PER_PAGE) break
  }
  return { repos, incomplete }
}

/**
 * Load the merged `dsh-plugin` catalog: star-sorted pages plus recently updated pages.
 * @param options - topic, token, page counts
 */
export async function fetchCatalog(options: FetchCatalogOptions = {}): Promise<SearchPass> {
  const topic = options.topic ?? DEFAULT_TOPIC
  const query = `topic:${topic} is:public`
  const starPages = options.starPages ?? 3
  const updatedPages = options.updatedPages ?? 2
  const stars = await collectPages(query, 'stars', starPages, options.token, options.signal)
  const updated = await collectPages(query, 'updated', updatedPages, options.token, options.signal)
  return {
    repos: [...stars.repos, ...updated.repos],
    incomplete: stars.incomplete || updated.incomplete,
  }
}

/** Resolve a GitHub token from config or the process environment. */
export function resolveGitHubToken(configured: string | undefined): string | undefined {
  if (configured !== undefined && configured.trim().length > 0) return configured.trim()
  if (typeof process === 'undefined' || process.env === undefined) return undefined
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (fromEnv === undefined || fromEnv.trim().length === 0) return undefined
  return fromEnv.trim()
}
