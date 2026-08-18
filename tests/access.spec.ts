import { describe, expect, it } from 'vitest'
import {
  browseUrl, cardUrl, cloneUrl, githubSearchUrl, installCommand, isOfficialApi, isProxiedApi,
  OFFICIAL_API, resolveAccess, resolveApiBases,
} from '../src/access.ts'

describe('resolveApiBases', () => {
  it('tries official first in auto mode, then public proxies', () => {
    const bases = resolveApiBases('auto')
    expect(bases[0]).toBe(OFFICIAL_API)
    expect(bases.length).toBeGreaterThan(1)
  })

  it('keeps only official in direct mode', () => {
    expect(resolveApiBases('direct')).toEqual([OFFICIAL_API])
  })
})

describe('url rewrite', () => {
  it('opens the official GitHub page; prefix proxies are not HTML mirrors', () => {
    expect(browseUrl('volcengine/OpenViking')).toBe('https://github.com/volcengine/OpenViking')
    expect(browseUrl('volcengine/OpenViking', 'https://github.com')).toBe('https://github.com/volcengine/OpenViking')
    expect(browseUrl('volcengine/OpenViking', 'https://ghfast.top')).toBe('https://github.com/volcengine/OpenViking')
    expect(browseUrl('acme/board', 'https://kkgithub.com')).toBe('https://kkgithub.com/acme/board')
    expect(cardUrl('http://101.34.27.122:3091', 'volcengine/OpenViking'))
      .toBe('http://101.34.27.122:3091/r/volcengine/OpenViking')
  })

  it('prefixes clone URLs for proxy git', () => {
    expect(cloneUrl('acme/board', 'https://ghfast.top/')).toBe(
      'https://ghfast.top/https://github.com/acme/board.git',
    )
    expect(cloneUrl('acme/board', '')).toBe('https://github.com/acme/board.git')
  })

  it('builds a search URL on a prefix proxy', () => {
    const url = githubSearchUrl('https://ghfast.top/https://api.github.com', new URLSearchParams({ q: 'topic:dsh-plugin' }))
    expect(url).toContain('ghfast.top/https://api.github.com/search/repositories')
    expect(url).toContain('topic%3Adsh-plugin')
  })
})

describe('installCommand', () => {
  it('adds a proxy clone path when a clone proxy is set', () => {
    const text = installCommand('acme/board', 'https://ghfast.top/')
    expect(text).toContain('dsh plugin --profile web add github:acme/board')
    expect(text).toContain('git clone --depth 1 https://ghfast.top/https://github.com/acme/board.git')
  })
})

describe('token safety', () => {
  it('treats prefix proxies as unofficial so a token is never attached', () => {
    expect(isOfficialApi('https://api.github.com')).toBe(true)
    expect(isOfficialApi('https://ghfast.top/https://api.github.com')).toBe(false)
    expect(isProxiedApi('https://ghfast.top/https://api.github.com')).toBe(true)
  })
})

describe('resolveAccess', () => {
  it('defaults auto mode to official browse plus a clone proxy', () => {
    const access = resolveAccess({ access: 'auto' })
    expect(access.htmlBase).toBe('https://github.com')
    expect(access.cloneProxy.length).toBeGreaterThan(0)
    expect(access.apiBases[0]).toBe(OFFICIAL_API)
  })
})
