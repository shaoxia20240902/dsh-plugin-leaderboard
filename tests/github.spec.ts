import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCatalog, resolveGitHubToken, searchPage } from '../src/github.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('searchPage', () => {
  it('maps GitHub search hits into plugin repos', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      incomplete_results: false,
      items: [{
        full_name: 'acme/board',
        name: 'board',
        html_url: 'https://github.com/acme/board',
        description: 'demo',
        stargazers_count: 9,
        forks_count: 1,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-02T00:00:00Z',
        language: 'TypeScript',
        archived: false,
        fork: false,
        owner: { login: 'acme' },
      }],
    }), { status: 200 })))
    const pass = await searchPage('topic:dsh-plugin', 1, 'stars', undefined)
    expect(pass.repos).toEqual([expect.objectContaining({ fullName: 'acme/board', stars: 9, owner: 'acme' })])
  })

  it('throws a loud error on a non-OK GitHub response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 403 })))
    await expect(searchPage('topic:dsh-plugin', 1, 'stars', undefined)).rejects.toThrow(/HTTP 403/)
  })
})

describe('fetchCatalog', () => {
  it('merges star-sorted and recently updated pages', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const name = url.includes('sort=updated') ? 'acme/fresh' : 'acme/popular'
      return new Response(JSON.stringify({
        items: [{ full_name: name, stargazers_count: 1, owner: { login: 'acme' } }],
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pass = await fetchCatalog({ starPages: 1, updatedPages: 1 })
    expect(pass.repos.map(item => item.fullName).sort()).toEqual(['acme/fresh', 'acme/popular'])
  })
})

describe('resolveGitHubToken', () => {
  it('prefers the configured token over the environment', () => {
    vi.stubEnv('GITHUB_TOKEN', 'env-token')
    expect(resolveGitHubToken(' cfg ')).toBe('cfg')
    expect(resolveGitHubToken(undefined)).toBe('env-token')
  })
})
