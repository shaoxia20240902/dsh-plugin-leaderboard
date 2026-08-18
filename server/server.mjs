/**
 * Public JSON API + GitHub sync for the dsh-plugin leaderboard.
 * Secrets come from the environment; this file is safe to commit.
 */
import http from 'node:http'
import { createConnection } from 'mysql2/promise'
import { fireScore, pickBoards } from './score.mjs'

const PORT = Number(process.env.PORT ?? 3090)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''
const TOPIC = process.env.TOPIC ?? 'dsh-plugin'
const HTML_BASE = process.env.GITHUB_HTML_BASE ?? 'https://kkgithub.com'
const CLONE_PROXY = (process.env.GITHUB_CLONE_PROXY ?? 'https://ghfast.top').replace(/\/+$/u, '')

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
  return `${HTML_BASE.replace(/\/+$/u, '')}/${fullName}`
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
    `镜像（打不开 GitHub 时用）：${browseUrl(repo.fullName)}`,
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
    mirrorUrl: browseUrl(repo.fullName),
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
    fetchedAt: syncRows[0]?.v ?? new Date().toISOString(),
    total: Number(countRows[0].n),
    incomplete: false,
    source: 'mysql',
    access: {
      mode: 'origin',
      apiUsed: apiRows[0]?.v || 'mysql',
      htmlBase: HTML_BASE,
      cloneProxy: CLONE_PROXY,
      proxied: true,
    },
    boards: {
      hot: board('hot', '最热', '长期影响力：star/fork 取对数，叠加是否还在维护、是不是真 DSH 插件。', picked.hot.map((row, i) => decorate(row, i + 1))),
      new: board('new', '最新', '新锐榜：越新越好，同样新的仓库里已经有人用的排前面。', picked.newest.map((row, i) => decorate(row, i + 1))),
      fire: board('fire', '最火 Top 10', '爆发力：单位时间涨星（重力衰减）× 近期是否还在动。', picked.fire.map((row, i) => decorate(row, i + 1))),
      recommend: board('recommend', '推荐', '人工精选、适合先装的插件。', recommendItems),
    },
  }
}

async function syncFromGithub() {
  const { repos, apiUsed } = await fetchCatalog()
  return withDb(async (conn) => {
    const stored = await upsertPlugins(conn, repos)
    await conn.execute(
      'INSERT INTO meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=VALUES(v)',
      ['api_used', apiUsed],
    )
    await seedRecommend(conn)
    return { stored, apiUsed, total: repos.length }
  })
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
    send(res, 200, { ok: true, service: 'dsh-plugin-board' })
    return
  }
  if (method === 'GET' && (url.pathname === '/v1/leaderboard' || url.pathname === '/dsh-plugin-leaderboard')) {
    const snapshot = await withDb(loadSnapshot)
    send(res, 200, snapshot)
    return
  }
  if (method === 'POST' && url.pathname === '/v1/sync') {
    if (!authorized(req)) { send(res, 401, { error: 'unauthorized' }); return }
    const result = await syncFromGithub()
    send(res, 200, { ok: true, ...result })
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
  const result = await syncFromGithub()
  console.log(JSON.stringify(result))
  process.exit(0)
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    send(res, 500, { error: message })
  })
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`dsh-plugin-board listening on 127.0.0.1:${PORT}`)
})
