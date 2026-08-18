import { useEffect, useState, type ReactElement } from 'react'
import { browseUrl, isProxiedApi, resolveAccess } from '../access.ts'
import { fetchCatalog } from '../github.ts'
import { interpretPrompt } from '../interpret.ts'
import { buildLeaderboard } from '../rank.ts'
import { DEFAULT_TOPIC, type BoardId, type LeaderboardSnapshot, type RankedPlugin } from '../types.ts'
import type { LeaderboardKey } from './locales.ts'
import { ensureLeaderboardStyles } from './styles.ts'

const HOST_PATH = '/dsh-plugin-leaderboard'

export interface LeaderboardPanelProps {
  readonly wide: boolean
  readonly t: (key: LeaderboardKey, params?: Record<string, string | number>) => string
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: LeaderboardSnapshot }

function TrophyIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.2 2.4h7.6v2.2c0 2.1-1.7 3.8-3.8 3.8S4.2 6.7 4.2 4.6V2.4Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M6.3 13.6h3.4M8 8.4v5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4.2 3.3H2.6A1.6 1.6 0 0 0 2.6 6.5 2.8 2.8 0 0 0 5 5.1M11.8 3.3h1.6a1.6 1.6 0 0 1 0 3.2 2.8 2.8 0 0 1-2.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

async function loadSnapshot(refresh: boolean): Promise<LeaderboardSnapshot> {
  try {
    const response = await fetch(`${HOST_PATH}${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
    if (response.ok) return await response.json() as LeaderboardSnapshot
  } catch {
    // Fall through to a direct GitHub read when the host route is not mounted.
  }
  const access = resolveAccess({ access: 'auto' })
  const pass = await fetchCatalog({
    topic: DEFAULT_TOPIC, starPages: 2, updatedPages: 1, access: 'auto', apiBases: access.apiBases,
  })
  return buildLeaderboard(pass.repos, {
    topic: DEFAULT_TOPIC, incomplete: pass.incomplete, access,
    snapshotAccess: {
      mode: access.mode,
      apiUsed: pass.apiUsed,
      htmlBase: access.htmlBase,
      cloneProxy: access.cloneProxy,
      proxied: isProxiedApi(pass.apiUsed),
    },
  })
}

function formatCount(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function ageLabel(iso: string): string {
  const created = Date.parse(iso)
  if (!Number.isFinite(created)) return ''
  const days = Math.max(0, Math.round((Date.now() - created) / 86_400_000))
  if (days <= 0) return 'today'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${(days / 365).toFixed(1)}y`
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''))
}

function RankBadge({ rank }: { rank: number }): ReactElement {
  const medal = rank === 1 || rank === 2 || rank === 3 ? ` is-${rank}` : ''
  return <span className={`dsh-lb-rank${medal}`}>{rank}</span>
}

function PluginRow({
  item,
  t,
}: {
  item: RankedPlugin
  t: LeaderboardPanelProps['t']
}): ReactElement {
  const [copied, setCopied] = useState<'install' | 'interpret' | null>(null)
  const openUrl = item.mirrorUrl || browseUrl(item.fullName)
  const copy = async (kind: 'install' | 'interpret'): Promise<void> => {
    const text = kind === 'install' ? item.install : (item.interpret || interpretPrompt(item))
    const ok = await writeClipboard(text)
    if (!ok) return
    setCopied(kind)
    window.setTimeout(() => { setCopied(null) }, 1600)
  }
  return (
    <li className="dsh-lb-row">
      <RankBadge rank={item.rank} />
      <div className="dsh-lb-main">
        <a className="dsh-lb-name" href={openUrl} target="_blank" rel="noreferrer">{item.fullName}</a>
        {item.description.length > 0 && <p className="dsh-lb-desc">{item.description}</p>}
        <div className="dsh-lb-meta">
          <span>★ {formatCount(item.stars)} {t('stars')}</span>
          <span>⌥ {formatCount(item.forks)} {t('forks')}</span>
          {item.createdAt.length > 0 && <span>{ageLabel(item.createdAt)}</span>}
        </div>
      </div>
      <div className="dsh-lb-actions">
        <button type="button" className="dsh-lb-action" onClick={() => { void copy('install') }}>
          {copied === 'install' ? t('copied') : t('copy')}
        </button>
        <button type="button" className="dsh-lb-action dsh-lb-action-interpret" onClick={() => { void copy('interpret') }}>
          {copied === 'interpret' ? t('interpreted') : t('interpret')}
        </button>
        <a className="dsh-lb-action" href={openUrl} target="_blank" rel="noreferrer">
          {t('open')}
        </a>
      </div>
    </li>
  )
}

/** Sidebar footer action: a trophy button that opens the three-board panel. */
export function LeaderboardPanel({ wide, t }: LeaderboardPanelProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [board, setBoard] = useState<BoardId>('hot')
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [request, setRequest] = useState(0)

  useEffect(() => { ensureLeaderboardStyles() }, [])

  useEffect(() => {
    if (!open) return
    let current = true
    setState({ status: 'loading' })
    void loadSnapshot(request > 0).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      (error: unknown) => {
        if (current) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    return () => { current = false }
  }, [open, request])

  const translate = (key: LeaderboardKey, params?: Record<string, string | number>): string =>
    interpolate(t(key, params), params)

  const items = state.status === 'ready' ? state.snapshot.boards[board].items : []

  return (
    <div className={wide ? 'dsh-lb-layer' : 'dsh-lb-layer is-rail'}>
      {open && (
        <section className="dsh-lb-panel" aria-label={translate('title')}>
          <header className="dsh-lb-header">
            <div className="dsh-lb-heading">
              <span className="dsh-lb-title">{translate('title')}</span>
              <span className="dsh-lb-sub">
                {translate('subtitle')}
                {state.status === 'ready' ? ` · ${translate('sample', { total: state.snapshot.total })}` : ''}
              </span>
            </div>
            <button
              type="button"
              className="dsh-lb-refresh"
              onClick={() => { setRequest(value => value + 1) }}
            >
              {translate('refresh')}
            </button>
          </header>
          <div className="dsh-lb-tabs" role="tablist">
            {(['hot', 'new', 'fire'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="dsh-lb-tab"
                data-active={board === id || undefined}
                aria-selected={board === id}
                onClick={() => { setBoard(id) }}
              >
                {translate(id)}
              </button>
            ))}
          </div>
          <div className="dsh-lb-body">
            {state.status === 'loading' && <p className="dsh-lb-note">{translate('loading')}</p>}
            {state.status === 'error' && (
              <p className="dsh-lb-error" role="alert">
                {translate('error')} {state.message}
              </p>
            )}
            {state.status === 'ready' && items.length === 0 && <p className="dsh-lb-note">{translate('empty')}</p>}
            {state.status === 'ready' && items.length > 0 && (
              <ol className="dsh-lb-list">
                {items.map(item => <PluginRow key={item.fullName} item={item} t={translate} />)}
              </ol>
            )}
          </div>
          <footer className="dsh-lb-foot">
            {state.status === 'ready' && state.snapshot.access?.proxied ? `${translate('proxied')} ` : ''}
            {state.status === 'ready' && state.snapshot.incomplete ? `${translate('incomplete')} ` : ''}
            {translate('heatHint')}
          </footer>
        </section>
      )}
      <button
        type="button"
        className="dsh-lb-badge"
        data-active={open || undefined}
        aria-label={translate('buttonAria')}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="dsh-lb-icon"><TrophyIcon /></span>
        {wide && <span className="dsh-lb-label">{translate('button')}</span>}
      </button>
    </div>
  )
}
