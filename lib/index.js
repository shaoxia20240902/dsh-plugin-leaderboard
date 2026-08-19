import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "schemastery";
//#region src/access.ts
/** Official GitHub API origin. */
const OFFICIAL_API = "https://api.github.com";
/** Official GitHub website. */
const OFFICIAL_HTML = "https://github.com";
/**
* Default website for「打开仓库」. Host-swap mirrors such as kkgithub.com
* 404 on most repos; the official page is the only reliable browse URL.
* Clone/install still use {@link DEFAULT_CLONE_PROXIES}.
*/
const DEFAULT_HTML_MIRROR = OFFICIAL_HTML;
/**
* Public HTTPS prefixes that fetch `https://api.github.com/...` or
* `https://github.com/...` on the user's behalf. These are unofficial and
* change often; override them from config when one dies.
*/
const DEFAULT_API_PROXIES = ["https://ghfast.top/https://api.github.com", "https://gh-proxy.com/https://api.github.com"];
/** Public prefixes that fetch `https://github.com/owner/repo.git`. */
const DEFAULT_CLONE_PROXIES = ["https://ghfast.top/", "https://gh-proxy.com/"];
function stripSlash(value) {
	return value.replace(/\/+$/u, "");
}
function splitCsv(raw) {
	if (raw === void 0 || raw.trim().length === 0) return [];
	return raw.split(/[\n,]/u).map((part) => part.trim()).filter((part) => part.length > 0);
}
/**
* Build the API origins to try, in order.
* `auto` = official first, then proxies. `direct` = official only. `proxy` = proxies only.
*/
function resolveApiBases(mode, extra = []) {
	const extras = extra.map(stripSlash).filter((base) => base.length > 0);
	if (mode === "direct") return extras.length > 0 ? extras : [OFFICIAL_API];
	if (mode === "proxy") return extras.length > 0 ? extras : [...DEFAULT_API_PROXIES];
	const auto = [
		OFFICIAL_API,
		...DEFAULT_API_PROXIES,
		...extras
	];
	return [...new Set(auto.map(stripSlash))];
}
/** Resolve browse / clone / API access from plugin config. */
function resolveAccess(input) {
	const mode = parseAccessMode(input.access);
	const extraApis = splitCsv(input.githubApiBase);
	const htmlDefault = DEFAULT_HTML_MIRROR;
	const cloneDefault = mode === "direct" ? "" : DEFAULT_CLONE_PROXIES[0];
	return {
		mode,
		apiBases: resolveApiBases(mode, extraApis),
		htmlBase: stripSlash(input.githubHtmlBase?.trim() || htmlDefault),
		cloneProxy: stripSlash(input.githubCloneProxy?.trim() || cloneDefault)
	};
}
function parseAccessMode(raw) {
	const value = (raw ?? "auto").trim().toLowerCase();
	if (value === "direct" || value === "proxy" || value === "auto") return value;
	return "auto";
}
/** Whether this API base is the official GitHub host (safe to attach a token). */
function isOfficialApi(apiBase) {
	try {
		return new URL(apiBase.includes("://") ? apiBase : `https://${apiBase}`).host === "api.github.com";
	} catch {
		return apiBase === OFFICIAL_API;
	}
}
/** Join an API origin with `/search/repositories?...`. */
function githubSearchUrl(apiBase, query) {
	const url = new URL(`${stripSlash(apiBase)}/search/repositories`);
	for (const [key, value] of query) url.searchParams.set(key, value);
	return url.toString();
}
/**
* Browse URL for「打开仓库」.
* Prefix proxies (`ghfast.top/https://github.com/...`) only proxy git/raw/release
* and return 403 on HTML, so they are rewritten to the official page.
* An explicit host-swap base is kept only when the operator set one.
*/
function browseUrl(fullName, htmlBase = DEFAULT_HTML_MIRROR) {
	const official = `${OFFICIAL_HTML}/${fullName}`;
	const base = stripSlash(htmlBase);
	if (base.length === 0 || base === "https://github.com") return official;
	if (isPrefixProxy(base) || base.includes("://github.com")) return official;
	return `${base}/${fullName}`;
}
function isPrefixProxy(base) {
	try {
		const host = new URL(base.includes("://") ? base : `https://${base}`).host;
		return host === "ghfast.top" || host === "gh-proxy.com" || host.endsWith(".gh-proxy.com");
	} catch {
		return false;
	}
}
/** Hosted detail page that works when github.com is blocked. */
function cardUrl(originUrl, fullName) {
	return `${stripSlash(originUrl)}/r/${fullName}`;
}
/** `git clone` URL. Empty proxy keeps the official git URL. */
function cloneUrl(fullName, cloneProxy = "") {
	const official = `${OFFICIAL_HTML}/${fullName}.git`;
	const prefix = stripSlash(cloneProxy);
	if (prefix.length === 0 || prefix === "https://github.com") return official;
	return `${prefix}/${official}`;
}
/** Install text: official one-liner, plus a proxy clone path when configured. */
function installCommand$1(fullName, cloneProxy = "") {
	const direct = `dsh plugin --profile web add github:${fullName}`;
	const prefix = stripSlash(cloneProxy);
	if (prefix.length === 0) return direct;
	const dir = `/tmp/dsh-install-${fullName.replaceAll("/", "-")}`;
	return [
		direct,
		"",
		"# 访问不了 GitHub 时，先走代理克隆再本地安装：",
		`git clone --depth 1 ${cloneUrl(fullName, prefix)} ${dir} && dsh plugin --profile web add ${dir}`
	].join("\n");
}
function isProxiedApi(apiUsed) {
	return !isOfficialApi(apiUsed);
}
//#endregion
//#region src/types.ts
/** Default hosted API that stores catalogs in MySQL. */
const DEFAULT_ORIGIN_URL = "http://101.34.27.122:3091";
/** Default GitHub topic used as the catalog source. */
const DEFAULT_TOPIC = "dsh-plugin";
/** The harness itself is not a community plugin. */
const DEFAULT_EXCLUDES = ["deepseek-ai/deepseek-harness"];
//#endregion
//#region src/github.ts
const PER_PAGE = 100;
const ATTEMPT_MS = 8e3;
function isBrowser() {
	return typeof globalThis.window !== "undefined";
}
function headers(token) {
	const next = {
		accept: "application/vnd.github+json",
		"x-github-api-version": "2022-11-28"
	};
	if (!isBrowser()) next["user-agent"] = "dsh-plugin-leaderboard";
	if (token !== void 0 && token.length > 0) next.authorization = `Bearer ${token}`;
	return next;
}
function mapItem(item) {
	const fullName = item.full_name ?? "";
	if (fullName.length === 0) return void 0;
	return {
		fullName,
		name: item.name ?? fullName.split("/")[1] ?? fullName,
		owner: item.owner?.login ?? fullName.split("/")[0] ?? "",
		url: item.html_url ?? `https://github.com/${fullName}`,
		description: item.description ?? "",
		stars: Number(item.stargazers_count ?? 0),
		forks: Number(item.forks_count ?? 0),
		createdAt: item.created_at ?? "",
		updatedAt: item.updated_at ?? "",
		language: item.language ?? null,
		archived: item.archived === true,
		fork: item.fork === true
	};
}
function shouldTryNext(status) {
	return status === 403 || status === 429 || status >= 500;
}
function mergeSignals(parent, timeoutMs) {
	const timeout = AbortSignal.timeout(timeoutMs);
	if (parent === void 0) return {
		signal: timeout,
		cancel: () => void 0
	};
	return {
		signal: AbortSignal.any([parent, timeout]),
		cancel: () => void 0
	};
}
async function searchPageOn(apiBase, query, page, sort, token, signal) {
	const url = githubSearchUrl(apiBase, new URLSearchParams({
		q: query,
		sort,
		order: "desc",
		per_page: String(PER_PAGE),
		page: String(page)
	}));
	const attachToken = isOfficialApi(apiBase) ? token : void 0;
	const { signal: attempt } = mergeSignals(signal, ATTEMPT_MS);
	const response = await fetch(url, {
		headers: headers(attachToken),
		signal: attempt
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`GitHub search HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""} via ${apiBase}`);
	}
	const body = await response.json();
	const repos = [];
	for (const item of body.items ?? []) {
		const mapped = mapItem(item);
		if (mapped !== void 0) repos.push(mapped);
	}
	return {
		repos,
		incomplete: body.incomplete_results === true,
		apiUsed: apiBase
	};
}
async function collectPages(apiBase, query, sort, pages, token, signal) {
	const repos = [];
	let incomplete = false;
	for (let page = 1; page <= pages; page += 1) {
		const pass = await searchPageOn(apiBase, query, page, sort, token, signal);
		repos.push(...pass.repos);
		if (pass.incomplete) incomplete = true;
		if (pass.repos.length < PER_PAGE) break;
	}
	return {
		repos,
		incomplete,
		apiUsed: apiBase
	};
}
async function fetchCatalogFrom(apiBase, options) {
	const query = `topic:${options.topic ?? "dsh-plugin"} is:public`;
	const starPages = options.starPages ?? 3;
	const updatedPages = options.updatedPages ?? 2;
	const stars = await collectPages(apiBase, query, "stars", starPages, options.token, options.signal);
	const updated = await collectPages(apiBase, query, "updated", updatedPages, options.token, options.signal);
	return {
		repos: [...stars.repos, ...updated.repos],
		incomplete: stars.incomplete || updated.incomplete,
		apiUsed: apiBase
	};
}
/**
* Load the merged `dsh-plugin` catalog. `auto` tries the official API, then public proxies.
* A token is attached only when talking to api.github.com.
*/
async function fetchCatalog(options = {}) {
	const bases = options.apiBases !== void 0 && options.apiBases.length > 0 ? options.apiBases : resolveApiBases(options.access ?? "auto");
	const errors = [];
	for (const apiBase of bases) try {
		return await fetchCatalogFrom(apiBase, options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		errors.push(message);
		const statusMatch = /HTTP (\d+)/u.exec(message);
		const status = statusMatch === null ? 0 : Number(statusMatch[1]);
		if (status !== 0 && !shouldTryNext(status) && options.access === "direct") break;
	}
	throw new Error(`GitHub 不可达（已尝试 ${bases.join("、")}）：${errors.join("；")}`);
}
/** Resolve a GitHub token from config or the process environment. */
function resolveGitHubToken(configured) {
	if (configured !== void 0 && configured.trim().length > 0) return configured.trim();
	if (typeof process === "undefined" || process.env === void 0) return void 0;
	const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	if (fromEnv === void 0 || fromEnv.trim().length === 0) return void 0;
	return fromEnv.trim();
}
//#endregion
//#region src/origin.ts
function isObject(value) {
	return typeof value === "object" && value !== null;
}
/**
* True when `value` has the three required boards.
* @param value - parsed JSON
*/
function looksLikeSnapshot(value) {
	if (!isObject(value) || !isObject(value.boards)) return false;
	return isObject(value.boards.hot) && isObject(value.boards.new) && isObject(value.boards.fire);
}
function isAbortSignal(value) {
	return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}
function resolveOptions(second) {
	if (second === void 0) return {};
	if (isAbortSignal(second)) return { signal: second };
	return second;
}
/**
* Load a snapshot from the hosted MySQL API.
* `refresh: true` asks the origin to sync GitHub under GET_LOCK; the
* response is still the current (or just-written) MySQL snapshot.
* @param originUrl - e.g. http://101.34.27.122:3091
* @param signalOrOpts - abort signal, or `{ signal, refresh }`
*/
async function fetchOriginSnapshot(originUrl, signalOrOpts) {
	const opts = resolveOptions(signalOrOpts);
	const base = originUrl.replace(/\/+$/u, "");
	const timeoutMs = opts.refresh === true ? 75e3 : 12e3;
	const response = await fetch(`${base}/v1/leaderboard${opts.refresh === true ? "?refresh=1" : ""}`, {
		signal: opts.signal ?? AbortSignal.timeout(timeoutMs),
		headers: { accept: "application/json" }
	});
	if (!response.ok) throw new Error(`origin HTTP ${response.status}`);
	const payload = await response.json();
	if (!looksLikeSnapshot(payload)) throw new Error("origin payload is not a leaderboard snapshot");
	return payload;
}
/**
* Record an install / interpret / recommend click on the hosted API.
* @param originUrl - e.g. http://101.34.27.122:3091
* @param input - repo and action
*/
async function submitOriginClick(originUrl, input) {
	const base = originUrl.replace(/\/+$/u, "");
	const response = await fetch(`${base}/v1/click`, {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json"
		},
		body: JSON.stringify({
			fullName: input.fullName,
			kind: input.kind
		}),
		signal: AbortSignal.timeout(12e3)
	});
	const payload = await response.json().catch(() => ({}));
	if (!isObject(payload)) throw new Error(`origin click HTTP ${response.status}`);
	return {
		ok: payload.ok === true,
		status: typeof payload.status === "string" ? payload.status : response.ok ? "ok" : "error",
		fullName: typeof payload.fullName === "string" ? payload.fullName : void 0,
		kind: typeof payload.kind === "string" ? payload.kind : void 0,
		clicks: typeof payload.clicks === "number" ? payload.clicks : void 0,
		error: typeof payload.error === "string" ? payload.error : void 0
	};
}
//#endregion
//#region src/interpret.ts
/**
* Default chat prompt: clone the repo, then explain it in plain language.
* The user copies this into the Harness composer.
*/
function interpretPrompt(repo, access = {}) {
	const description = repo.description.trim().length > 0 ? repo.description.trim() : "（仓库没有写简介）";
	const cloneDir = `/tmp/dsh-read-${repo.name}`;
	const htmlBase = access.htmlBase ?? "https://github.com";
	const cloneProxy = access.cloneProxy ?? DEFAULT_CLONE_PROXIES[0];
	const official = browseUrl(repo.fullName, htmlBase);
	const card = access.cardUrl;
	const viaProxy = cloneUrl(repo.fullName, cloneProxy);
	return [
		`请解读这个 DeepSeek Harness 社区插件。先把它 clone 到临时目录，读完 README、package.json、cordis.patch.yml 和 src 入口，再用大白话讲给我听，让我读完就知道它是干什么的、值不值得装。`,
		``,
		`仓库：${repo.fullName}`,
		`地址：${official}`,
		...card !== void 0 && card !== official ? [`详情页（打不开 GitHub 时用）：${card}`] : [],
		`简介：${description}`,
		`Star：${repo.stars}`,
		`克隆：git clone --depth 1 ${viaProxy} ${cloneDir}`,
		`直连克隆：git clone --depth 1 ${repo.url}.git ${cloneDir}`,
		`安装：dsh plugin --profile web add github:${repo.fullName}`,
		`打不开 GitHub 时：git clone --depth 1 ${viaProxy} ${cloneDir} && dsh plugin --profile web add ${cloneDir}`,
		``,
		`写作要求：`,
		`- 用中文，结论先行，像给同事口头讲，不要写成发布会稿或功能清单。`,
		`- 术语第一次出现用人话解释；能不堆概念就不堆。看不懂或没看到的实现细节，直接写「可以先不用管」或「我没看到」，不要编。`,
		`- 先 clone 再读文件。README 和源码打架时，以源码为准，并点明差异。`,
		``,
		`请按这个结构写：`,
		``,
		`1. 一句话它是啥`,
		`2. 它解决什么烦（没有它，我平时会卡在哪）`,
		`3. 装进 Harness 之后，我在界面里能直接看到或用到什么`,
		`4. 核心就这几块（最多 3 块，每块 2～4 句人话）`,
		`5. 我现在怎么上手：执行上面的安装命令之后的前三步`,
		`6. 适合谁，不适合谁`,
		`7. 风险和边界：第三方代码、权限、要不要钉 commit`,
		``,
		`最后用三句话收束：值不值得装、先试哪一个功能、有什么坑。`
	].join("\n");
}
//#endregion
//#region src/score.ts
const MS_PER_DAY = 864e5;
const RELEVANCE_NEEDLES = [
	"dsh-plugin",
	"deepseek-harness",
	"deepseek harness",
	"dsh ",
	" dsh",
	"/dsh",
	"cordis",
	"harness plugin"
];
function daysSince(iso, nowMs) {
	const stamp = Date.parse(iso);
	if (!Number.isFinite(stamp)) return 365;
	return Math.max((nowMs - stamp) / MS_PER_DAY, 0);
}
function log1p(value) {
	return Math.log(1 + Math.max(0, value));
}
/**
* 1 when updated today, ~0.5 after three weeks, ~0.1 after half a year.
*/
function freshness(updatedAt, nowMs) {
	return 1 / (1 + daysSince(updatedAt, nowMs) / 21);
}
/**
* 0..1: how clearly this repo looks like a real DeepSeek Harness plugin
* rather than an unrelated project that only added the topic.
*/
function relevance(repo) {
	const text = `${repo.fullName} ${repo.name} ${repo.description}`.toLowerCase();
	let hits = 0;
	if (/(^|[^a-z])dsh([^a-z]|$)/u.test(text) || text.includes("dsh-")) hits += 1;
	for (const needle of RELEVANCE_NEEDLES) if (text.includes(needle)) hits += 1;
	return Math.min(1, hits / 2);
}
/**
* 最热: long-run influence, not raw stars.
* Log-compress stars/forks so 100k cannot bury everything, reward repos
* that are still maintained, and nudge true DSH plugins above topic-spam.
*/
function hotScore(repo, nowMs) {
	const popularity = log1p(repo.stars) + .55 * log1p(repo.forks);
	const maintain = .6 * freshness(repo.updatedAt, nowMs);
	const rel = .4 * relevance(repo);
	const stale = daysSince(repo.updatedAt, nowMs) > 180 ? .25 : 0;
	return popularity + maintain + rel - stale;
}
/**
* 最新: new-and-notable. Recency of *creation* is the spine, but a same-week
* repo with real stars beats an empty shell created an hour ago.
*/
function newScore(repo, nowMs) {
	const recency = 1 / (1 + daysSince(repo.createdAt, nowMs) / 6);
	const traction = 1 + .9 * log1p(repo.stars) + .28 * log1p(repo.forks);
	return recency ** 1.8 * traction * (1 + .22 * relevance(repo));
}
/**
* 最火: outbreak velocity (HN-style gravity) × recent motion × relevance.
* A week-old 80-star plugin outruns a year-old 200-star repo that went quiet.
*/
function fireScore(repo, nowMs) {
	const ageDays = Math.max(daysSince(repo.createdAt, nowMs), .25);
	return (repo.stars + .65 * repo.forks) / (ageDays + 2) ** 1.55 * (1 + 1.2 * freshness(repo.updatedAt, nowMs)) * (1 + .28 * relevance(repo));
}
/** Backward-compatible alias used by older tests and stored `heat`. */
function heatScore(repo, nowMs) {
	return fireScore(repo, nowMs);
}
function byName(left, right) {
	return left.fullName.localeCompare(right.fullName);
}
function compareHot(left, right, nowMs) {
	return hotScore(right, nowMs) - hotScore(left, nowMs) || right.stars - left.stars || byName(left, right);
}
function compareNew(left, right, nowMs) {
	return newScore(right, nowMs) - newScore(left, nowMs) || Date.parse(right.createdAt) - Date.parse(left.createdAt) || byName(left, right);
}
function compareFire(left, right, nowMs) {
	return fireScore(right, nowMs) - fireScore(left, nowMs) || right.stars - left.stars || byName(left, right);
}
/** Rank one catalog into the three computed boards. */
function pickBoards(catalog, nowMs, limits) {
	return {
		hot: [...catalog].sort((left, right) => compareHot(left, right, nowMs)).slice(0, limits.hot),
		newest: [...catalog].sort((left, right) => compareNew(left, right, nowMs)).slice(0, limits.newest),
		fire: [...catalog].sort((left, right) => compareFire(left, right, nowMs)).slice(0, limits.fire)
	};
}
//#endregion
//#region src/rank.ts
/** Titles and one-line explanations for the boards. */
const BOARD_COPY = {
	hot: {
		title: "最热",
		description: "长期影响力：star/fork 取对数，叠加是否还在维护、是不是真 DSH 插件。"
	},
	new: {
		title: "最新",
		description: "新锐榜：越新越好，同样新的仓库里已经有人用的排前面。"
	},
	fire: {
		title: "最火 Top 10",
		description: "爆发力：单位时间涨星（重力衰减）× 近期是否还在动。"
	},
	download: {
		title: "下载",
		description: "按「安装」复制次数排序。同一 IP 同一仓库 15 分钟只计一次。"
	},
	interpret: {
		title: "解读",
		description: "按「解读」复制次数排序。同一 IP 同一仓库 15 分钟只计一次。"
	},
	recommend: {
		title: "推荐",
		description: "按「推荐」点击次数排序。同一 IP 同一仓库 15 分钟只计一次。"
	}
};
/** Ready-to-run install command for one GitHub-hosted plugin. */
function installCommand(fullName, cloneProxy = "") {
	return installCommand$1(fullName, cloneProxy);
}
function decorate(repos, nowMs, access) {
	const htmlBase = access?.htmlBase ?? "https://github.com";
	const cloneProxy = access?.cloneProxy ?? "";
	const cardBase = access?.cardBase?.trim() ?? "";
	return repos.map((repo, index) => ({
		...repo,
		rank: index + 1,
		heat: heatScore(repo, nowMs),
		install: installCommand(repo.fullName, cloneProxy),
		interpret: interpretPrompt(repo, {
			htmlBase,
			cloneProxy,
			cardUrl: cardBase.length > 0 ? cardUrl(cardBase, repo.fullName) : void 0
		}),
		mirrorUrl: cardBase.length > 0 ? cardUrl(cardBase, repo.fullName) : browseUrl(repo.fullName, htmlBase)
	}));
}
/** Drop archived repos, forks, and the configured exclude list. */
function catalogize(repos, excludes = DEFAULT_EXCLUDES) {
	const blocked = new Set(excludes.map((name) => name.toLowerCase()));
	const seen = /* @__PURE__ */ new Set();
	const catalog = [];
	for (const repo of repos) {
		const key = repo.fullName.toLowerCase();
		if (seen.has(key) || blocked.has(key) || repo.archived || repo.fork) continue;
		if (repo.fullName.length === 0) continue;
		seen.add(key);
		catalog.push(repo);
	}
	return catalog;
}
function board(id, repos, nowMs, access) {
	const copy = BOARD_COPY[id];
	return {
		id,
		title: copy.title,
		description: copy.description,
		items: decorate(repos, nowMs, access)
	};
}
/**
* Build the three boards from a merged GitHub catalog.
* @param repos - raw search hits, possibly overlapping or excluded
* @param options - topic label, fetch time, and incomplete-result flag
*/
function buildLeaderboard(repos, options) {
	const nowMs = options.nowMs ?? Date.now();
	const catalog = catalogize(repos, options.excludes);
	const picked = pickBoards(catalog, nowMs, {
		hot: options.hotLimit ?? 20,
		newest: options.newLimit ?? 20,
		fire: options.fireLimit ?? 10
	});
	const hot = picked.hot;
	const newest = picked.newest;
	const fire = picked.fire;
	const access = {
		...options.access,
		cardBase: options.cardBase ?? "http://101.34.27.122:3091"
	};
	return {
		topic: options.topic,
		fetchedAt: options.fetchedAt ?? new Date(nowMs).toISOString(),
		total: catalog.length,
		incomplete: options.incomplete === true,
		...options.snapshotAccess === void 0 ? {} : { access: options.snapshotAccess },
		boards: {
			hot: board("hot", hot, nowMs, access),
			new: board("new", newest, nowMs, access),
			fire: board("fire", fire, nowMs, access),
			download: board("download", [], nowMs, access),
			interpret: board("interpret", [], nowMs, access),
			recommend: board("recommend", [], nowMs, access)
		}
	};
}
/** Resolve a board id from slash-command or tool input. */
function parseBoardId(raw) {
	const value = (raw ?? "all").trim().toLowerCase();
	if (value === "" || value === "all" || value === "全部") return "all";
	if (value === "hot" || value === "最热" || value === "stars") return "hot";
	if (value === "new" || value === "最新" || value === "newest") return "new";
	if (value === "fire" || value === "最火" || value === "hotfire" || value === "top") return "fire";
	if (value === "download" || value === "下载" || value === "install") return "download";
	if (value === "interpret" || value === "解读" || value === "explain") return "interpret";
	if (value === "recommend" || value === "推荐" || value === "rec") return "recommend";
	return "all";
}
//#endregion
//#region src/catalog.ts
/**
* In-memory leaderboard cache shared by the tool, the slash command, and the HTTP route.
* Reads are never blocked on GitHub when a previous snapshot exists.
*/
var LeaderboardCatalog = class {
	config;
	cache;
	inflight;
	inflightForce = false;
	/**
	* @param config - plugin config captured at apply time
	*/
	constructor(config) {
		this.config = config;
	}
	/** Drop the in-memory snapshot so the next read hits the origin. */
	forget() {
		this.cache = void 0;
	}
	/**
	* Record a copy/recommend click on the hosted API.
	* @param input - repo and action
	*/
	async click(input) {
		const origin = this.config.originUrl?.trim() ?? "";
		if (origin.length === 0) throw new Error("originUrl is not configured");
		const result = await submitOriginClick(origin, input);
		if (result.status === "counted") this.forget();
		return result;
	}
	/**
	* Return a cached snapshot, serving stale data while a background refresh runs.
	* @param force - ask the origin to sync GitHub (locked); wait for that response
	* @param signal - abort the in-flight request
	*/
	async snapshot(force = false, signal) {
		if (!force && this.cache !== void 0) {
			if (this.cache.expiresAt <= Date.now()) this.startRefresh(false, signal).catch(() => void 0);
			return this.cache.snapshot;
		}
		return this.startRefresh(force, signal);
	}
	startRefresh(force, signal) {
		if (this.inflight !== void 0) {
			if (force && !this.inflightForce) return this.inflight.then(() => this.startRefresh(true, signal));
			if (!force && this.cache !== void 0) return Promise.resolve(this.cache.snapshot);
			return this.inflight;
		}
		this.inflightForce = force;
		this.inflight = this.refresh(force, signal).finally(() => {
			this.inflight = void 0;
			this.inflightForce = false;
		});
		return this.inflight;
	}
	async refresh(force, signal) {
		const origin = this.config.originUrl?.trim() ?? "";
		if (origin.length > 0) try {
			const remote = await fetchOriginSnapshot(origin, {
				signal,
				refresh: force
			});
			this.cache = {
				expiresAt: Date.now() + this.config.cacheTtlMs,
				snapshot: remote
			};
			return remote;
		} catch {
			if (this.cache !== void 0) return this.cache.snapshot;
		}
		const access = resolveAccess(this.config);
		const pass = await fetchCatalog({
			topic: this.config.topic,
			token: resolveGitHubToken(this.config.githubToken),
			starPages: this.config.starPages,
			updatedPages: this.config.updatedPages,
			signal,
			access: access.mode,
			apiBases: access.apiBases
		});
		const snapshot = buildLeaderboard(pass.repos, {
			topic: this.config.topic,
			incomplete: pass.incomplete,
			excludes: this.config.excludes,
			access,
			cardBase: this.config.originUrl,
			snapshotAccess: {
				mode: access.mode,
				apiUsed: pass.apiUsed,
				htmlBase: access.htmlBase,
				cloneProxy: access.cloneProxy,
				proxied: isProxiedApi(pass.apiUsed)
			}
		});
		this.cache = {
			expiresAt: Date.now() + this.config.cacheTtlMs,
			snapshot
		};
		return snapshot;
	}
};
//#endregion
//#region src/config.ts
/** Schemastery schema. Defaults live on the fields. */
const Config = Schema.object({
	githubToken: Schema.string(),
	access: Schema.string().default("auto"),
	githubApiBase: Schema.string(),
	githubHtmlBase: Schema.string(),
	githubCloneProxy: Schema.string(),
	topic: Schema.string().default(DEFAULT_TOPIC),
	cacheTtlMs: Schema.number().default(300 * 1e3),
	starPages: Schema.number().default(3),
	updatedPages: Schema.number().default(2),
	excludes: Schema.array(Schema.string()).default([...DEFAULT_EXCLUDES]),
	originUrl: Schema.string().default(DEFAULT_ORIGIN_URL)
});
//#endregion
//#region src/format.ts
function formatStars(stars) {
	if (stars >= 1e3) return `${(stars / 1e3).toFixed(stars >= 1e4 ? 0 : 1)}k`;
	return String(stars);
}
function formatItem(item) {
	const desc = item.description.length > 0 ? item.description : "(no description)";
	return [
		`${item.rank}. ${item.fullName}  ★${formatStars(item.stars)}  forks ${item.forks}`,
		`   ${desc}`,
		`   ${item.url}`,
		`   install: ${item.install}`
	].join("\n");
}
function formatBoard(board) {
	if (board === void 0) return "";
	if (board.items.length === 0) return `## ${board.title}\n\n暂无条目。`;
	return [
		`## ${board.title}`,
		"",
		board.description,
		"",
		...board.items.map(formatItem)
	].join("\n");
}
/**
* Render one or all boards as Markdown for the slash command and the tool card.
* @param snapshot - ranked boards
* @param rawBoard - optional board selector
*/
function formatLeaderboard(snapshot, rawBoard) {
	const selected = parseBoardId(rawBoard);
	return `${[
		`# dsh-plugin 排行榜`,
		``,
		`来源：GitHub topic \`${snapshot.topic}\` · 样本 ${snapshot.total} 个仓库 · ${snapshot.fetchedAt}`,
		snapshot.incomplete ? "GitHub 标记本次搜索结果不完整。" : ""
	].filter((line) => line.length > 0).join("\n")}\n\n${(selected === "all" ? [
		"hot",
		"new",
		"fire",
		"download",
		"interpret",
		"recommend"
	] : [selected]).map((id) => formatBoard(snapshot.boards[id])).join("\n\n")}\n${[
		"",
		`最热：${BOARD_COPY.hot.description}`,
		`最新：${BOARD_COPY.new.description}`,
		`最火：${BOARD_COPY.fire.description}`,
		`下载：${BOARD_COPY.download.description}`,
		`解读：${BOARD_COPY.interpret.description}`,
		`推荐：${BOARD_COPY.recommend.description}`,
		"",
		"侧边栏点「解读」会复制一段提示词，粘到对话框即可让智能体 clone 仓库并用大白话讲解。",
		"打不开 GitHub 时：打开仓库走网页镜像；复制安装里带有代理克隆后再本地安装的命令。",
		"这些仓库是第三方代码。安装前请阅读源码，并用 `github:owner/repo#<sha>` 钉住提交。"
	].join("\n")}`;
}
//#endregion
//#region src/http.ts
/** Same-origin path the Web UI fetches. */
const LEADERBOARD_PATH = "/dsh-plugin-leaderboard";
/** Same-origin path the Web UI posts copy / recommend clicks to. */
const CLICK_PATH = "/dsh-plugin-leaderboard/click";
function send(res, status, body, contentType) {
	res.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store"
	});
	res.end(body);
}
function readJson(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => {
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolve({});
				return;
			}
			try {
				const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				resolve(typeof parsed === "object" && parsed !== null ? parsed : {});
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}
/**
* Expose the cached snapshot as JSON for the browser panel.
* @param webServer - host HTTP carrier
* @param catalog - shared GitHub cache
*/
function registerLeaderboardRoute(webServer, catalog) {
	const stopGet = webServer.register({
		kind: "exact",
		path: LEADERBOARD_PATH,
		async handler(req, res) {
			const method = req.method ?? "GET";
			if (method === "OPTIONS") {
				res.writeHead(204, { allow: "GET, HEAD, POST" });
				res.end();
				return;
			}
			if (method !== "GET" && method !== "HEAD") {
				send(res, 405, JSON.stringify({ error: "method not allowed" }), "application/json; charset=utf-8");
				return;
			}
			try {
				const url = new URL(req.url ?? "/dsh-plugin-leaderboard", "http://dsh.local");
				const force = url.searchParams.get("refresh") === "1";
				if (url.searchParams.get("fresh") === "1") catalog.forget();
				const snapshot = await catalog.snapshot(force);
				const body = JSON.stringify(snapshot);
				if (method === "HEAD") {
					res.writeHead(200, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-store",
						"content-length": String(Buffer.byteLength(body))
					});
					res.end();
					return;
				}
				send(res, 200, body, "application/json; charset=utf-8");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				send(res, 502, JSON.stringify({ error: message }), "application/json; charset=utf-8");
			}
		}
	});
	const stopClick = webServer.register({
		kind: "exact",
		path: CLICK_PATH,
		async handler(req, res) {
			const method = req.method ?? "GET";
			if (method === "OPTIONS") {
				res.writeHead(204, { allow: "POST" });
				res.end();
				return;
			}
			if (method !== "POST") {
				send(res, 405, JSON.stringify({ error: "method not allowed" }), "application/json; charset=utf-8");
				return;
			}
			try {
				const body = await readJson(req);
				const result = await catalog.click({
					fullName: String(body.fullName ?? body.full_name ?? ""),
					kind: String(body.kind ?? "")
				});
				send(res, result.ok || result.status === "cooldown" ? 200 : 400, JSON.stringify(result), "application/json; charset=utf-8");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				send(res, 502, JSON.stringify({
					ok: false,
					status: "error",
					error: message
				}), "application/json; charset=utf-8");
			}
		}
	});
	return () => {
		stopGet();
		stopClick();
	};
}
//#endregion
//#region src/index.ts
function hostService(ctx, key) {
	return ctx.get(key);
}
/** Loader diagnostics name. */
const name = "dsh-plugin-leaderboard";
/** Host services used by the tool, command, prompt, and HTTP route. */
const inject = [
	"tools",
	"commands",
	"systemPrompt"
];
const PROMPT_TEXT = [
	"You can show the community DeepSeek Harness plugin leaderboard.",
	"Call list_dsh_plugin_leaderboard with board=hot (most stars), board=new (newest created), or board=fire (top 10 by heat).",
	"Omit board to return all three lists.",
	"The catalog is the public GitHub topic dsh-plugin. These are third-party repositories — tell the user to review the source and pin a commit before installing."
].join(" ");
/**
* Register the leaderboard tool, slash command, prompt note, and optional HTTP route.
* @param ctx - host context
* @param config - validated plugin config
*/
function apply(ctx, config) {
	const catalog = new LeaderboardCatalog(config);
	const commands = hostService(ctx, "commands");
	const systemPrompt = hostService(ctx, "systemPrompt");
	ctx.tools.register(defineTool({
		name: "list_dsh_plugin_leaderboard",
		description: "Show the DeepSeek Harness community plugin leaderboard from the public GitHub topic dsh-plugin. Boards: hot = most stars, new = newest created, fire = top 10 by heat (stars-per-day with a recency boost). Use when the user asks for popular, newest, or trending dsh plugins, or wants an install command.",
		parameters: {
			board: {
				type: "string",
				enum: [
					"hot",
					"new",
					"fire",
					"download",
					"interpret",
					"recommend",
					"all"
				],
				description: "Which board to return. Default all."
			},
			refresh: {
				type: "boolean",
				description: "Ask the hosted catalog to sync GitHub under a lock. Concurrent refreshes join or get the current MySQL snapshot."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, value) => {
				return [{
					type: "text",
					text: value.markdown ?? JSON.stringify(value)
				}];
			}
		},
		timeoutMs: 6e4,
		async execute(args) {
			const snapshot = await catalog.snapshot(args.refresh === true);
			const selected = parseBoardId(args.board);
			const payload = {
				topic: snapshot.topic,
				fetchedAt: snapshot.fetchedAt,
				total: snapshot.total,
				board: selected,
				markdown: formatLeaderboard(snapshot, selected),
				boards: selected === "all" ? snapshot.boards : { [selected]: snapshot.boards[selected] }
			};
			return JSON.parse(JSON.stringify(payload));
		}
	}));
	commands.register({
		name: "leaderboard",
		description: "Show the dsh-plugin leaderboard: 最热 / 最新 / 最火 Top 10.",
		input: { hint: "hot | new | fire" },
		async handler(invocation) {
			try {
				return {
					kind: "success",
					text: formatLeaderboard(await catalog.snapshot(false, invocation.signal), invocation.rawInput)
				};
			} catch (error) {
				return {
					kind: "error",
					text: `无法读取插件排行榜：${error instanceof Error ? error.message : String(error)}`
				};
			}
		}
	});
	systemPrompt.section({
		name: "dsh-plugin-leaderboard",
		order: 40,
		text: PROMPT_TEXT
	});
	ctx.inject(["webServer"], (child) => {
		child.effect(() => registerLeaderboardRoute(hostService(child, "webServer"), catalog));
	});
}
//#endregion
export { Config, apply, inject, name };
