# dsh-plugin-board API

Hosted MySQL catalog for the leaderboard plugin. The plugin reads this first so users who cannot open GitHub still get 最热 / 最新 / 最火 / 推荐.

Public:

- `GET /v1/health` — last sync time and whether `GET_LOCK` is held
- `GET /v1/leaderboard` — always reads MySQL, never GitHub
- `GET /v1/leaderboard?refresh=1` or `POST /v1/refresh` — return the current snapshot; start a locked GitHub sync if the cooldown allows
- `GET /r/owner/repo` — a detail page that never 404s like kkgithub host-swap mirrors
- `POST /v1/suggest` — community recommend form (`fullName` + `reason`). Known catalog repos publish immediately; others stay pending. Uses `GET_LOCK('dsh_plugin_board_suggest', 3)` and 5 submits / IP / hour.

Sync rules:

- Cron (`node server.mjs --sync`) writes at most once every 30 minutes.
- A user refresh may run sooner, but not more than once every 2 minutes.
- `GET_LOCK('dsh_plugin_board_sync', 0)` plus in-process single-flight: concurrent callers join or get `refresh.status=busy` and still see the last MySQL snapshot.
- Admin `POST /v1/sync` (Bearer token) is `force` and still takes the same lock.

Admin (Bearer token in `/opt/dsh-plugin-board/.env`):

```sh
# refresh GitHub → MySQL
curl -X POST http://127.0.0.1:3090/v1/sync \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# add a recommend row
curl -X POST http://127.0.0.1:3091/v1/recommend \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"fullName":"owner/repo","rank":6,"reason":"为什么推荐"}'
```

Do not commit `.env`. MySQL user `dsh_board` is localhost-only.
