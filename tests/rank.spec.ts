import { describe, expect, it } from 'vitest'
import { buildLeaderboard, catalogize, heatScore, installCommand, parseBoardId } from '../src/rank.ts'
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

describe('catalogize', () => {
  it('drops the harness, forks, archived repos, and duplicates', () => {
    const catalog = catalogize([
      repo({ fullName: 'deepseek-ai/deepseek-harness', stars: 100000, createdAt: '2026-01-01T00:00:00Z' }),
      repo({ fullName: 'acme/ui', stars: 10, createdAt: '2026-08-01T00:00:00Z', fork: true }),
      repo({ fullName: 'acme/old', stars: 10, createdAt: '2026-08-01T00:00:00Z', archived: true }),
      repo({ fullName: 'acme/board', stars: 12, createdAt: '2026-08-01T00:00:00Z' }),
      repo({ fullName: 'acme/board', stars: 12, createdAt: '2026-08-01T00:00:00Z' }),
    ])
    expect(catalog.map(item => item.fullName)).toEqual(['acme/board'])
  })
})

describe('heatScore', () => {
  it('ranks a young high-star repo above an older quiet one', () => {
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
    expect(heatScore(rising, NOW)).toBeGreaterThan(heatScore(legacy, NOW))
  })
})

describe('buildLeaderboard', () => {
  it('builds 最热 by stars, 最新 by createdAt, and 最火 as top 10', () => {
    const repos = [
      repo({ fullName: 'acme/old-star', stars: 500, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' }),
      repo({ fullName: 'acme/brand-new', stars: 3, createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T12:00:00Z' }),
      repo({ fullName: 'acme/viral', stars: 90, createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-18T00:00:00Z' }),
    ]
    const snapshot = buildLeaderboard(repos, { topic: 'dsh-plugin', nowMs: NOW })
    expect(snapshot.boards.hot.items[0]?.fullName).toBe('acme/old-star')
    expect(snapshot.boards.new.items[0]?.fullName).toBe('acme/brand-new')
    expect(snapshot.boards.fire.items[0]?.fullName).toBe('acme/viral')
    expect(snapshot.boards.fire.items).toHaveLength(3)
    expect(snapshot.boards.hot.items[0]?.install).toBe(installCommand('acme/old-star'))
  })
})

describe('parseBoardId', () => {
  it('accepts English and Chinese aliases', () => {
    expect(parseBoardId('最热')).toBe('hot')
    expect(parseBoardId('最新')).toBe('new')
    expect(parseBoardId('最火')).toBe('fire')
    expect(parseBoardId('')).toBe('all')
    expect(parseBoardId('unknown')).toBe('all')
  })
})
