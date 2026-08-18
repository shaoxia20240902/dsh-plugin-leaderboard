/**
 * Public JSON API + GitHub sync for the dsh-plugin leaderboard.
 * Secrets come from the environment; this file is safe to commit.
 */
import http from 'node:http'
import { createConnection } from 'mysql2/promise'
import { fireScore, pickBoards } from './score.mjs'
import {
  AUTO_INTERVAL_MS,
  MIN_MANUAL_INTERVAL_MS,
  SYNC_LOCK,
  decideSync,
} from './sync-policy.mjs'

const PORT = Number(process.env.PORT ?? 3090)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''
const TOPIC = process.env.TOPIC ?? 'dsh-plugin'
const PUBLIC_URL = (process.env.PUBLIC_URL ?? 'http://101.34.27.122:3091').replace(/\/+$/u, '')
const HTML_BASE = process.env.GITHUB_HTML_BASE ?? 'https://github.com'
const CLONE_PROXY = (process.env.GITHUB_CLONE_PROXY ?? 'https://ghfast.top').replace(/\/+$/u, '')
const SUGGEST_LOCK = 'dsh_plugin_board_suggest'
const SUGGEST_PER_IP = 5
const SUGGEST_REASON_MIN = 8
const SUGGEST_REASON_MAX = 400

const API_BASES = [
  'https://api.github.com',
  'https://ghfast.top/https://api.github.com',
  'https://gh-proxy.com/https://api.github.com',
]

const SEED_RECOMMEND = [
  { fullName: 'zhu1090093659/dsh-web-ui', rank: 1, reason: 'Web 界面全家桶：任务看板、Git 图谱、皮肤，装完侧边栏就能用。' },
  { fullName: 'anywhere-labs/deepseek-harness-desktop', rank: 2, reason: '桌面端，不想一直开浏览器时优先。' },
  { fullName: 'awesome-dsh-plugin/dsh-find-plugin', rank: 3, reason: '对话里搜社区插件，和排行榜互补。' },
  { fullName: 'omdsh-dev/DSH-better-sidebar', rank: 4, reason: '右侧资源管理器 / 编辑器 / 终端，补齐 IDE 感。' },
  { fullName: 'shaoxia20240902/dsh-plugin-leaderboard', rank: 5, reason: '本榜：最热 / 最新 / 最火 / 推荐。' },
]

function dbConfig() {
  return {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'dsh_board',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'dsh_plugin_board',
    charset: 'utf8mb4',
  }
}

async function withDb(fn) {
  const conn = await createConnection(dbConfig())
  try {
    return await fn(conn)
  } finally {
    await conn.end()
  }
}

function browseUrl(fullName) {
  return `https://github.com/${fullName}`
}

function cardUrl(fullName) {
  return `${PUBLIC_URL}/r/${fullName}`
}

function parseFullName(raw) {
  let value = String(raw ?? '').trim()
  if (value.length === 0) return ''
  value = value.replace(/^github:/i, '').replace(/\.git$/i, '')
  const nested = value.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i)
  if (nested) value = nested[1]
  else if (value.includes('://') || value.startsWith('github.com/')) {
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`)
      const parts = url.pathname.replace(/^\/+/u, '').split('/')
      if (parts.length >= 2) value = `${parts[0]}/${parts[1]}`
    } catch {
      return ''
    }
  }
  const [owner, repoPart] = value.split('/')
  const repo = (repoPart ?? '').split(/[/?#]/)[0]?.replace(/\.git$/i, '') ?? ''
  const fullName = `${owner}/${repo}`
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return ''
  if (fullName.toLowerCase() === 'deepseek-ai/deepseek-harness') return ''
  return fullName
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}

function cloneUrl(fullName) {
  return `${CLONE_PROXY}/https://github.com/${fullName}.git`
}

function installCommand(fullName) {
  const dir = `/tmp/dsh-install-${fullName.replaceAll('/', '-')}`
  return [
    `dsh plugin --profile web add github:${fullName}`,
    '',
    '# 访问不了 GitHub 时，先走代理克隆再本地安装：',
    `git clone --depth 1 ${cloneUrl(fullName)} ${dir} && dsh plugin --profile web add ${dir}`,
  ].join('\n')
}

function interpretPrompt(repo) {
  const description = (repo.description || '').trim() || '（仓库没有写简介）'
  const dir = `/tmp/dsh-read-${repo.name}`
  return [
    '请解读这个 DeepSeek Harness 社区插件。先把它 clone 到临时目录，读完 README、package.json、cordis.patch.yml 和 src 入口，再用大白话讲给我听，让我读完就知道它是干什么的、值不值得装。',
    '',
    `仓库：${repo.fullName}`,
    `地址：${repo.url}`,
    `详情页（打不开 GitHub 时用）：${cardUrl(repo.fullName)}`,
    `简介：${description}`,
    `Star：${repo.stars}`,
    `克隆：git clone --depth 1 ${cloneUrl(repo.fullName)} ${dir}`,
    `安装：dsh plugin --profile web add github:${repo.fullName}`,
    `打不开 GitHub 时：git clone --depth 1 ${cloneUrl(repo.fullName)} ${dir} && dsh plugin --profile web add ${dir}`,
    '',
    '写作要求：',
    '- 用中文，结论先行，像给同事口头讲，不要写成发布会稿或功能清单。',
    '- 术语第一次出现用人话解释；能不堆概念就不堆。看不懂或没看到的实现细节，直接写「可以先不用管」或「我没看到」，不要编。',
    '- 先 clone 再读文件。README 和源码打架时，以源码为准，并点明差异。',
    '',
    '请按这个结构写：',
    '',
    '1. 一句话它是啥',
    '2. 它解决什么烦（没有它，我平时会卡在哪）',
    '3. 装进 Harness 之后，我在界面里能直接看到或用到什么',
    '4. 核心就这几块（最多 3 块，每块 2～4 句人话）',
    '5. 我现在怎么上手：执行上面的安装命令之后的前三步',
    '6. 适合谁，不适合谁',
    '7. 风险和边界：第三方代码、权限、要不要钉 commit',
    '',
    '最后用三句话收束：值不值得装、先试哪一个功能、有什么坑。',
  ].join('\n')
}

function rowToRepo(row) {
  return {
    fullName: row.full_name ?? row.fullName,
    name: row.name,
    owner: row.owner,
    url: row.url,
    description: row.description ?? '',
    stars: Number(row.stars ?? 0),
    forks: Number(row.forks ?? 0),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    language: row.language ?? null,
    archived: Number(row.archived ?? 0) === 1,
    fork: Number(row.is_fork ?? row.fork ?? 0) === 1,
  }
}

function decorate(row, rank, extra = {}) {
  const repo = rowToRepo(row)
  return {
    ...repo,
    rank,
    heat: Number(row.heat ?? fireScore(repo, Date.now())),
    install: installCommand(repo.fullName),
    interpret: interpretPrompt(repo),
    mirrorUrl: cardUrl(repo.fullName),
    ...extra.reason ? { reason: extra.reason } : {},
  }
}

async function searchGithub(apiBase, sort, page) {
  const url = new URL(`${apiBase.replace(/\/+$/u, '')}/search/repositories`)
  url.searchParams.set('q', `topic:${TOPIC} is:public`)
  url.searchParams.set('sort', sort)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', '100')
  url.searchParams.set('page', String(page))
  const res = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-plugin-board-api',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status} via ${apiBase}`)
  const body = await res.json()
  return (body.items ?? []).map((item) => ({
    fullName: item.full_name,
    name: item.name,
    owner: item.owner?.login ?? '',
    url: item.html_url ?? `https://github.com/${item.full_name}`,
    description: item.description ?? '',
    stars: Number(item.stargazers_count ?? 0),
    forks: Number(item.forks_count ?? 0),
    createdAt: item.created_at ?? '',
    updatedAt: item.updated_at ?? '',
    language: item.language ?? null,
    archived: item.archived === true,
    fork: item.fork === true,
  })).filter(item => item.fullName)
}

async function fetchCatalog() {
  const errors = []
  for (const apiBase of API_BASES) {
    try {
      const repos = []
      for (const sort of ['stars', 'updated']) {
        for (let page = 1; page <= (sort === 'stars' ? 3 : 2); page += 1) {
          const batch = await searchGithub(apiBase, sort, page)
          repos.push(...batch)
          if (batch.length < 100) break
        }
      }
      return { repos, apiUsed: apiBase }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(`GitHub 不可达：${errors.join('；')}`)
}

async function upsertPlugins(conn, repos) {
  const now = Date.now()
  const fetchedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const seen = new Set()
  for (const repo of repos) {
    if (seen.has(repo.fullName) || repo.archived || repo.fork) continue
    if (repo.fullName === 'deepseek-ai/deepseek-harness') continue
    seen.add(repo.fullName)
    const heat = fireScore(repo, now)
    await conn.execute(
      `INSERT INTO plugins
        (full_name, name, owner, url, description, stars, forks, created_at, updated_at, language, archived, is_fork, heat, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        name=VALUES(name), owner=VALUES(owner), url=VALUES(url), description=VALUES(description),
        stars=VALUES(stars), forks=VALUES(forks), created_at=VALUES(created_at), updated_at=VALUES(updated_at),
        language=VALUES(language), archived=VALUES(archived), is_fork=VALUES(is_fork), heat=VALUES(heat),
        fetched_at=VALUES(fetched_at)`,
      [
        repo.fullName, repo.name, repo.owner, repo.url, repo.description,
        repo.stars, repo.forks, repo.createdAt, repo.updatedAt, repo.language,
        repo.archived ? 1 : 0, repo.fork ? 1 : 0, heat, fetchedAt,
      ],
    )
  }
  await conn.execute(
    'INSERT INTO meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=VALUES(v)',
    ['last_sync', new Date().toISOString()],
  )
  return seen.size
}

async function seedRecommend(conn) {
  const [rows] = await conn.query('SELECT COUNT(*) AS n FROM recommendations')
  if (Number(rows[0].n) > 0) return
  for (const item of SEED_RECOMMEND) {
    await conn.execute(
      `INSERT INTO recommendations (full_name, rank_no, reason, enabled, created_at)
       VALUES (?,?,?,1,NOW())`,
      [item.fullName, item.rank, item.reason],
    )
  }
}

function board(id, title, description, items) {
  return { id, title, description, items }
}

async function loadSnapshot(conn) {
  const [allRows] = await conn.query(
    'SELECT * FROM plugins WHERE archived=0 AND is_fork=0',
  )
  const catalog = allRows.map(rowToRepo)
  const picked = pickBoards(catalog, Date.now(), { hot: 20, newest: 20, fire: 10 })
  const [recRows] = await conn.query(
    `SELECT r.rank_no, r.reason, p.*
     FROM recommendations r
     LEFT JOIN plugins p ON p.full_name = r.full_name
     WHERE r.enabled=1
     ORDER BY r.rank_no ASC, r.full_name ASC
     LIMIT 20`,
  )
  const [countRows] = await conn.query('SELECT COUNT(*) AS n FROM plugins WHERE archived=0 AND is_fork=0')
  const [syncRows] = await conn.query("SELECT v FROM meta WHERE k='last_sync'")
  const [apiRows] = await conn.query("SELECT v FROM meta WHERE k='api_used'")
  const [statusRows] = await conn.query("SELECT v FROM meta WHERE k='sync_status'")
  const [lockRows] = await conn.query('SELECT IS_USED_LOCK(?) AS holder', [SYNC_LOCK])
  const lastSync = syncRows[0]?.v ?? null
  const lastSyncMs = lastSync ? Date.parse(lastSync) : 0
  const ageMs = Number.isFinite(lastSyncMs) && lastSyncMs > 0 ? Date.now() - lastSyncMs : null
  const syncing = lockRows[0]?.holder != null
  const recommendItems = recRows.map((row, index) => decorate({
    full_name: row.full_name,
    name: row.name ?? row.full_name.split('/')[1],
    owner: row.owner ?? row.full_name.split('/')[0],
    url: row.url ?? `https://github.com/${row.full_name}`,
    description: row.description ?? '',
    stars: row.stars ?? 0,
    forks: row.forks ?? 0,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
    language: row.language ?? null,
    archived: row.archived ?? 0,
    is_fork: row.is_fork ?? 0,
    heat: row.heat ?? 0,
  }, Number(row.rank_no ?? index + 1), { reason: row.reason }))
  return {
    topic: TOPIC,
    fetchedAt: lastSync ?? new Date().toISOString(),
    total: Number(countRows[0].n),
    incomplete: false,
    source: 'mysql',
    refresh: {
      status: syncing ? 'busy' : 'idle',
      lastSync: lastSync ?? undefined,
      syncing,
      autoMs: AUTO_INTERVAL_MS,
      minManualMs: MIN_MANUAL_INTERVAL_MS,
      ageMs: ageMs ?? undefined,
      syncStatus: statusRows[0]?.v ?? 'idle',
    },
    access: {
      mode: 'origin',
      apiUsed: apiRows[0]?.v || 'mysql',
      htmlBase: 'https://github.com',
      cloneProxy: CLONE_PROXY,
      proxied: true,
      cardBase: PUBLIC_URL,
    },
    boards: {
      hot: board('hot', '最热', '长期影响力：star/fork 取对数，叠加是否还在维护、是不是真 DSH 插件。', picked.hot.map((row, i) => decorate(row, i + 1))),
      new: board('new', '最新', '新锐榜：越新越好，同样新的仓库里已经有人用的排前面。', picked.newest.map((row, i) => decorate(row, i + 1))),
      fire: board('fire', '最火 Top 10', '爆发力：单位时间涨星（重力衰减）× 近期是否还在动。', picked.fire.map((row, i) => decorate(row, i + 1))),
      recommend: board('recommend', '推荐', '人工精选、适合先装的插件。', recommendItems),
    },
  }
}

async function writeMeta(conn, key, value) {
  await conn.execute(
    'INSERT INTO meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=VALUES(v)',
    [key, value],
  )
}

async function readMeta(conn, key) {
  const [rows] = await conn.query('SELECT v FROM meta WHERE k=?', [key])
  return rows[0]?.v ?? null
}

/** Same-process single-flight; GET_LOCK covers cron vs HTTP across processes. */
let syncInflight = undefined

/**
 * Pull GitHub into MySQL. Only one writer runs at a time.
 * @param {'cron' | 'manual' | 'force'} reason
 */
async function trySync(reason) {
  if (syncInflight !== undefined) {
    try {
      const result = await syncInflight
      return { ...result, status: result.status === 'ok' ? 'joined' : result.status }
    } catch (error) {
      return {
        started: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  syncInflight = (async () => {
    const conn = await createConnection(dbConfig())
    try {
      const [lockRows] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [SYNC_LOCK])
      if (Number(lockRows[0].got) !== 1) {
        return { started: false, status: 'busy' }
      }
      try {
        const last = await readMeta(conn, 'last_sync')
        const lastSyncMs = last ? Date.parse(last) : 0
        const decision = decideSync({
          reason,
          lastSyncMs: Number.isFinite(lastSyncMs) ? lastSyncMs : 0,
          nowMs: Date.now(),
        })
        if (decision === 'cooldown') {
          const ageMs = Date.now() - (Number.isFinite(lastSyncMs) ? lastSyncMs : 0)
          return {
            started: false,
            status: 'cooldown',
            lastSync: last ?? undefined,
            ageMs,
            minAgeMs: reason === 'cron' ? AUTO_INTERVAL_MS : MIN_MANUAL_INTERVAL_MS,
          }
        }
        await writeMeta(conn, 'sync_status', 'running')
        const { repos, apiUsed } = await fetchCatalog()
        const stored = await upsertPlugins(conn, repos)
        await writeMeta(conn, 'api_used', apiUsed)
        await seedRecommend(conn)
        await writeMeta(conn, 'sync_status', 'idle')
        return { started: true, status: 'ok', stored, apiUsed, total: repos.length }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          await writeMeta(conn, 'sync_status', `failed:${message.slice(0, 180)}`)
        } catch {
          // The connection may already be dead; GET_LOCK releases on close.
        }
        throw error
      } finally {
        await conn.query('SELECT RELEASE_LOCK(?) AS released', [SYNC_LOCK])
      }
    } finally {
      await conn.end()
    }
  })()

  try {
    return await syncInflight
  } finally {
    syncInflight = undefined
  }
}

function mergeRefresh(snapshot, extra) {
  return {
    ...snapshot,
    refresh: {
      ...snapshot.refresh,
      ...extra,
      lastSync: extra.lastSync ?? snapshot.refresh?.lastSync,
      syncing: extra.status === 'ok' || extra.status === 'joined' || extra.status === 'busy'
        ? extra.status === 'busy'
        : snapshot.refresh?.syncing === true,
    },
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      if (chunks.length === 0) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function authorized(req) {
  if (ADMIN_TOKEN.length === 0) return false
  const header = req.headers.authorization ?? ''
  return header === `Bearer ${ADMIN_TOKEN}`
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  })
  res.end(body)
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(html)
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return (forwarded || req.socket?.remoteAddress || '').slice(0, 64)
}

async function ensureSchema(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(200) NOT NULL,
      reason VARCHAR(500) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      ip VARCHAR(64) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL,
      KEY idx_full_name (full_name),
      KEY idx_status (status),
      KEY idx_ip_created (ip, created_at)
    ) DEFAULT CHARSET=utf8mb4
  `)
}

async function submitSuggestion(req) {
  const body = await readJson(req)
  const fullName = parseFullName(body.fullName ?? body.full_name ?? body.repo ?? '')
  const reason = String(body.reason ?? '').trim()
  if (fullName.length === 0) {
    return { status: 400, payload: { ok: false, status: 'invalid', error: '需要 owner/repo 或 GitHub 链接' } }
  }
  if (reason.length < SUGGEST_REASON_MIN || reason.length > SUGGEST_REASON_MAX) {
    return {
      status: 400,
      payload: {
        ok: false,
        status: 'invalid',
        error: `推荐理由需要 ${SUGGEST_REASON_MIN}～${SUGGEST_REASON_MAX} 个字`,
      },
    }
  }
  const ip = clientIp(req)
  return withDb(async (conn) => {
    await ensureSchema(conn)
    const [lockRows] = await conn.query('SELECT GET_LOCK(?, 3) AS got', [SUGGEST_LOCK])
    if (Number(lockRows[0].got) !== 1) {
      return { status: 200, payload: { ok: false, status: 'busy', error: '同时提交的人太多，请稍后再试' } }
    }
    try {
      const [ipRows] = await conn.query(
        'SELECT COUNT(*) AS n FROM suggestions WHERE ip=? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
        [ip],
      )
      if (Number(ipRows[0].n) >= SUGGEST_PER_IP) {
        return { status: 429, payload: { ok: false, status: 'rate_limited', error: '提交太勤，一小时后再试' } }
      }
      const [insertResult] = await conn.execute(
        `INSERT INTO suggestions (full_name, reason, status, ip, created_at)
         VALUES (?,?,?,?,NOW())`,
        [fullName, reason, 'pending', ip],
      )
      const suggestId = insertResult.insertId
      const [recRows] = await conn.query(
        'SELECT enabled FROM recommendations WHERE full_name=?',
        [fullName],
      )
      if (recRows[0] && Number(recRows[0].enabled) === 1) {
        await conn.execute('UPDATE suggestions SET status=? WHERE id=?', ['duplicate', suggestId])
        return { status: 200, payload: { ok: true, status: 'exists', fullName } }
      }
      const [plugRows] = await conn.query(
        'SELECT full_name FROM plugins WHERE full_name=? AND archived=0 AND is_fork=0',
        [fullName],
      )
      if (plugRows.length > 0) {
        const [maxRows] = await conn.query('SELECT COALESCE(MAX(rank_no), 0) + 1 AS n FROM recommendations')
        await conn.execute(
          `INSERT INTO recommendations (full_name, rank_no, reason, enabled, created_at)
           VALUES (?,?,?,1,NOW())
           ON DUPLICATE KEY UPDATE reason=VALUES(reason), enabled=1`,
          [fullName, Number(maxRows[0].n), reason],
        )
        await conn.execute('UPDATE suggestions SET status=? WHERE id=?', ['approved', suggestId])
        return { status: 200, payload: { ok: true, status: 'published', fullName } }
      }
      return { status: 200, payload: { ok: true, status: 'pending', fullName } }
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?) AS released', [SUGGEST_LOCK])
    }
  })
}

function renderRepoCard(fullName, row) {
  const official = browseUrl(fullName)
  const clone = cloneUrl(fullName)
  const install = escapeHtml(installCommand(fullName))
  const name = escapeHtml(fullName)
  const description = escapeHtml((row?.description ?? '').trim() || '目录里还没有这份简介，先看 GitHub 或按下面的命令 clone。')
  const stars = row ? Number(row.stars ?? 0) : '—'
  const forks = row ? Number(row.forks ?? 0) : '—'
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${name} · dsh-plugin</title>
  <style>
    body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1b1b1b;background:#f6f5f2}
    main{max-width:720px;margin:0 auto;padding:32px 20px 48px}
    h1{margin:0 0 8px;font-size:22px}
    .meta{color:#666;font-size:13px}
    p{margin:12px 0}
    a{color:#0b57d0}
    pre{overflow:auto;padding:12px;border-radius:10px;background:#111;color:#f3f3f3;font-size:12px}
    .row{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
    .btn{display:inline-block;padding:8px 12px;border-radius:8px;background:#111;color:#fff;text-decoration:none}
    .btn.alt{background:#fff;color:#111;border:1px solid #ccc}
  </style>
</head>
<body>
  <main>
    <h1>${name}</h1>
    <div class="meta">★ ${stars} · ⌥ ${forks} · GitHub topic dsh-plugin</div>
    <p>${description}</p>
    <div class="row">
      <a class="btn" href="${escapeHtml(official)}">打开 GitHub</a>
      <a class="btn alt" href="${escapeHtml(clone)}">代理克隆地址</a>
    </div>
    <p>打不开 GitHub 时用下面的代理克隆命令，不要再用会 404 的网页镜像。</p>
    <pre>${install}</pre>
    <p class="meta">详情页由排行榜服务器提供，不经过第三方网页镜像。</p>
  </main>
</body>
</html>`
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://dsh-board.local')
  const method = req.method ?? 'GET'
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    })
    res.end()
    return
  }
  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/v1/health')) {
    const info = await withDb(async (conn) => {
      const lastSync = await readMeta(conn, 'last_sync')
      const syncStatus = await readMeta(conn, 'sync_status')
      const [lockRows] = await conn.query('SELECT IS_USED_LOCK(?) AS holder', [SYNC_LOCK])
      return {
        lastSync,
        syncStatus: syncStatus ?? 'idle',
        syncing: lockRows[0]?.holder != null,
        autoMs: AUTO_INTERVAL_MS,
        minManualMs: MIN_MANUAL_INTERVAL_MS,
      }
    })
    send(res, 200, { ok: true, service: 'dsh-plugin-board', ...info })
    return
  }
  if (method === 'GET' && (url.pathname === '/v1/leaderboard' || url.pathname === '/dsh-plugin-leaderboard')) {
    const wantRefresh = url.searchParams.get('refresh') === '1'
    let extra
    if (wantRefresh) {
      try {
        extra = await trySync('manual')
      } catch (error) {
        extra = {
          started: false,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    const snapshot = await withDb(loadSnapshot)
    send(res, 200, extra === undefined ? snapshot : mergeRefresh(snapshot, extra))
    return
  }
  if (method === 'POST' && url.pathname === '/v1/sync') {
    if (!authorized(req)) { send(res, 401, { error: 'unauthorized' }); return }
    try {
      const result = await trySync('force')
      send(res, 200, { ok: true, ...result })
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (method === 'GET' && url.pathname.startsWith('/r/')) {
    const fullName = parseFullName(url.pathname.slice('/r/'.length))
    if (fullName.length === 0) {
      sendHtml(res, 404, renderRepoCard('unknown/repo', null))
      return
    }
    const row = await withDb(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM plugins WHERE full_name=?', [fullName])
      return rows[0] ?? null
    })
    sendHtml(res, 200, renderRepoCard(fullName, row))
    return
  }
  if (method === 'POST' && url.pathname === '/v1/suggest') {
    const result = await submitSuggestion(req)
    send(res, result.status, result.payload)
    return
  }
  if (method === 'GET' && url.pathname === '/v1/suggest') {
    if (!authorized(req)) { send(res, 401, { error: 'unauthorized' }); return }
    const rows = await withDb(async (conn) => {
      await ensureSchema(conn)
      const [list] = await conn.query(
        `SELECT id, full_name, reason, status, created_at
         FROM suggestions ORDER BY id DESC LIMIT 50`,
      )
      return list
    })
    send(res, 200, { ok: true, items: rows })
    return
  }
  if (method === 'POST' && url.pathname === '/v1/refresh') {
    try {
      const result = await trySync('manual')
      const snapshot = await withDb(loadSnapshot)
      send(res, 200, mergeRefresh(snapshot, result))
    } catch (error) {
      const snapshot = await withDb(loadSnapshot)
      send(res, 200, mergeRefresh(snapshot, {
        started: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }))
    }
    return
  }
  if (method === 'POST' && url.pathname === '/v1/recommend') {
    if (!authorized(req)) { send(res, 401, { error: 'unauthorized' }); return }
    const body = await readJson(req)
    const fullName = String(body.fullName ?? body.full_name ?? '').trim()
    const reason = String(body.reason ?? '').trim()
    const rank = Number(body.rank ?? body.rank_no ?? 99)
    if (!fullName.includes('/') || reason.length === 0) {
      send(res, 400, { error: 'fullName and reason required' })
      return
    }
    await withDb(async conn => {
      await conn.execute(
        `INSERT INTO recommendations (full_name, rank_no, reason, enabled, created_at)
         VALUES (?,?,?,1,NOW())
         ON DUPLICATE KEY UPDATE rank_no=VALUES(rank_no), reason=VALUES(reason), enabled=1`,
        [fullName, Number.isFinite(rank) ? rank : 99, reason],
      )
    })
    send(res, 200, { ok: true, fullName })
    return
  }
  if (method === 'DELETE' && url.pathname.startsWith('/v1/recommend/')) {
    if (!authorized(req)) { send(res, 401, { error: 'unauthorized' }); return }
    const fullName = decodeURIComponent(url.pathname.slice('/v1/recommend/'.length))
    await withDb(async conn => {
      await conn.execute('UPDATE recommendations SET enabled=0 WHERE full_name=?', [fullName])
    })
    send(res, 200, { ok: true, fullName })
    return
  }
  send(res, 404, { error: 'not found' })
}

if (process.argv.includes('--sync')) {
  const reason = process.argv.includes('--force') ? 'force' : 'cron'
  try {
    const result = await trySync(reason)
    console.log(JSON.stringify(result))
    process.exit(result.status === 'failed' ? 1 : 0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    send(res, 500, { error: message })
  })
})
server.listen(PORT, '127.0.0.1', async () => {
  try {
    await withDb(ensureSchema)
  } catch (error) {
    console.error('ensureSchema failed', error)
  }
  console.log(`dsh-plugin-board listening on 127.0.0.1:${PORT}`)
})
