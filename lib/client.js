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
		/** Web UI mirror that swaps the github.com host. */
		const DEFAULT_HTML_MIRROR = "https://kkgithub.com";
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
			const htmlDefault = mode === "direct" ? OFFICIAL_HTML : DEFAULT_HTML_MIRROR;
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
		/** Browse URL: host mirror (`kkgithub.com/a/b`) or official. */
		function browseUrl(fullName, htmlBase = DEFAULT_HTML_MIRROR) {
			const official = `${OFFICIAL_HTML}/${fullName}`;
			const base = stripSlash(htmlBase);
			if (base.length === 0 || base === "https://github.com") return official;
			if (base.includes("://github.com")) return `${base}/${fullName}`;
			return `${base}/${fullName}`;
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
			const htmlBase = access.htmlBase ?? "https://kkgithub.com";
			const cloneProxy = access.cloneProxy ?? DEFAULT_CLONE_PROXIES[0];
			const mirror = browseUrl(repo.fullName, htmlBase);
			const viaProxy = cloneUrl(repo.fullName, cloneProxy);
			return [
				`请解读这个 DeepSeek Harness 社区插件。先把它 clone 到临时目录，读完 README、package.json、cordis.patch.yml 和 src 入口，再用大白话讲给我听，让我读完就知道它是干什么的、值不值得装。`,
				``,
				`仓库：${repo.fullName}`,
				`地址：${repo.url}`,
				`镜像（打不开 GitHub 时用）：${mirror}`,
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
		//#region src/rank.ts
		const MS_PER_DAY = 864e5;
		/** Titles and one-line explanations for the three boards. */
		const BOARD_COPY = {
			hot: {
				title: "最热",
				description: "按 GitHub star 数从高到低，看长期人气最高的插件。"
			},
			new: {
				title: "最新",
				description: "按仓库创建时间从新到旧，看刚进生态的插件。"
			},
			fire: {
				title: "最火 Top 10",
				description: "按星标密度和近期活跃度打分，取当前最火的 10 个。"
			}
		};
		/**
		* Heat score: stars per day of age, boosted when the repo was updated recently.
		* A week-old 70-star plugin outranks a year-old 200-star plugin that went quiet.
		*/
		function heatScore(repo, nowMs) {
			const created = Date.parse(repo.createdAt);
			const updated = Date.parse(repo.updatedAt);
			const ageDays = Number.isFinite(created) ? Math.max((nowMs - created) / MS_PER_DAY, 1) : 365;
			const recencyDays = Number.isFinite(updated) ? Math.max((nowMs - updated) / MS_PER_DAY, .25) : 365;
			return (repo.stars + repo.forks * .5) / ageDays * (1 + 7 / (recencyDays + 1));
		}
		/** Ready-to-run install command for one GitHub-hosted plugin. */
		function installCommand(fullName, cloneProxy = "") {
			return installCommand$1(fullName, cloneProxy);
		}
		function decorate(repos, nowMs, access) {
			const htmlBase = access?.htmlBase ?? "https://kkgithub.com";
			const cloneProxy = access?.cloneProxy ?? "";
			return repos.map((repo, index) => ({
				...repo,
				rank: index + 1,
				heat: heatScore(repo, nowMs),
				install: installCommand(repo.fullName, cloneProxy),
				interpret: interpretPrompt(repo, {
					htmlBase,
					cloneProxy
				}),
				mirrorUrl: browseUrl(repo.fullName, htmlBase)
			}));
		}
		function compareStars(left, right) {
			return right.stars - left.stars || right.forks - left.forks || left.fullName.localeCompare(right.fullName);
		}
		function compareCreated(left, right) {
			return Date.parse(right.createdAt) - Date.parse(left.createdAt) || compareStars(left, right);
		}
		function compareHeat(left, right, nowMs) {
			return heatScore(right, nowMs) - heatScore(left, nowMs) || compareStars(left, right);
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
			const hotLimit = options.hotLimit ?? 20;
			const newLimit = options.newLimit ?? 20;
			const fireLimit = options.fireLimit ?? 10;
			const hot = [...catalog].sort(compareStars).slice(0, hotLimit);
			const newest = [...catalog].sort(compareCreated).slice(0, newLimit);
			const fire = [...catalog].sort((left, right) => compareHeat(left, right, nowMs)).slice(0, fireLimit);
			return {
				topic: options.topic,
				fetchedAt: options.fetchedAt ?? new Date(nowMs).toISOString(),
				total: catalog.length,
				incomplete: options.incomplete === true,
				...options.snapshotAccess === void 0 ? {} : { access: options.snapshotAccess },
				boards: {
					hot: board("hot", hot, nowMs, options.access),
					new: board("new", newest, nowMs, options.access),
					fire: board("fire", fire, nowMs, options.access)
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
.dsh-lb-panel{position:fixed;left:12px;bottom:128px;z-index:40;display:flex;flex-direction:column;width:460px;max-width:calc(100vw - 24px);max-height:70vh;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv2)}
.dsh-lb-header{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:12px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-lb-heading{min-width:0}
.dsh-lb-title{display:block;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.dsh-lb-sub{display:block;margin-top:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-refresh{flex:none;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dsh-lb-refresh:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-lb-tabs{flex:none;display:flex;gap:4px;padding:8px 12px 0}
.dsh-lb-tab{flex:1;height:32px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dsh-lb-tab[data-active]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-lb-body{flex:1;min-height:0;overflow-y:auto;padding:8px 12px 12px}
.dsh-lb-note,.dsh-lb-error{margin:8px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-lb-error{color:var(--dsw-alias-state-error-primary)}
.dsh-lb-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.dsh-lb-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:start;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-elevated,transparent)}
.dsh-lb-rank{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-lb-rank.is-1{color:#7a4b00;background:#f6d58b}
.dsh-lb-rank.is-2{color:#3d4a5c;background:#d5dde8}
.dsh-lb-rank.is-3{color:#6a3b16;background:#e8c4a0}
.dsh-lb-main{min-width:0}
.dsh-lb-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary);text-decoration:none}
.dsh-lb-name:hover{text-decoration:underline}
.dsh-lb-desc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:2px 0 0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.dsh-lb-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-lb-actions{display:flex;flex-direction:column;gap:4px}
.dsh-lb-action{height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;box-sizing:border-box}
.dsh-lb-action:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-lb-action-interpret{border-color:var(--dsw-alias-label-tertiary)}
.dsh-lb-foot{flex:none;padding:8px 12px 10px;border-top:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
`.trim();
		/** Inject the panel stylesheet once per page. */
		function ensureLeaderboardStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=\"dsh-plugin-leaderboard\"]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-leaderboard";
			tag.dataset.pluginCss = "dsh-plugin-leaderboard";
			tag.textContent = LEADERBOARD_CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/LeaderboardPanel.tsx
		const HOST_PATH = "/dsh-plugin-leaderboard";
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
			try {
				const response = await fetch(`${HOST_PATH}${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
				if (response.ok) return await response.json();
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
		function PluginRow({ item, t }) {
			const [copied, setCopied] = (0, react.useState)(null);
			const openUrl = item.mirrorUrl || browseUrl(item.fullName);
			const copy = async (kind) => {
				if (!await writeClipboard(kind === "install" ? item.install : item.interpret || interpretPrompt(item))) return;
				setCopied(kind);
				window.setTimeout(() => {
					setCopied(null);
				}, 1600);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dsh-lb-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RankBadge, { rank: item.rank }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										"★ ",
										formatCount(item.stars),
										" ",
										t("stars")
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										"⌥ ",
										formatCount(item.forks),
										" ",
										t("forks")
									] }),
									item.createdAt.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: ageLabel(item.createdAt) })
								]
							})
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
								className: "dsh-lb-action dsh-lb-action-interpret",
								onClick: () => {
									copy("interpret");
								},
								children: copied === "interpret" ? t("interpreted") : t("interpret")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								className: "dsh-lb-action",
								href: openUrl,
								target: "_blank",
								rel: "noreferrer",
								children: t("open")
							})
						]
					})
				]
			});
		}
		/** Sidebar footer action: a trophy button that opens the three-board panel. */
		function LeaderboardPanel({ wide, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [board, setBoard] = (0, react.useState)("hot");
			const [state, setState] = (0, react.useState)({ status: "loading" });
			const [request, setRequest] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				ensureLeaderboardStyles();
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				let current = true;
				setState({ status: "loading" });
				loadSnapshot(request > 0).then((snapshot) => {
					if (current) setState({
						status: "ready",
						snapshot
					});
				}, (error) => {
					if (current) setState({
						status: "error",
						message: error instanceof Error ? error.message : String(error)
					});
				});
				return () => {
					current = false;
				};
			}, [open, request]);
			const translate = (key, params) => interpolate(t(key, params), params);
			const items = state.status === "ready" ? state.snapshot.boards[board].items : [];
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
									children: [translate("subtitle"), state.status === "ready" ? ` · ${translate("sample", { total: state.snapshot.total })}` : ""]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-lb-refresh",
								onClick: () => {
									setRequest((value) => value + 1);
								},
								children: translate("refresh")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-lb-tabs",
							role: "tablist",
							children: [
								"hot",
								"new",
								"fire"
							].map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
								state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-lb-note",
									children: translate("loading")
								}),
								state.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "dsh-lb-error",
									role: "alert",
									children: [
										translate("error"),
										" ",
										state.message
									]
								}),
								state.status === "ready" && items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-lb-note",
									children: translate("empty")
								}),
								state.status === "ready" && items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
									className: "dsh-lb-list",
									children: items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginRow, {
										item,
										t: translate
									}, item.fullName))
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
							className: "dsh-lb-foot",
							children: [
								state.status === "ready" && state.snapshot.access?.proxied ? `${translate("proxied")} ` : "",
								state.status === "ready" && state.snapshot.incomplete ? `${translate("incomplete")} ` : "",
								translate("heatHint")
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
			title: "插件排行榜",
			subtitle: "GitHub topic dsh-plugin",
			hot: "最热",
			new: "最新",
			fire: "最火",
			loading: "正在读取 GitHub…",
			error: "暂时读不到排行榜。",
			retry: "重试",
			empty: "这一榜暂时没有条目。",
			stars: "Star",
			forks: "Fork",
			copy: "复制安装",
			interpret: "解读",
			copied: "已复制",
			interpreted: "已复制解读",
			open: "打开仓库",
			refresh: "刷新",
			sample: "样本 {total} 个仓库",
			heatHint: "最火按星标密度和近期活跃度取 Top 10。「解读」会复制一段提示词，粘到对话框即可让智能体 clone 仓库并用大白话讲解。第三方代码，安装前请阅读源码并钉住提交。",
			incomplete: "GitHub 标记本次搜索不完整。",
			proxied: "本次经 GitHub 代理拉取；打开仓库走网页镜像，复制安装里带有打不开 GitHub 时的克隆命令。"
		};
		/** English copy. */
		const en = {
			button: "Leaderboard",
			buttonAria: "Open the community plugin leaderboard",
			title: "Plugin leaderboard",
			subtitle: "GitHub topic dsh-plugin",
			hot: "Hottest",
			new: "Newest",
			fire: "On fire",
			loading: "Reading GitHub…",
			error: "The leaderboard is temporarily unavailable.",
			retry: "Retry",
			empty: "This board has no entries yet.",
			stars: "Stars",
			forks: "Forks",
			copy: "Copy install",
			interpret: "Explain",
			copied: "Copied",
			interpreted: "Prompt copied",
			open: "Open repository",
			refresh: "Refresh",
			sample: "{total} repositories sampled",
			heatHint: "On fire is the top 10 by star density and recent activity. Explain copies a prompt you paste into the chat so the agent clones the repo and walks through it. Third-party code — review the source and pin a commit.",
			incomplete: "GitHub marked this search incomplete.",
			proxied: "Fetched through a GitHub proxy. Open uses a web mirror; Copy install includes a clone-via-proxy command."
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