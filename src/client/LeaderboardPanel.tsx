import { useEffect, useRef, useState, type ReactElement } from 'react'
import { browseUrl, cardUrl, isProxiedApi, resolveAccess } from '../access.ts'
import { fetchCatalog } from '../github.ts'
import { interpretPrompt } from '../interpret.ts'
import { fetchOriginSnapshot, looksLikeSnapshot, submitOriginSuggestion } from '../origin.ts'
import { buildLeaderboard } from '../rank.ts'
import { parseRepoRef } from '../repo-ref.ts'
import { DEFAULT_ORIGIN_URL, DEFAULT_TOPIC, type BoardId, type LeaderboardSnapshot, type RankedPlugin } from '../types.ts'
import type { LeaderboardKey } from './locales.ts'
import { ensureLeaderboardStyles } from './styles.ts'

const HOST_PATH = '/dsh-plugin-leaderboard'
const CACHE_KEY = 'dsh-plugin-leaderboard-cache'

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

function detailUrl(item: RankedPlugin): string {
  if (item.mirrorUrl.length > 0 && !item.mirrorUrl.includes('kkgithub.com')) return item.mirrorUrl
  return cardUrl(DEFAULT_ORIGIN_URL, item.fullName)
}

async function postSuggestion(fullName: string, reason: string): Promise<{ ok: boolean; status: string; error?: string }> {
  try {
    const response = await fetch('/dsh-plugin-leaderboard/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ fullName, reason }),
      signal: AbortSignal.timeout(12_000),
    })
    if (response.ok || response.status === 400 || response.status === 429) {
      return await response.json() as { ok: boolean; status: string; error?: string }
    }
  } catch {
    // Host route missing — talk to the origin directly.
  }
  return submitOriginSuggestion(DEFAULT_ORIGIN_URL, { fullName, reason })
}

function PluginRow({
  item,
  t,
  onSuggest,
}: {
  item: RankedPlugin
  t: LeaderboardPanelProps['t']
  onSuggest: (fullName: string) => void
}): ReactElement {
  const [copied, setCopied] = useState<'install' | 'interpret' | null>(null)
  const openUrl = officialUrl(item)
  const card = detailUrl(item)
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
        {item.reason ? <p className="dsh-lb-desc">{item.reason}</p> : null}
        {!item.reason && item.description.length > 0 && <p className="dsh-lb-desc">{item.description}</p>}
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
        <a className="dsh-lb-action" href={card} target="_blank" rel="noreferrer">
          {t('card')}
        </a>
        <button type="button" className="dsh-lb-action" onClick={() => { onSuggest(item.fullName) }}>
          {t('suggestThis')}
        </button>
      </div>
    </li>
  )
}

function RecommendForm({
  t,
  draft,
  onPublished,
}: {
  t: (key: LeaderboardKey, params?: Record<string, string | number>) => string
  draft: string
  onPublished: () => void
}): ReactElement {
  const [repo, setRepo] = useState(draft)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { setRepo(draft) }, [draft])

  const submit = async (): Promise<void> => {
    const fullName = parseRepoRef(repo)
    const trimmed = reason.trim()
    if (fullName === undefined || trimmed.length < 8) {
      setNote({ kind: 'err', text: t('suggestInvalid') })
      return
    }
    setBusy(true)
    setNote(null)
    try {
      const result = await postSuggestion(fullName, trimmed)
      if (result.status === 'published') {
        setNote({ kind: 'ok', text: t('suggestPublished') })
        setReason('')
        onPublished()
      } else if (result.status === 'pending') {
        setNote({ kind: 'ok', text: t('suggestPending') })
        setReason('')
      } else if (result.status === 'exists') {
        setNote({ kind: 'ok', text: t('suggestExists') })
      } else {
        setNote({ kind: 'err', text: result.error || t('suggestError') })
      }
    } catch (error) {
      setNote({ kind: 'err', text: error instanceof Error ? error.message : t('suggestError') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="dsh-lb-suggest"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h3>{t('suggest')}</h3>
      <div className="dsh-lb-field">
        <label htmlFor="dsh-lb-repo">{t('suggestRepo')}</label>
        <input
          id="dsh-lb-repo"
          value={repo}
          placeholder={t('suggestRepoHint')}
          onChange={(event) => { setRepo(event.target.value) }}
        />
      </div>
      <div className="dsh-lb-field">
        <label htmlFor="dsh-lb-reason">{t('suggestReason')}</label>
        <textarea
          id="dsh-lb-reason"
          value={reason}
          placeholder={t('suggestReasonHint')}
          onChange={(event) => { setReason(event.target.value) }}
        />
      </div>
      <button type="submit" className="dsh-lb-suggest-submit" disabled={busy}>
        {busy ? t('suggestBusy') : t('suggestSubmit')}
      </button>
      {note !== null && (
        <p className={note.kind === 'err' ? 'dsh-lb-error' : 'dsh-lb-note'}>{note.text}</p>
      )}
    </form>
  )
}

/** Sidebar footer action: a trophy button that opens the four-board panel. */
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
  const [draft, setDraft] = useState('')
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
                {translate('subtitle')}
                {snapshot !== undefined ? ` · ${translate('sample', { total: snapshot.total })}` : ''}
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
            {(['hot', 'new', 'fire', 'recommend'] as const).map((id) => (
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
                  <PluginRow
                    key={item.fullName}
                    item={item}
                    t={translate}
                    onSuggest={(fullName) => {
                      setDraft(fullName)
                      setBoard('recommend')
                    }}
                  />
                ))}
              </ol>
            )}
            {board === 'recommend' && (
              <RecommendForm
                t={translate}
                draft={draft}
                onPublished={() => {
                  void fetch(`${HOST_PATH}?fresh=1`, { cache: 'no-store', signal: AbortSignal.timeout(12_000) })
                    .then(async (response) => {
                      if (!response.ok) throw new Error('fresh failed')
                      return await response.json() as unknown
                    })
                    .then((payload) => {
                      if (!looksLikeSnapshot(payload)) return
                      remember(payload)
                      setSnapshot(payload)
                    })
                    .catch(() => {
                      void fetchOriginSnapshot(DEFAULT_ORIGIN_URL).then((next) => {
                        remember(next)
                        setSnapshot(next)
                      })
                    })
                }}
              />
            )}
          </div>
          <footer className="dsh-lb-foot">
            {snapshot?.access?.proxied === true ? `${translate('proxied')} ` : ''}
            {snapshot?.incomplete === true ? `${translate('incomplete')} ` : ''}
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
