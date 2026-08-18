import { describe, expect, it } from 'vitest'
import { interpretPrompt } from '../src/interpret.ts'
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

describe('interpretPrompt', () => {
  it('asks the agent to clone the repo and explain it in plain language', () => {
    const prompt = interpretPrompt(repo)
    expect(prompt).toContain('https://github.com/acme/board')
    expect(prompt).toContain('git clone --depth 1 https://github.com/acme/board.git /tmp/dsh-read-board')
    expect(prompt).toContain('dsh plugin --profile web add github:acme/board')
    expect(prompt).toContain('一句话它是啥')
    expect(prompt).toContain('适合谁，不适合谁')
    expect(prompt).toContain('不要编')
  })

  it('rides on each ranked row so the sidebar can copy it', () => {
    const snapshot = buildLeaderboard([repo], {
      topic: 'dsh-plugin',
      nowMs: Date.parse('2026-08-18T00:00:00.000Z'),
    })
    expect(snapshot.boards.hot.items[0]?.interpret).toContain('git clone --depth 1 https://github.com/acme/board.git')
  })
})
