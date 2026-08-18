# dsh-plugin-leaderboard

[English](README.md) | 中文

DeepSeek Harness 社区插件排行榜。它读取 GitHub 公开话题 [`dsh-plugin`](https://github.com/topics/dsh-plugin)，并在 Web 界面里直接给出三份榜单：

![侧边栏里的最热榜](docs/screenshot-hot.png)

| 榜单 | 含义 |
| --- | --- |
| **最热** | 按 GitHub star 从高到低 |
| **最新** | 按仓库创建时间从新到旧 |
| **最火 Top 10** | 按星标密度和近期活跃度取前 10 |
| **推荐** | 人工精选，存在自己的 MySQL，适合先装 |

## 安装

```sh
dsh plugin --profile web add github:shaoxia20240902/dsh-plugin-leaderboard
```

本地目录：

```sh
dsh plugin --profile web add /path/to/dsh-plugin-leaderboard
```

重启 `dsh web`。侧边栏底部会出现 **插件榜**。会话里也可以输入 `/leaderboard`，或者让智能体报最热 / 最新 / 最火的插件。

## 你会看到什么

- **侧边栏面板**：三个页签、star / fork、复制安装、**复制解读提示词**、打开仓库。
- **解读提示词**：粘到对话框。智能体会先 clone 仓库，再用大白话讲：它是啥、解决什么烦、装完能看到什么、怎么上手、谁不该装。
- **斜杠命令** `/leaderboard [hot|new|fire]`。
- **工具** `list_dsh_plugin_leaderboard`，智能体可直接查榜。
- **HTTP** `GET /dsh-plugin-leaderboard`（面板走这条同源接口）。

这些仓库都是第三方代码。安装前请阅读源码，并用 `github:owner/repo#<sha>` 钉住提交。

## 访问不了 GitHub 时

默认 `access: auto`：先直连 `api.github.com`，失败再走公开代理（如 `ghfast.top`）。

- **看榜**：Host 拉目录时自动回退，不需要你先能打开 GitHub。
- **打开仓库**：官方 `https://github.com/owner/repo`。像 kkgithub.com 这种换域名镜像，多数仓库直接 404，不再使用。
- **详情**：托管 API 上的说明页（`/r/owner/repo`），带简介和能用的代理克隆命令。
- **复制安装 / 解读**：除了官方 `github:owner/repo`，还会带上「代理克隆 + 本地安装」命令。

**Token 只发给官方 API，不会经过公共代理。** 公共镜像是第三方服务，可能失效或被滥用，只当你打不开 GitHub 时使用。

自己有更稳的代理时，在 profile 的 `cordis.patch.yml` 里写：

```yaml
- id: dsh-plugin-leaderboard
  config:
    access: auto          # auto | direct | proxy
    githubApiBase: https://your-proxy.example/https://api.github.com
    githubHtmlBase: https://github.com
    githubCloneProxy: https://ghfast.top/
```

完全直连、不用镜像：

```yaml
- id: dsh-plugin-leaderboard
  config:
    access: direct
    githubHtmlBase: https://github.com
```

## 排名规则

- **最热** — `ln(1+stars) + 0.55 ln(1+forks) + 0.6×维护新鲜度 + 0.4×DSH 相关度 − 停更惩罚`。对数压住十万 star 碾压；停更超过 180 天减分。
- **最新** — `(1 / (1 + 上线天数/6))^1.8 × (1 + 0.9 ln(1+stars) + 0.28 ln(1+forks))`。越新越好，但空壳排在「同样新、已有人 star」的后面。
- **最火** — `(stars + 0.65 forks) / (上线天数 + 2)^1.55 × (1 + 1.2×新鲜度) × (1 + 0.28×相关度)`，取 Top 10。类似 HN 热榜：短期涨得快、最近还在动的往前排。
- **推荐** — 人工精选，存在 MySQL。

目录会合并若干页 GitHub 搜索（按 star、按最近更新），并去掉 `deepseek-ai/deepseek-harness`、fork 和已归档仓库。托管 API 把这份目录写入 MySQL，每 30 分钟后台同步一次；打开侧边栏只读库，不会卡在 GitHub。手动点「刷新」才会在 `GET_LOCK` 下拉一次源站；同时有人在刷时，后来的请求直接看当前快照。Host 进程里还有一份短期内存缓存，过期后先返回旧数据再后台更新。

## 配置

榜单默认先读托管 API `http://101.34.27.122:3091`（数据在服务器 MySQL），失败再回退 GitHub。推荐榜只存在这份数据库里。公开查询：`GET /v1/leaderboard`、`GET /v1/health`、`GET /r/owner/repo`（仓库详情页）、`POST /v1/suggest`（推荐入口）。推荐榜里可以直接提交；已在目录中的插件会马上上榜，其他先入库等审核。

增加一条推荐（需要服务器上的 `ADMIN_TOKEN`）：

```sh
curl -X POST http://101.34.27.122:3091/v1/recommend \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"fullName":"owner/repo","rank":6,"reason":"为什么推荐"}'
```

可在 profile 的 `cordis.patch.yml` 里覆盖 `dsh-plugin-leaderboard` 行：

```yaml
- id: dsh-plugin-leaderboard
  config:
    githubToken: # 也可设环境变量 GITHUB_TOKEN / GH_TOKEN
    topic: dsh-plugin
    cacheTtlMs: 300000
    starPages: 3
    updatedPages: 2
    excludes:
      - deepseek-ai/deepseek-harness
    originUrl: http://101.34.27.122:3091
```

个人使用可以不配 token。刷新很勤时再配，以免撞上 GitHub 匿名限额。

## 开发

```sh
pnpm install
pnpm test
pnpm build
```

运行时入口是 `lib/`。浏览器半区是 `lib/client.js`，由 Web GUI 的模块表加载。

## 许可证

MIT
