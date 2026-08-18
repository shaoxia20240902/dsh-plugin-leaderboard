import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { LeaderboardCatalog } from './catalog.ts'
import { Config } from './config.ts'
import { formatLeaderboard } from './format.ts'
import { registerLeaderboardRoute, type WebServer } from './http.ts'
import { parseBoardId } from './rank.ts'

interface CommandRuntime {
  register(definition: {
    name: string
    description: string
    input?: { hint: string }
    handler: (invocation: { rawInput: string; signal: AbortSignal }) =>
      | { kind: 'success'; text: string }
      | { kind: 'error'; text: string }
      | Promise<{ kind: 'success'; text: string } | { kind: 'error'; text: string }>
  }): () => void
}

interface SystemPromptRuntime {
  section(section: { name: string; order: number; text: string }): () => void
}

function hostService<T>(ctx: Context, key: string): T {
  return ctx.get(key) as T
}

export { Config } from './config.ts'
export type { Config as LeaderboardConfig } from './config.ts'

/** Loader diagnostics name. */
export const name = 'dsh-plugin-leaderboard'

/** Host services used by the tool, command, prompt, and HTTP route. */
export const inject = ['tools', 'commands', 'systemPrompt']

const PROMPT_TEXT = [
  'You can show the community DeepSeek Harness plugin leaderboard.',
  'Call list_dsh_plugin_leaderboard with board=hot (most stars), board=new (newest created), or board=fire (top 10 by heat).',
  'Omit board to return all three lists.',
  'The catalog is the public GitHub topic dsh-plugin. These are third-party repositories — tell the user to review the source and pin a commit before installing.',
].join(' ')

/**
 * Register the leaderboard tool, slash command, prompt note, and optional HTTP route.
 * @param ctx - host context
 * @param config - validated plugin config
 */
export function apply(ctx: Context, config: Config): void {
  const catalog = new LeaderboardCatalog(config)
  const commands = hostService<CommandRuntime>(ctx, 'commands')
  const systemPrompt = hostService<SystemPromptRuntime>(ctx, 'systemPrompt')

  ctx.tools.register(defineTool({
    name: 'list_dsh_plugin_leaderboard',
    description:
      'Show the DeepSeek Harness community plugin leaderboard from the public GitHub topic dsh-plugin. '
      + 'Boards: hot = most stars, new = newest created, fire = top 10 by heat (stars-per-day with a recency boost). '
      + 'Use when the user asks for popular, newest, or trending dsh plugins, or wants an install command.',
    parameters: {
      board: {
        type: 'string',
        enum: ['hot', 'new', 'fire', 'recommend', 'all'] as const,
        description: 'Which board to return. Default all.',
      },
      refresh: {
        type: 'boolean',
        description: 'Ask the hosted catalog to sync GitHub under a lock. Concurrent refreshes join or get the current MySQL snapshot.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const payload = value as { markdown?: string }
        return [{ type: 'text', text: payload.markdown ?? JSON.stringify(value) }]
      },
    },
    timeoutMs: 60_000,
    async execute(args) {
      const snapshot = await catalog.snapshot(args.refresh === true)
      const selected = parseBoardId(args.board)
      const payload = {
        topic: snapshot.topic,
        fetchedAt: snapshot.fetchedAt,
        total: snapshot.total,
        board: selected,
        markdown: formatLeaderboard(snapshot, selected),
        boards: selected === 'all' ? snapshot.boards : { [selected]: snapshot.boards[selected] },
      }
      return JSON.parse(JSON.stringify(payload)) as Record<string, string | number | boolean | null>
    },
  }))

  commands.register({
    name: 'leaderboard',
    description: 'Show the dsh-plugin leaderboard: 最热 / 最新 / 最火 Top 10.',
    input: { hint: 'hot | new | fire' },
    async handler(invocation) {
      try {
        const snapshot = await catalog.snapshot(false, invocation.signal)
        return { kind: 'success', text: formatLeaderboard(snapshot, invocation.rawInput) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { kind: 'error', text: `无法读取插件排行榜：${message}` }
      }
    },
  })

  systemPrompt.section({
    name: 'dsh-plugin-leaderboard',
    order: 40,
    text: PROMPT_TEXT,
  })

  ctx.inject(['webServer'], (child) => {
    child.effect(() => registerLeaderboardRoute(hostService<WebServer>(child, 'webServer'), catalog))
  })
}
