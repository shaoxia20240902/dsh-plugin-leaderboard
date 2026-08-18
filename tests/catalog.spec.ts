import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeaderboardCatalog } from '../src/catalog.ts'
import type { Config } from '../src/config.ts'
import type { LeaderboardSnapshot } from '../src/types.ts'

function snap(fetchedAt: string): LeaderboardSnapshot {
  return {
    topic: 'dsh-plugin',
    fetchedAt,
    total: 1,
    incomplete: false,
    boards: {
      hot: { id: 'hot', title: '最热', description: '', items: [] },
      new: { id: 'new', title: '最新', description: '', items: [] },
      fire: { id: 'fire', title: '最火', description: '', items: [] },
    },
  }
}

function config(cacheTtlMs: number): Config {
  return {
    access: 'auto',
    topic: 'dsh-plugin',
    cacheTtlMs,
    starPages: 1,
    updatedPages: 1,
    excludes: [],
    originUrl: 'http://origin.test',
  }
}

describe('LeaderboardCatalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses a fresh snapshot without calling origin again', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(snap('t1')), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const catalog = new LeaderboardCatalog(config(60_000))
    await catalog.snapshot()
    await catalog.snapshot()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns stale data immediately while a background refresh runs', async () => {
    let resolveSecond!: (value: Response) => void
    const second = new Promise<Response>(resolve => { resolveSecond = resolve })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snap('t1')), { status: 200 }))
      .mockImplementationOnce(() => second)
    vi.stubGlobal('fetch', fetchMock)
    const catalog = new LeaderboardCatalog(config(1))
    const first = await catalog.snapshot()
    await new Promise(resolve => { setTimeout(resolve, 5) })
    const stale = await catalog.snapshot()
    expect(stale.fetchedAt).toBe(first.fetchedAt)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    resolveSecond(new Response(JSON.stringify(snap('t2')), { status: 200 }))
    await vi.waitFor(async () => {
      const latest = await catalog.snapshot()
      expect(latest.fetchedAt).toBe('t2')
    })
  })

  it('asks the origin to sync when forced', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('refresh=1')
      return new Response(JSON.stringify(snap('t3')), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const catalog = new LeaderboardCatalog(config(60_000))
    const next = await catalog.snapshot(true)
    expect(next.fetchedAt).toBe('t3')
  })

  it('keeps the last snapshot if origin fails on refresh', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snap('t1')), { status: 200 }))
      .mockRejectedValueOnce(new Error('origin down'))
    vi.stubGlobal('fetch', fetchMock)
    const catalog = new LeaderboardCatalog(config(60_000))
    await catalog.snapshot()
    const next = await catalog.snapshot(true)
    expect(next.fetchedAt).toBe('t1')
  })
})
