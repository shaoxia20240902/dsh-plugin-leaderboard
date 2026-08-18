import { describe, expect, it } from 'vitest'
import { parseRepoRef } from '../src/repo-ref.ts'

describe('parseRepoRef', () => {
  it('accepts owner/repo, github: shorthand, and common URLs', () => {
    expect(parseRepoRef('volcengine/OpenViking')).toBe('volcengine/OpenViking')
    expect(parseRepoRef('github:volcengine/OpenViking')).toBe('volcengine/OpenViking')
    expect(parseRepoRef('https://github.com/volcengine/OpenViking')).toBe('volcengine/OpenViking')
    expect(parseRepoRef('https://github.com/volcengine/OpenViking.git')).toBe('volcengine/OpenViking')
    expect(parseRepoRef('https://ghfast.top/https://github.com/volcengine/OpenViking')).toBe('volcengine/OpenViking')
    expect(parseRepoRef('https://kkgithub.com/volcengine/OpenViking')).toBe('volcengine/OpenViking')
  })

  it('rejects the harness and junk', () => {
    expect(parseRepoRef('deepseek-ai/deepseek-harness')).toBeUndefined()
    expect(parseRepoRef('not a repo')).toBeUndefined()
    expect(parseRepoRef('')).toBeUndefined()
  })
})
