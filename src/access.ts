/** Official GitHub API origin. */
export const OFFICIAL_API = 'https://api.github.com'

/** Official GitHub website. */
export const OFFICIAL_HTML = 'https://github.com'

/** Web UI mirror that swaps the github.com host. */
export const DEFAULT_HTML_MIRROR = 'https://kkgithub.com'

/**
 * Public HTTPS prefixes that fetch `https://api.github.com/...` or
 * `https://github.com/...` on the user's behalf. These are unofficial and
 * change often; override them from config when one dies.
 */
export const DEFAULT_API_PROXIES = [
  'https://ghfast.top/https://api.github.com',
  'https://gh-proxy.com/https://api.github.com',
] as const

/** Public prefixes that fetch `https://github.com/owner/repo.git`. */
export const DEFAULT_CLONE_PROXIES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
] as const

/** How the plugin reaches GitHub. */
export type AccessMode = 'auto' | 'direct' | 'proxy'

/** Resolved GitHub access used to decorate rows and fetch the catalog. */
export interface AccessLinks {
  readonly mode: AccessMode
  readonly apiBases: readonly string[]
  readonly htmlBase: string
  readonly cloneProxy: string
}

/** How a snapshot was actually fetched. */
export interface SnapshotAccess {
  readonly mode: AccessMode
  readonly apiUsed: string
  readonly htmlBase: string
  readonly cloneProxy: string
  readonly proxied: boolean
}

export function stripSlash(value: string): string {
  return value.replace(/\/+$/u, '')
}

function splitCsv(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim().length === 0) return []
  return raw.split(/[\n,]/u).map(part => part.trim()).filter(part => part.length > 0)
}

/**
 * Build the API origins to try, in order.
 * `auto` = official first, then proxies. `direct` = official only. `proxy` = proxies only.
 */
export function resolveApiBases(mode: AccessMode, extra: readonly string[] = []): string[] {
  const extras = extra.map(stripSlash).filter(base => base.length > 0)
  if (mode === 'direct') return extras.length > 0 ? extras : [OFFICIAL_API]
  if (mode === 'proxy') {
    return extras.length > 0 ? extras : [...DEFAULT_API_PROXIES]
  }
  const auto = [OFFICIAL_API, ...DEFAULT_API_PROXIES, ...extras]
  return [...new Set(auto.map(stripSlash))]
}

/** Resolve browse / clone / API access from plugin config. */
export function resolveAccess(input: {
  readonly access?: string
  readonly githubApiBase?: string
  readonly githubHtmlBase?: string
  readonly githubCloneProxy?: string
}): AccessLinks {
  const mode = parseAccessMode(input.access)
  const extraApis = splitCsv(input.githubApiBase)
  const htmlDefault = mode === 'direct' ? OFFICIAL_HTML : DEFAULT_HTML_MIRROR
  const cloneDefault = mode === 'direct' ? '' : DEFAULT_CLONE_PROXIES[0]
  return {
    mode,
    apiBases: resolveApiBases(mode, extraApis),
    htmlBase: stripSlash(input.githubHtmlBase?.trim() || htmlDefault),
    cloneProxy: stripSlash(input.githubCloneProxy?.trim() || cloneDefault),
  }
}

export function parseAccessMode(raw: string | undefined): AccessMode {
  const value = (raw ?? 'auto').trim().toLowerCase()
  if (value === 'direct' || value === 'proxy' || value === 'auto') return value
  return 'auto'
}

/** Whether this API base is the official GitHub host (safe to attach a token). */
export function isOfficialApi(apiBase: string): boolean {
  try {
    const host = new URL(apiBase.includes('://') ? apiBase : `https://${apiBase}`).host
    return host === 'api.github.com'
  } catch {
    return apiBase === OFFICIAL_API
  }
}

/** Join an API origin with `/search/repositories?...`. */
export function githubSearchUrl(apiBase: string, query: URLSearchParams): string {
  const url = new URL(`${stripSlash(apiBase)}/search/repositories`)
  for (const [key, value] of query) url.searchParams.set(key, value)
  return url.toString()
}

/** Browse URL: host mirror (`kkgithub.com/a/b`) or official. */
export function browseUrl(fullName: string, htmlBase: string = DEFAULT_HTML_MIRROR): string {
  const official = `${OFFICIAL_HTML}/${fullName}`
  const base = stripSlash(htmlBase)
  if (base.length === 0 || base === OFFICIAL_HTML) return official
  if (base.includes('://github.com')) return `${base}/${fullName}`
  return `${base}/${fullName}`
}

/** `git clone` URL. Empty proxy keeps the official git URL. */
export function cloneUrl(fullName: string, cloneProxy: string = ''): string {
  const official = `${OFFICIAL_HTML}/${fullName}.git`
  const prefix = stripSlash(cloneProxy)
  if (prefix.length === 0 || prefix === OFFICIAL_HTML) return official
  return `${prefix}/${official}`
}

/** Install text: official one-liner, plus a proxy clone path when configured. */
export function installCommand(fullName: string, cloneProxy: string = ''): string {
  const direct = `dsh plugin --profile web add github:${fullName}`
  const prefix = stripSlash(cloneProxy)
  if (prefix.length === 0) return direct
  const dir = `/tmp/dsh-install-${fullName.replaceAll('/', '-')}`
  return [
    direct,
    '',
    '# 访问不了 GitHub 时，先走代理克隆再本地安装：',
    `git clone --depth 1 ${cloneUrl(fullName, prefix)} ${dir} && dsh plugin --profile web add ${dir}`,
  ].join('\n')
}

export function isProxiedApi(apiUsed: string): boolean {
  return !isOfficialApi(apiUsed)
}
