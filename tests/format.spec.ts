import { describe, expect, it } from 'vitest'
import { formatLeaderboard } from '../src/format.ts'
import { buildLeaderboard } from '../src/rank.ts'
import type { PluginRepo } from '../src/types.ts'

const repo: PluginRepo = {
  fullName: 'acme/board',
  name: 'board',
  owner: 'acme',
  url: 'https://github.com/acme/board',
  description: 'A demo plugin',
  stars: 42,
  forks: 3,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-10T00:00:00Z',
  language: 'TypeScript',
  archived: false,
  fork: false,
}

describe('formatLeaderboard', () => {
  it('renders the selected board and the install command', () => {
    const snapshot = buildLeaderboard([repo], {
      topic: 'dsh-plugin',
      fetchedAt: '2026-08-18T00:00:00.000Z',
      nowMs: Date.parse('2026-08-18T00:00:00.000Z'),
    })
    const text = formatLeaderboard(snapshot, 'hot')
    expect(text).toContain('## 最热')
    expect(text).not.toContain('## 最新')
    expect(text).toContain('acme/board')
    expect(text).toContain('dsh plugin --profile web add github:acme/board')
  })
})
