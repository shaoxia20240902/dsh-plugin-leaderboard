window.__ModuleLoader__.load({
	id: "dsh-plugin-leaderboard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		//#endregion
		//#region src/client/styles.ts
		/** CSS injected once when the client factory runs. */
		const LEADERBOARD_CSS = `
.dsh-lb-layer{position:relative;flex:none;display:flex;align-items:center;width:100%;height:49px;margin:8px 0 0}
.dsh-lb-layer.is-rail{width:36px;height:36px;margin:0}
.dsh-lb-badge{display:inline-flex;align-items:center;gap:8px;width:100%;height:49px;padding:0 8px 0 6px;border:none;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer;overflow:hidden}
.dsh-lb-badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-lb-badge[data-active]{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-lb-layer.is-rail .dsh-lb-badge{justify-content:center;width:36px;height:36px;padding:0;border-radius:50%}
.dsh-lb-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-lb-layer.is-rail .dsh-lb-label{display:none}
.dsh-lb-icon{flex:none;display:inline-flex}
.dsh-lb-panel{position:fixed;left:12px;bottom:128px;z-index:40;display:flex;flex-direction:column;width:400px;max-width:calc(100vw - 24px);max-height:68vh;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv2)}
.dsh-lb-header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 8px}
.dsh-lb-heading{min-width:0}
.dsh-lb-title{display:block;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary)}
.dsh-lb-sub{display:block;margin-top:1px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-refresh{flex:none;height:24px;padding:0 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.dsh-lb-refresh:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-secondary)}
.dsh-lb-refresh:disabled{opacity:.55;cursor:default}
.dsh-lb-banner{flex:none;margin:0;padding:0 12px 6px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-tabs{flex:none;display:flex;gap:0;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-lb-tab{flex:1;height:30px;padding:0;border:none;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.dsh-lb-tab[data-active]{border-bottom-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-lb-body{flex:1;min-height:0;overflow-y:auto;padding:4px 4px 8px}
.dsh-lb-note,.dsh-lb-error{margin:10px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-error{color:var(--dsw-alias-state-error-primary)}
.dsh-lb-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.dsh-lb-row{display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;align-items:start;padding:10px 8px;border:none;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent}
.dsh-lb-row:last-child{border-bottom:none}
.dsh-lb-rank{width:22px;height:22px;margin-top:1px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);background:transparent}
.dsh-lb-rank.is-1{color:#8a5a00;background:#f6d58b}
.dsh-lb-rank.is-2{color:#3d4a5c;background:#d5dde8}
.dsh-lb-rank.is-3{color:#6a3b16;background:#e8c4a0}
.dsh-lb-main{min-width:0}
.dsh-lb-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary);text-decoration:none}
.dsh-lb-name:hover{text-decoration:underline}
.dsh-lb-desc{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;margin:2px 0 0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-lb-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-lb-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dsh-lb-action{height:24px;padding:0 8px;border:none;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dsh-lb-action:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.dsh-lb-action:disabled{opacity:.6;cursor:default}
`.trim();
		/** Inject or replace the panel stylesheet. */
		function ensureLeaderboardStyles() {
			if (typeof document === "undefined") return;
			const existing = document.querySelector("style[data-plugin-css=\"dsh-plugin-leaderboard\"]");
			if (existing !== null) {
				existing.textContent = LEADERBOARD_CSS;
				return;
			}
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-leaderboard";
			tag.dataset.pluginCss = "dsh-plugin-leaderboard";
			tag.textContent = LEADERBOARD_CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/LeaderboardPanel.tsx
		const HOST_PATH = "/dsh-plugin-leaderboard";
		const CACHE_KEY = "dsh-plugin-leaderboard-cache";
		const TABS = [
			"hot",
			"new",
			"fire",
			"download",
			"interpret",
			"recommend"
		];
		let memoryCache;
		function readCachedSnapshot() {
			if (memoryCache !== void 0 && looksLikeSnapshot(memoryCache)) return memoryCache;
			if (typeof sessionStorage === "undefined") return void 0;
			try {
				const raw = sessionStorage.getItem(CACHE_KEY);
				if (raw === null) return void 0;
				const parsed = JSON.parse(raw);
				return looksLikeSnapshot(parsed) ? parsed : void 0;
			} catch {
				return;
			}
		}
		function remember(snapshot) {
			memoryCache = snapshot;
			if (typeof sessionStorage === "undefined") return;
			try {
				sessionStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
			} catch {}
		}
		function TrophyIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M4.2 2.4h7.6v2.2c0 2.1-1.7 3.8-3.8 3.8S4.2 6.7 4.2 4.6V2.4Z",
						stroke: "currentColor",
						strokeWidth: "1.3"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M6.3 13.6h3.4M8 8.4v5.2",
						stroke: "currentColor",
						strokeWidth: "1.3",
						strokeLinecap: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M4.2 3.3H2.6A1.6 1.6 0 0 0 2.6 6.5 2.8 2.8 0 0 0 5 5.1M11.8 3.3h1.6a1.6 1.6 0 0 1 0 3.2 2.8 2.8 0 0 1-2.4-1.4",
						stroke: "currentColor",
						strokeWidth: "1.3",
						strokeLinecap: "round"
					})
				]
			});
		}
		async function loadSnapshot(refresh) {
			const timeoutMs = refresh ? 8e4 : 12e3;
			try {
				const response = await fetch(`${HOST_PATH}${refresh ? "?refresh=1" : ""}`, {
					cache: "no-store",
					signal: AbortSignal.timeout(timeoutMs)
				});
				if (response.ok) {
					const payload = await response.json();
					if (looksLikeSnapshot(payload)) return payload;
				}
			} catch {}
			try {
				return await fetchOriginSnapshot(DEFAULT_ORIGIN_URL, {
					refresh,
					signal: AbortSignal.timeout(timeoutMs)
				});
			} catch {}
			const access = resolveAccess({ access: "auto" });
			const pass = await fetchCatalog({
				topic: DEFAULT_TOPIC,
				starPages: 2,
				updatedPages: 1,
				access: "auto",
				apiBases: access.apiBases
			});
			return buildLeaderboard(pass.repos, {
				topic: DEFAULT_TOPIC,
				incomplete: pass.incomplete,
				access,
				snapshotAccess: {
					mode: access.mode,
					apiUsed: pass.apiUsed,
					htmlBase: access.htmlBase,
					cloneProxy: access.cloneProxy,
					proxied: isProxiedApi(pass.apiUsed)
				}
			});
		}
		function formatCount(value) {
			if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}k`;
			return String(value);
		}
		function ageLabel(iso) {
			const created = Date.parse(iso);
			if (!Number.isFinite(created)) return "";
			const days = Math.max(0, Math.round((Date.now() - created) / 864e5));
			if (days <= 0) return "today";
			if (days < 30) return `${days}d`;
			if (days < 365) return `${Math.round(days / 30)}mo`;
			return `${(days / 365).toFixed(1)}y`;
		}
		function formatWhen(iso) {
			const stamp = Date.parse(iso);
			if (!Number.isFinite(stamp)) return iso;
			const date = new Date(stamp);
			const pad = (value) => String(value).padStart(2, "0");
			return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
		async function writeClipboard(text) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				return false;
			}
		}
		function interpolate(template, params) {
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ""));
		}
		function RankBadge({ rank }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `dsh-lb-rank${rank === 1 || rank === 2 || rank === 3 ? ` is-${rank}` : ""}`,
				children: rank
			});
		}
		function officialUrl(item) {
			if (item.url.includes("://github.com/")) return item.url;
			return browseUrl(item.fullName);
		}
		async function postClick(fullName, kind) {
			try {
				const response = await fetch(`${HOST_PATH}/click`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						accept: "application/json"
					},
					body: JSON.stringify({
						fullName,
						kind
					}),
					signal: AbortSignal.timeout(8e3)
				});
				if (response.ok || response.status === 400) return await response.json();
			} catch {}
			return submitOriginClick(DEFAULT_ORIGIN_URL, {
				fullName,
				kind
			});
		}
		function PluginRow({ item, board, t }) {
			const [copied, setCopied] = (0, react.useState)(null);
			const [picked, setPicked] = (0, react.useState)(false);
			const [note, setNote] = (0, react.useState)(null);
			const openUrl = officialUrl(item);
			const mark = async (kind) => {
				if ((await postClick(item.fullName, kind)).status === "cooldown") setNote(t("cooldown"));
				else setNote(null);
				window.setTimeout(() => {
					setNote(null);
				}, 1600);
			};
			const copy = async (kind) => {
				if (!await writeClipboard(kind === "install" ? item.install : item.interpret || interpretPrompt(item))) return;
				setCopied(kind);
				window.setTimeout(() => {
					setCopied(null);
				}, 1600);
				mark(kind);
			};
			const recommend = () => {
				setPicked(true);
				window.setTimeout(() => {
					setPicked(false);
				}, 1600);
				mark("recommend");
			};
			const clickCount = board === "download" ? item.clicks ?? item.installClicks : board === "interpret" ? item.clicks ?? item.interpretClicks : board === "recommend" ? item.clicks ?? item.recommendClicks : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dsh-lb-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RankBadge, { rank: item.rank }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-lb-main",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							className: "dsh-lb-name",
							href: openUrl,
							target: "_blank",
							rel: "noreferrer",
							children: item.fullName
						}),
						item.description.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-lb-desc",
							children: item.description
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-lb-meta",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["★ ", formatCount(item.stars)] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [formatCount(item.forks), " fork"] }),
								item.createdAt.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: ageLabel(item.createdAt) }),
								clickCount !== void 0 && clickCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("clicks", { n: clickCount }) }),
								note !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: note })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-lb-actions",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-lb-action",
									onClick: () => {
										copy("install");
									},
									children: copied === "install" ? t("copied") : t("copy")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-lb-action",
									onClick: () => {
										copy("interpret");
									},
									children: copied === "interpret" ? t("interpreted") : t("interpret")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-lb-action",
									onClick: recommend,
									children: picked ? t("copied") : t("recommend")
								})
							]
						})
					]
				})]
			});
		}
		/** Sidebar footer action that opens the leaderboard panel. */
		function LeaderboardPanel({ wide, t }) {
			const cached = readCachedSnapshot();
			const [open, setOpen] = (0, react.useState)(false);
			const [board, setBoard] = (0, react.useState)("hot");
			const [snapshot, setSnapshot] = (0, react.useState)(cached);
			const [error, setError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(cached === void 0);
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [note, setNote] = (0, react.useState)(null);
			const [generation, setGeneration] = (0, react.useState)(0);
			const snapshotRef = (0, react.useRef)(snapshot);
			const wantRefreshRef = (0, react.useRef)(false);
			snapshotRef.current = snapshot;
			(0, react.useEffect)(() => {
				ensureLeaderboardStyles();
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				let current = true;
				const refresh = wantRefreshRef.current;
				if (!(snapshotRef.current !== void 0)) setLoading(true);
				else if (refresh) setRefreshing(true);
				loadSnapshot(refresh).then((next) => {
					if (!current) return;
					wantRefreshRef.current = false;
					remember(next);
					setSnapshot(next);
					setError(null);
					setLoading(false);
					setRefreshing(false);
					const status = next.refresh?.status;
					if (status === "busy") setNote("syncBusy");
					else if (status === "cooldown") setNote("syncCooldown");
					else setNote(null);
				}, (cause) => {
					if (!current) return;
					wantRefreshRef.current = false;
					setLoading(false);
					setRefreshing(false);
					if (snapshotRef.current === void 0) setError(cause instanceof Error ? cause.message : String(cause));
				});
				return () => {
					current = false;
				};
			}, [open, generation]);
			const translate = (key, params) => interpolate(t(key, params), params);
			const items = snapshot?.boards[board]?.items ?? [];
			const busy = loading || refreshing;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: wide ? "dsh-lb-layer" : "dsh-lb-layer is-rail",
				children: [open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsh-lb-panel",
					"aria-label": translate("title"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "dsh-lb-header",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-lb-heading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-lb-title",
									children: translate("title")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsh-lb-sub",
									children: [snapshot !== void 0 ? translate("subtitle", { total: snapshot.total }) : "", snapshot !== void 0 ? ` · ${translate("updatedAt", { time: formatWhen(snapshot.fetchedAt) })}` : ""]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-lb-refresh",
								disabled: busy,
								onClick: () => {
									wantRefreshRef.current = true;
									setGeneration((value) => value + 1);
								},
								children: refreshing ? translate("refreshing") : translate("refresh")
							})]
						}),
						note !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-lb-banner",
							children: translate(note)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-lb-tabs",
							role: "tablist",
							children: TABS.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "tab",
								className: "dsh-lb-tab",
								"data-active": board === id || void 0,
								"aria-selected": board === id,
								onClick: () => {
									setBoard(id);
								},
								children: translate(id)
							}, id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-lb-body",
							children: [
								loading && snapshot === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-lb-note",
									children: translate("loading")
								}),
								error !== null && snapshot === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "dsh-lb-error",
									role: "alert",
									children: [
										translate("error"),
										" ",
										error
									]
								}),
								snapshot !== void 0 && items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-lb-note",
									children: translate("empty")
								}),
								snapshot !== void 0 && items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
									className: "dsh-lb-list",
									children: items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginRow, {
										item,
										board,
										t: translate
									}, item.fullName))
								})
							]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsh-lb-badge",
					"data-active": open || void 0,
					"aria-label": translate("buttonAria"),
					"aria-expanded": open,
					onClick: () => {
						setOpen((value) => !value);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-lb-icon",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrophyIcon, {})
					}), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-lb-label",
						children: translate("button")
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Simplified Chinese copy for the sidebar panel. */
		const zh = {
			button: "插件榜",
			buttonAria: "打开社区插件排行榜",
			title: "插件榜",
			subtitle: "{total} 个仓库",
			hot: "最热",
			new: "最新",
			fire: "最火",
			download: "下载",
			interpret: "解读",
			recommend: "推荐",
			loading: "正在加载…",
			refreshing: "更新中",
			error: "暂时读不到排行榜。",
			retry: "重试",
			empty: "这一榜还没有条目。",
			copy: "安装",
			copied: "已复制",
			interpreted: "已复制",
			clicks: "{n} 次",
			cooldown: "15 分钟内已记过",
			refresh: "刷新",
			updatedAt: "{time}",
			syncBusy: "正在后台更新，先看当前数据。",
			syncCooldown: "刚刚更新过。"
		};
		/** English copy. */
		const en = {
			button: "Leaderboard",
			buttonAria: "Open the community plugin leaderboard",
			title: "Plugins",
			subtitle: "{total} repos",
			hot: "Hot",
			new: "New",
			fire: "Fire",
			download: "Installs",
			interpret: "Explain",
			recommend: "Picks",
			loading: "Loading…",
			refreshing: "Updating",
			error: "The leaderboard is temporarily unavailable.",
			retry: "Retry",
			empty: "This board has no entries yet.",
			copy: "Install",
			copied: "Copied",
			interpreted: "Copied",
			clicks: "{n}",
			cooldown: "Already counted in the last 15 minutes",
			refresh: "Refresh",
			updatedAt: "{time}",
			syncBusy: "A sync is already running.",
			syncCooldown: "Just updated."
		};
		//#endregion
		//#region src/client/index.ts
		const NS = "dsh-plugin-leaderboard";
		/** Browser services used to register the sidebar panel. */
		const inject = ["slots", "locale"];
		/**
		* Mount the leaderboard as a sidebar footer action.
		* Failures are logged so a missing slot cannot take down the Web GUI.
		* @param ctx - browser root context
		*/
		function apply(ctx) {
			try {
				ensureLeaderboardStyles();
				ctx.effect(() => ctx.locale.register(NS, {
					zh,
					en
				}), "dsh-plugin-leaderboard: dictionaries");
				ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
					name: "sidebar.footer.action",
					id: "dsh-plugin-leaderboard",
					order: 40,
					locale: NS
				}, LeaderboardPanel));
			} catch (error) {
				console.error("[dsh-plugin-leaderboard] client apply failed", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map