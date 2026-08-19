import { useEffect, useRef, useState, type ReactElement } from 'react'
import { browseUrl, isProxiedApi, resolveAccess } from '../access.ts'
import { fetchCatalog } from '../github.ts'
import { interpretPrompt } from '../interpret.ts'
import { fetchOriginSnapshot, looksLikeSnapshot, submitOriginClick } from '../origin.ts'
import { buildLeaderboard } from '../rank.ts'
import { DEFAULT_ORIGIN_URL, DEFAULT_TOPIC, type BoardId, type LeaderboardSnapshot, type RankedPlugin } from '../types.ts'
import type { LeaderboardKey } from './locales.ts'
import { ensureLeaderboardStyles } from './styles.ts'

const HOST_PATH = '/dsh-plugin-leaderboard'
const CACHE_KEY = 'dsh-plugin-leaderboard-cache'
const TABS: readonly BoardId[] = ['hot', 'new', 'fire', 'download', 'interpret', 'recommend']

export interface LeaderboardPanelProps {
  readonly wide: boolean
  readonly t: (key: LeaderboardKey, params?: Record<string, string | number>) => string
}

let memoryCache: LeaderboardSnapshot | undefined

function readCachedSnapshot(): LeaderboardSnapshot | undefined {
  if (memoryCache !== undefined && looksLikeSnapshot(memoryCache)) return memoryCache
  if (typeof sessionStorage === 'undefined') return undefined
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    return looksLikeSnapshot(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function remember(snapshot: LeaderboardSnapshot): void {
  memoryCache = snapshot
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // Quota or private mode — in-memory cache is enough for this tab.
  }
}

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
  const timeoutMs = refresh ? 80_000 : 12_000
  try {
    const response = await fetch(`${HOST_PATH}${refresh ? '?refresh=1' : ''}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.ok) {
      const payload: unknown = await response.json()
      if (looksLikeSnapshot(payload)) return payload
    }
  } catch {
    // Host route missing — try the hosted API, then GitHub.
  }
  try {
    return await fetchOriginSnapshot(DEFAULT_ORIGIN_URL, {
      refresh,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    // Fall through to GitHub only when both catalog endpoints failed.
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

function formatWhen(iso: string): string {
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return iso
  const date = new Date(stamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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

function officialUrl(item: RankedPlugin): string {
  if (item.url.includes('://github.com/')) return item.url
  return browseUrl(item.fullName)
}

async function postClick(fullName: string, kind: 'install' | 'interpret' | 'recommend'): Promise<{ status: string; clicks?: number }> {
  try {
    const response = await fetch(`${HOST_PATH}/click`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ fullName, kind }),
      signal: AbortSignal.timeout(8_000),
    })
    if (response.ok || response.status === 400) {
      return await response.json() as { status: string; clicks?: number }
    }
  } catch {
    // Host route missing — talk to the origin directly.
  }
  return submitOriginClick(DEFAULT_ORIGIN_URL, { fullName, kind })
}

function PluginRow({
  item,
  board,
  t,
}: {
  item: RankedPlugin
  board: BoardId
  t: LeaderboardPanelProps['t']
}): ReactElement {
  const [copied, setCopied] = useState<'install' | 'interpret' | null>(null)
  const [picked, setPicked] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const openUrl = officialUrl(item)

  const mark = async (kind: 'install' | 'interpret' | 'recommend'): Promise<void> => {
    const result = await postClick(item.fullName, kind)
    if (result.status === 'cooldown') setNote(t('cooldown'))
    else setNote(null)
    window.setTimeout(() => { setNote(null) }, 1600)
  }

  const copy = async (kind: 'install' | 'interpret'): Promise<void> => {
    const text = kind === 'install' ? item.install : (item.interpret || interpretPrompt(item))
    const ok = await writeClipboard(text)
    if (!ok) return
    setCopied(kind)
    window.setTimeout(() => { setCopied(null) }, 1600)
    void mark(kind)
  }

  const recommend = (): void => {
    setPicked(true)
    window.setTimeout(() => { setPicked(false) }, 1600)
    void mark('recommend')
  }

  const clickCount = board === 'download'
    ? item.clicks ?? item.installClicks
    : board === 'interpret'
      ? item.clicks ?? item.interpretClicks
      : board === 'recommend'
        ? item.clicks ?? item.recommendClicks
        : undefined

  return (
    <li className="dsh-lb-row">
      <RankBadge rank={item.rank} />
      <div className="dsh-lb-main">
        <a className="dsh-lb-name" href={openUrl} target="_blank" rel="noreferrer">{item.fullName}</a>
        {item.description.length > 0 && <p className="dsh-lb-desc">{item.description}</p>}
        <div className="dsh-lb-meta">
          <span>★ {formatCount(item.stars)}</span>
          <span>{formatCount(item.forks)} fork</span>
          {item.createdAt.length > 0 && <span>{ageLabel(item.createdAt)}</span>}
          {clickCount !== undefined && clickCount > 0 && <span>{t('clicks', { n: clickCount })}</span>}
          {note !== null && <span>{note}</span>}
        </div>
        <div className="dsh-lb-actions">
          <button type="button" className="dsh-lb-action" onClick={() => { void copy('install') }}>
            {copied === 'install' ? t('copied') : t('copy')}
          </button>
          <button type="button" className="dsh-lb-action" onClick={() => { void copy('interpret') }}>
            {copied === 'interpret' ? t('interpreted') : t('interpret')}
          </button>
          <button type="button" className="dsh-lb-action" onClick={recommend}>
            {picked ? t('copied') : t('recommend')}
          </button>
        </div>
      </div>
    </li>
  )
}

/** Sidebar footer action that opens the leaderboard panel. */
export function LeaderboardPanel({ wide, t }: LeaderboardPanelProps): ReactElement {
  const cached = readCachedSnapshot()
  const [open, setOpen] = useState(false)
  const [board, setBoard] = useState<BoardId>('hot')
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | undefined>(cached)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(cached === undefined)
  const [refreshing, setRefreshing] = useState(false)
  const [note, setNote] = useState<LeaderboardKey | null>(null)
  const [generation, setGeneration] = useState(0)
  const snapshotRef = useRef(snapshot)
  const wantRefreshRef = useRef(false)
  snapshotRef.current = snapshot

  useEffect(() => { ensureLeaderboardStyles() }, [])

  useEffect(() => {
    if (!open) return
    let current = true
    const refresh = wantRefreshRef.current
    const hasData = snapshotRef.current !== undefined
    if (!hasData) setLoading(true)
    else if (refresh) setRefreshing(true)

    void loadSnapshot(refresh).then(
      (next) => {
        if (!current) return
        wantRefreshRef.current = false
        remember(next)
        setSnapshot(next)
        setError(null)
        setLoading(false)
        setRefreshing(false)
        const status = next.refresh?.status
        if (status === 'busy') setNote('syncBusy')
        else if (status === 'cooldown') setNote('syncCooldown')
        else setNote(null)
      },
      (cause: unknown) => {
        if (!current) return
        wantRefreshRef.current = false
        setLoading(false)
        setRefreshing(false)
        if (snapshotRef.current === undefined) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      },
    )
    return () => { current = false }
  }, [open, generation])

  const translate = (key: LeaderboardKey, params?: Record<string, string | number>): string =>
    interpolate(t(key, params), params)

  const items = snapshot?.boards[board]?.items ?? []
  const busy = loading || refreshing

  return (
    <div className={wide ? 'dsh-lb-layer' : 'dsh-lb-layer is-rail'}>
      {open && (
        <section className="dsh-lb-panel" aria-label={translate('title')}>
          <header className="dsh-lb-header">
            <div className="dsh-lb-heading">
              <span className="dsh-lb-title">{translate('title')}</span>
              <span className="dsh-lb-sub">
                {snapshot !== undefined ? translate('subtitle', { total: snapshot.total }) : ''}
                {snapshot !== undefined ? ` · ${translate('updatedAt', { time: formatWhen(snapshot.fetchedAt) })}` : ''}
              </span>
            </div>
            <button
              type="button"
              className="dsh-lb-refresh"
              disabled={busy}
              onClick={() => {
                wantRefreshRef.current = true
                setGeneration(value => value + 1)
              }}
            >
              {refreshing ? translate('refreshing') : translate('refresh')}
            </button>
          </header>
          {note !== null && <p className="dsh-lb-banner">{translate(note)}</p>}
          <div className="dsh-lb-tabs" role="tablist">
            {TABS.map((id) => (
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
            {loading && snapshot === undefined && <p className="dsh-lb-note">{translate('loading')}</p>}
            {error !== null && snapshot === undefined && (
              <p className="dsh-lb-error" role="alert">
                {translate('error')} {error}
              </p>
            )}
            {snapshot !== undefined && items.length === 0 && <p className="dsh-lb-note">{translate('empty')}</p>}
            {snapshot !== undefined && items.length > 0 && (
              <ol className="dsh-lb-list">
                {items.map(item => (
                  <PluginRow key={item.fullName} item={item} board={board} t={translate} />
                ))}
              </ol>
            )}
          </div>
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
