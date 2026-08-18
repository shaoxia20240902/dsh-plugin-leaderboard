# dsh-plugin-board API

Hosted MySQL catalog for the leaderboard plugin. The plugin reads this first so users who cannot open GitHub still get 最热 / 最新 / 最火 / 推荐.

Public:

- `GET /v1/health`
- `GET /v1/leaderboard`

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
