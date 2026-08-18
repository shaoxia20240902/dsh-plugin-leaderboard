/** owner/name, after stripping a trailing `.git`. */
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

/** The harness itself is not a community plugin. */
const BLOCKED = new Set(['deepseek-ai/deepseek-harness'])

/**
 * Accept `owner/repo`, `github:owner/repo`, or a GitHub / mirror / prefix-proxy URL.
 * @param raw - form input
 * @returns canonical `owner/repo`, or undefined when the text is not a repo
 */
export function parseRepoRef(raw: string): string | undefined {
  let value = raw.trim()
  if (value.length === 0) return undefined
  value = value.replace(/^github:/iu, '').replace(/\.git$/iu, '')
  if (value.includes('://') || value.startsWith('github.com/')) {
    const extracted = extractFromUrl(value)
    if (extracted === undefined) return undefined
    value = extracted
  }
  const slash = value.indexOf('/')
  if (slash <= 0) return undefined
  const owner = value.slice(0, slash)
  const repo = value.slice(slash + 1).split(/[/?#]/u)[0]?.replace(/\.git$/iu, '') ?? ''
  const fullName = `${owner}/${repo}`
  if (!REPO.test(fullName)) return undefined
  if (BLOCKED.has(fullName.toLowerCase())) return undefined
  return fullName
}

function extractFromUrl(raw: string): string | undefined {
  const withScheme = raw.includes('://') ? raw : `https://${raw}`
  const nested = withScheme.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/iu)
  if (nested !== null) return nested[1].replace(/\.git$/iu, '')
  try {
    const url = new URL(withScheme)
    const parts = url.pathname.replace(/^\/+/u, '').split('/')
    if (parts.length >= 2 && parts[0] !== undefined && parts[1] !== undefined) {
      return `${parts[0]}/${parts[1].replace(/\.git$/iu, '')}`
    }
  } catch {
    return undefined
  }
  return undefined
}
