import { LeaderboardPanel } from './LeaderboardPanel.tsx'
import { en, zh } from './locales.ts'
import { ensureLeaderboardStyles } from './styles.ts'

interface ClientContext {
  locale: {
    register: (namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }) => () => void
  }
  slots: {
    inject: (name: string, factory: () => unknown) => unknown
    register: (options: Record<string, unknown>, component: unknown) => unknown
  }
  effect: (callback: () => unknown, label?: string) => void
}

const NS = 'dsh-plugin-leaderboard'

/** Browser services used to register the sidebar panel. */
export const inject = ['slots', 'locale']

/**
 * Mount the leaderboard as a sidebar footer action.
 * Failures are logged so a missing slot cannot take down the Web GUI.
 * @param ctx - browser root context
 */
export function apply(ctx: ClientContext): void {
  try {
    ensureLeaderboardStyles()
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-leaderboard: dictionaries')
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'dsh-plugin-leaderboard',
      order: 40,
      locale: NS,
    }, LeaderboardPanel))
  } catch (error) {
    console.error('[dsh-plugin-leaderboard] client apply failed', error)
  }
}
