import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LeaderboardCatalog } from './catalog.ts'

export interface WebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Same-origin path the Web UI fetches. */
export const LEADERBOARD_PATH = '/dsh-plugin-leaderboard'

/** Same-origin path the Web UI posts recommendations to. */
export const SUGGEST_PATH = '/dsh-plugin-leaderboard/suggest'

function send(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      if (chunks.length === 0) { resolve({}); return }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Expose the cached snapshot as JSON for the browser panel.
 * @param webServer - host HTTP carrier
 * @param catalog - shared GitHub cache
 */
export function registerLeaderboardRoute(
  webServer: WebServer,
  catalog: LeaderboardCatalog,
): () => void {
  const stopGet = webServer.register({
    kind: 'exact',
    path: LEADERBOARD_PATH,
    async handler(req: IncomingMessage, res: ServerResponse) {
      const method = req.method ?? 'GET'
      if (method === 'OPTIONS') {
        res.writeHead(204, { allow: 'GET, HEAD, POST' })
        res.end()
        return
      }
      if (method !== 'GET' && method !== 'HEAD') {
        send(res, 405, JSON.stringify({ error: 'method not allowed' }), 'application/json; charset=utf-8')
        return
      }
      try {
        const url = new URL(req.url ?? LEADERBOARD_PATH, 'http://dsh.local')
        const force = url.searchParams.get('refresh') === '1'
        if (url.searchParams.get('fresh') === '1') catalog.forget()
        const snapshot = await catalog.snapshot(force)
        const body = JSON.stringify(snapshot)
        if (method === 'HEAD') {
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': String(Buffer.byteLength(body)),
          })
          res.end()
          return
        }
        send(res, 200, body, 'application/json; charset=utf-8')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        send(res, 502, JSON.stringify({ error: message }), 'application/json; charset=utf-8')
      }
    },
  })
  const stopSuggest = webServer.register({
    kind: 'exact',
    path: SUGGEST_PATH,
    async handler(req: IncomingMessage, res: ServerResponse) {
      const method = req.method ?? 'GET'
      if (method === 'OPTIONS') {
        res.writeHead(204, { allow: 'POST' })
        res.end()
        return
      }
      if (method !== 'POST') {
        send(res, 405, JSON.stringify({ error: 'method not allowed' }), 'application/json; charset=utf-8')
        return
      }
      try {
        const body = await readJson(req)
        const result = await catalog.suggest({
          fullName: String(body.fullName ?? body.full_name ?? ''),
          reason: String(body.reason ?? ''),
        })
        send(res, result.ok ? 200 : 400, JSON.stringify(result), 'application/json; charset=utf-8')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        send(res, 502, JSON.stringify({ ok: false, status: 'error', error: message }), 'application/json; charset=utf-8')
      }
    },
  })
  return () => {
    stopGet()
    stopSuggest()
  }
}
