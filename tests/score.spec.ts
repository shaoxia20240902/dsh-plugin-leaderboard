import { describe, expect, it } from 'vitest'
import { fireScore, hotScore, newScore, pickBoards, relevance } from '../src/score.ts'
import type { PluginRepo } from '../src/types.ts'

function repo(partial: Partial<PluginRepo> & Pick<PluginRepo, 'fullName' | 'stars' | 'createdAt'>): PluginRepo {
  return {
    name: partial.fullName.split('/')[1] ?? partial.fullName,
    owner: partial.fullName.split('/')[0] ?? '',
    url: `https://github.com/${partial.fullName}`,
    description: '',
    forks: 0,
    updatedAt: partial.createdAt,
    language: 'TypeScript',
    archived: false,
    fork: false,
    ...partial,
  }
}

const NOW = Date.parse('2026-08-18T00:00:00.000Z')

describe('relevance', () => {
  it('scores a real dsh plugin above a topic-only tourist', () => {
    const plugin = repo({
      fullName: 'acme/dsh-sidebar',
      stars: 10,
      createdAt: '2026-08-01T00:00:00Z',
      description: 'A DeepSeek Harness sidebar plugin',
    })
    const tourist = repo({
      fullName: 'acme/resume-builder',
      stars: 40000,
      createdAt: '2020-01-01T00:00:00Z',
      description: 'A one-of-a-kind resume builder',
    })
    expect(relevance(plugin)).toBeGreaterThan(relevance(tourist))
    expect(relevance(tourist)).toBe(0)
  })
})

describe('hotScore', () => {
  it('does not let a stale mega-repo bury a maintained dsh plugin of real size', () => {
    const stale = repo({
      fullName: 'acme/ancient',
      stars: 40000,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      description: 'Unrelated tool',
    })
    const alive = repo({
      fullName: 'acme/dsh-workbench',
      stars: 8000,
      forks: 400,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-17T00:00:00Z',
      description: 'DeepSeek Harness workbench plugin',
    })
    expect(hotScore(alive, NOW)).toBeGreaterThan(hotScore(stale, NOW) * 0.55)
  })

  it('still prefers a much larger living repo over a tiny one', () => {
    const big = repo({
      fullName: 'acme/dsh-big',
      stars: 20000,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-08-17T00:00:00Z',
      description: 'dsh plugin',
    })
    const tiny = repo({
      fullName: 'acme/dsh-tiny',
      stars: 12,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-17T00:00:00Z',
      description: 'dsh plugin',
    })
    expect(hotScore(big, NOW)).toBeGreaterThan(hotScore(tiny, NOW))
  })
})

describe('newScore', () => {
  it('ranks a same-week repo with traction above an empty shell created today', () => {
    const empty = repo({
      fullName: 'acme/empty',
      stars: 0,
      createdAt: '2026-08-18T00:00:00Z',
      updatedAt: '2026-08-18T00:00:00Z',
    })
    const notable = repo({
      fullName: 'acme/notable',
      stars: 40,
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-17T00:00:00Z',
    })
    expect(newScore(notable, NOW)).toBeGreaterThan(newScore(empty, NOW))
  })

  it('still prefers a day-old repo over a two-month-old one', () => {
    const fresh = repo({
      fullName: 'acme/fresh',
      stars: 2,
      createdAt: '2026-08-17T00:00:00Z',
    })
    const aging = repo({
      fullName: 'acme/aging',
      stars: 8,
      createdAt: '2026-06-18T00:00:00Z',
    })
    expect(newScore(fresh, NOW)).toBeGreaterThan(newScore(aging, NOW))
  })
})

describe('fireScore', () => {
  it('ranks a young breakout above an older quiet repo with more stars', () => {
    const rising = repo({
      fullName: 'acme/rising',
      stars: 80,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-17T00:00:00Z',
    })
    const legacy = repo({
      fullName: 'acme/legacy',
      stars: 200,
      createdAt: '2025-08-18T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(fireScore(rising, NOW)).toBeGreaterThan(fireScore(legacy, NOW))
  })
})

describe('pickBoards', () => {
  it('splits influence, new-and-notable, and velocity onto three boards', () => {
    const repos = [
      repo({
        fullName: 'acme/old-star',
        stars: 500,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-06-01T00:00:00Z',
      }),
      repo({
        fullName: 'acme/brand-new',
        stars: 3,
        createdAt: '2026-08-17T00:00:00Z',
        updatedAt: '2026-08-17T12:00:00Z',
      }),
      repo({
        fullName: 'acme/viral-dsh',
        stars: 90,
        createdAt: '2026-08-10T00:00:00Z',
        updatedAt: '2026-08-18T00:00:00Z',
        description: 'A DeepSeek Harness plugin',
      }),
    ]
    const boards = pickBoards(repos, NOW, { hot: 3, newest: 3, fire: 3 })
    expect(boards.hot[0]?.fullName).toBe('acme/old-star')
    expect(boards.newest[0]?.fullName).toBe('acme/brand-new')
    expect(boards.fire[0]?.fullName).toBe('acme/viral-dsh')
  })
})
