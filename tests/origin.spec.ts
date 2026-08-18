import { describe, expect, it, vi } from 'vitest'
import { fetchOriginSnapshot } from '../src/origin.ts'

describe('fetchOriginSnapshot', () => {
  it('accepts a hosted leaderboard payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      topic: 'dsh-plugin',
      fetchedAt: '2026-08-19T00:00:00.000Z',
      total: 1,
      incomplete: false,
      boards: {
        hot: { id: 'hot', title: '最热', description: '', items: [] },
        new: { id: 'new', title: '最新', description: '', items: [] },
        fire: { id: 'fire', title: '最火', description: '', items: [] },
        recommend: { id: 'recommend', title: '推荐', description: '', items: [] },
      },
    }), { status: 200 })))
    const snap = await fetchOriginSnapshot('http://101.34.27.122:3091')
    expect(snap.boards.recommend?.title).toBe('推荐')
    vi.unstubAllGlobals()
  })

  it('asks the origin to sync when refresh is set', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://101.34.27.122:3091/v1/leaderboard?refresh=1')
      return new Response(JSON.stringify({
        topic: 'dsh-plugin',
        fetchedAt: '2026-08-19T00:00:00.000Z',
        total: 1,
        incomplete: false,
        refresh: { status: 'cooldown' },
        boards: {
          hot: { id: 'hot', title: '最热', description: '', items: [] },
          new: { id: 'new', title: '最新', description: '', items: [] },
          fire: { id: 'fire', title: '最火', description: '', items: [] },
        },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const snap = await fetchOriginSnapshot('http://101.34.27.122:3091', { refresh: true })
    expect(snap.refresh?.status).toBe('cooldown')
    vi.unstubAllGlobals()
  })
})
