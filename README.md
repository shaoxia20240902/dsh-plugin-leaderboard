# dsh-plugin-leaderboard

[English](#install) | [中文](README.zh.md)

Community plugin leaderboard for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It reads the public GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin) and shows three boards **inside the Web UI**:

![Hottest board in the DeepSeek Harness sidebar](docs/screenshot-hot.png)

| Board | Meaning |
| --- | --- |
| **最热 / Hottest** | Most GitHub stars |
| **最新 / Newest** | Most recently created |
| **最火 Top 10 / On fire** | Top 10 by star density with a recency boost |
| **推荐 / Picks** | Curated list stored in MySQL |

## Install

```sh
dsh plugin --profile web add github:shaoxia20240902/dsh-plugin-leaderboard
```

Or from a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-plugin-leaderboard
```

Restart `dsh web`. The sidebar foot shows **插件榜**. You can also type `/leaderboard` in a session, or ask the agent to show the hottest / newest / on-fire plugins.

## What you get

- **Sidebar panel** — three tabs, star/fork counts, copy-install, **copy an interpret prompt**, open the repo.
- **Interpret prompt** — paste it into the Harness composer. The agent clones the repo and explains it in plain language: what it is, what pain it removes, what you see after install, how to start, who should skip it.
- **Slash command** `/leaderboard [hot|new|fire]`.
- **Tool** `list_dsh_plugin_leaderboard` so the agent can answer ranking questions.
- **HTTP** `GET /dsh-plugin-leaderboard` on the host (used by the panel).

These repositories are third-party code. Review the source and pin a commit (`github:owner/repo#<sha>`) before you install one.

Boards load first from the hosted API `http://101.34.27.122:3091` (MySQL), then fall back to GitHub. The recommend list lives only in that database.

## When GitHub is blocked

Default `access: auto`: try `api.github.com` first, then public HTTPS proxies (for example `ghfast.top`).

- **Board data** — the host retries through a proxy so the sidebar still fills in.
- **Open repository** — uses the `kkgithub.com` web mirror by default (`githubHtmlBase`).
- **Copy install / Explain** — include a “clone via proxy, then `dsh plugin add <dir>`” command.

**A GitHub token is sent only to the official API, never through a public proxy.** Public mirrors are third-party and can vanish; override them when you have a stable one:

```yaml
- id: dsh-plugin-leaderboard
  config:
    access: auto
    githubApiBase: https://your-proxy.example/https://api.github.com
    githubHtmlBase: https://kkgithub.com
    githubCloneProxy: https://ghfast.top/
```

## Ranking

- **Hottest** — `stargazers_count` descending.
- **Newest** — `created_at` descending.
- **On fire** — `(stars + 0.5 * forks) / age_days * (1 + 7 / (days_since_update + 1))`, top 10.

The catalog merges a few GitHub search pages (stars + recently updated), then drops `deepseek-ai/deepseek-harness`, forks, and archived repos. Results are cached for 10 minutes.

## Configuration

Optional `cordis.yml` / profile patch on the `dsh-plugin-leaderboard` row:

```yaml
- id: dsh-plugin-leaderboard
  config:
    githubToken: # or set GITHUB_TOKEN / GH_TOKEN
    topic: dsh-plugin
    cacheTtlMs: 600000
    starPages: 3
    updatedPages: 2
    excludes:
      - deepseek-ai/deepseek-harness
    originUrl: http://101.34.27.122:3091
```

Unauthenticated GitHub search is enough for a personal install. A token raises the rate limit if you refresh often.

## Develop

```sh
pnpm install
pnpm test
pnpm build
```

`lib/` is the runtime. The client bundle is `lib/client.js` and loads through the Web GUI module table.

## License

MIT
