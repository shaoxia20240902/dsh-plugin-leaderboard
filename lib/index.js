import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "schemastery";
//#region src/types.ts
/** Default GitHub topic used as the catalog source. */
const DEFAULT_TOPIC = "dsh-plugin";
/** The harness itself is not a community plugin. */
const DEFAULT_EXCLUDES = ["deepseek-ai/deepseek-harness"];
//#endregion
//#region src/github.ts
const SEARCH_URL = "https://api.github.com/search/repositories";
const PER_PAGE = 100;
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
/**
* Run one GitHub repository search page.
* @param query - full search qualifier string
* @param page - 1-based page
* @param sort - GitHub search sort
* @param token - optional personal access token
* @param signal - abort the request
*/
async function searchPage(query, page, sort, token, signal) {
	const url = new URL(SEARCH_URL);
	url.searchParams.set("q", query);
	url.searchParams.set("sort", sort);
	url.searchParams.set("order", "desc");
	url.searchParams.set("per_page", String(PER_PAGE));
	url.searchParams.set("page", String(page));
	const response = await fetch(url, {
		headers: headers(token),
		signal
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`GitHub search HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
	}
	const body = await response.json();
	const repos = [];
	for (const item of body.items ?? []) {
		const mapped = mapItem(item);
		if (mapped !== void 0) repos.push(mapped);
	}
	return {
		repos,
		incomplete: body.incomplete_results === true
	};
}
async function collectPages(query, sort, pages, token, signal) {
	const repos = [];
	let incomplete = false;
	for (let page = 1; page <= pages; page += 1) {
		const pass = await searchPage(query, page, sort, token, signal);
		repos.push(...pass.repos);
		if (pass.incomplete) incomplete = true;
		if (pass.repos.length < PER_PAGE) break;
	}
	return {
		repos,
		incomplete
	};
}
/**
* Load the merged `dsh-plugin` catalog: star-sorted pages plus recently updated pages.
* @param options - topic, token, page counts
*/
async function fetchCatalog(options = {}) {
	const query = `topic:${options.topic ?? "dsh-plugin"} is:public`;
	const starPages = options.starPages ?? 3;
	const updatedPages = options.updatedPages ?? 2;
	const stars = await collectPages(query, "stars", starPages, options.token, options.signal);
	const updated = await collectPages(query, "updated", updatedPages, options.token, options.signal);
	return {
		repos: [...stars.repos, ...updated.repos],
		incomplete: stars.incomplete || updated.incomplete
	};
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
//#region src/interpret.ts
/**
* Default chat prompt: clone the repo, then explain it in plain language.
* The user copies this into the Harness composer.
*/
function interpretPrompt(repo) {
	const description = repo.description.trim().length > 0 ? repo.description.trim() : "（仓库没有写简介）";
	const cloneDir = `/tmp/dsh-read-${repo.name}`;
	return [
		`请解读这个 DeepSeek Harness 社区插件。先把它 clone 到临时目录，读完 README、package.json、cordis.patch.yml 和 src 入口，再用大白话讲给我听，让我读完就知道它是干什么的、值不值得装。`,
		``,
		`仓库：${repo.fullName}`,
		`地址：${repo.url}`,
		`简介：${description}`,
		`Star：${repo.stars}`,
		`克隆：git clone --depth 1 ${repo.url}.git ${cloneDir}`,
		`安装：dsh plugin --profile web add github:${repo.fullName}`,
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
function installCommand(fullName) {
	return `dsh plugin --profile web add github:${fullName}`;
}
function decorate(repos, nowMs) {
	return repos.map((repo, index) => ({
		...repo,
		rank: index + 1,
		heat: heatScore(repo, nowMs),
		install: installCommand(repo.fullName),
		interpret: interpretPrompt(repo)
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
function board(id, repos, nowMs) {
	const copy = BOARD_COPY[id];
	return {
		id,
		title: copy.title,
		description: copy.description,
		items: decorate(repos, nowMs)
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
		boards: {
			hot: board("hot", hot, nowMs),
			new: board("new", newest, nowMs),
			fire: board("fire", fire, nowMs)
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
	return "all";
}
//#endregion
//#region src/catalog.ts
/**
* In-memory leaderboard cache shared by the tool, the slash command, and the HTTP route.
*/
var LeaderboardCatalog = class {
	config;
	cache;
	inflight;
	/**
	* @param config - plugin config captured at apply time
	*/
	constructor(config) {
		this.config = config;
	}
	/**
	* Return a cached snapshot or refresh from GitHub.
	* @param force - bypass the TTL
	* @param signal - abort the GitHub requests
	*/
	async snapshot(force = false, signal) {
		const now = Date.now();
		if (!force && this.cache !== void 0 && this.cache.expiresAt > now) return this.cache.snapshot;
		if (this.inflight !== void 0) return this.inflight;
		this.inflight = this.refresh(signal);
		try {
			return await this.inflight;
		} finally {
			this.inflight = void 0;
		}
	}
	async refresh(signal) {
		const pass = await fetchCatalog({
			topic: this.config.topic,
			token: resolveGitHubToken(this.config.githubToken),
			starPages: this.config.starPages,
			updatedPages: this.config.updatedPages,
			signal
		});
		const snapshot = buildLeaderboard(pass.repos, {
			topic: this.config.topic,
			incomplete: pass.incomplete,
			excludes: this.config.excludes
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
	topic: Schema.string().default(DEFAULT_TOPIC),
	cacheTtlMs: Schema.number().default(600 * 1e3),
	starPages: Schema.number().default(3),
	updatedPages: Schema.number().default(2),
	excludes: Schema.array(Schema.string()).default([...DEFAULT_EXCLUDES])
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
		"fire"
	] : [selected]).map((id) => formatBoard(snapshot.boards[id])).join("\n\n")}\n${[
		"",
		`最热：${BOARD_COPY.hot.description}`,
		`最新：${BOARD_COPY.new.description}`,
		`最火：${BOARD_COPY.fire.description}`,
		"",
		"侧边栏点「解读」会复制一段提示词，粘到对话框即可让智能体 clone 仓库并用大白话讲解。",
		"这些仓库是第三方代码。安装前请阅读源码，并用 `github:owner/repo#<sha>` 钉住提交。"
	].join("\n")}`;
}
//#endregion
//#region src/http.ts
/** Same-origin path the Web UI fetches. */
const LEADERBOARD_PATH = "/dsh-plugin-leaderboard";
function send(res, status, body, contentType) {
	res.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store"
	});
	res.end(body);
}
/**
* Expose the cached snapshot as JSON for the browser panel.
* @param webServer - host HTTP carrier
* @param catalog - shared GitHub cache
*/
function registerLeaderboardRoute(webServer, catalog) {
	return webServer.register({
		kind: "exact",
		path: LEADERBOARD_PATH,
		async handler(req, res) {
			const method = req.method ?? "GET";
			if (method === "OPTIONS") {
				res.writeHead(204, { allow: "GET, HEAD" });
				res.end();
				return;
			}
			if (method !== "GET" && method !== "HEAD") {
				send(res, 405, JSON.stringify({ error: "method not allowed" }), "application/json; charset=utf-8");
				return;
			}
			try {
				const force = new URL(req.url ?? "/dsh-plugin-leaderboard", "http://dsh.local").searchParams.get("refresh") === "1";
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
					"all"
				],
				description: "Which board to return. Default all."
			},
			refresh: {
				type: "boolean",
				description: "Bypass the 10-minute cache and refetch GitHub."
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
		timeoutMs: 2e4,
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
