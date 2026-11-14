# Headless agent surface (`/api/agent`)

Axtra can be driven without a browser: scripts, the cron ticker, Hermes, and
Telegram all talk to the same FastAPI backend through the Next.js proxy
(`https://<deployment>/api-proxy`).

## Auth

Two ways in, same owner context:

| Mode | How | Use for |
|---|---|---|
| Session cookie | `POST /api-proxy/auth/login {password}` → cookie `axtra_session` | the web app |
| **API token** | header `X-API-Key: $API_TOKEN` (or `Authorization: Bearer $API_TOKEN`) | scripts, cron, Hermes |

`API_TOKEN` is a backend env var (Vercel → Settings → Environment Variables).
Generate one with `python -c "import secrets;print(secrets.token_hex(24))"`.
Empty token = the header path is disabled, cookie only.

```bash
B=https://axtra1.vercel.app/api-proxy
curl -s -H "X-API-Key: $API_TOKEN" $B/agent/state
```

## Endpoints

| Endpoint | What it does |
|---|---|
| `GET /agent/state` | menu config (`order`/`hidden`/`labels`) + `theme`, stored in `orchestrator_state` |
| `PUT /agent/state` | partial upsert — send only `{"theme":"dark"}`, the menu is untouched |
| `POST /agent/apply` | run orchestrator actions **on the server** (see below) |
| `POST /agent/jobs` | queue a chat turn: `{prompt, mode, title?}` |
| `GET /agent/jobs?limit=20` | recent jobs with `status` (`queued`/`running`/`done`/`failed`) + `result` |
| `GET /agent/jobs/{id}` | one job |
| `POST /agent/hooks/hermes` | forward `{text}` to `HERMES_WEBHOOK_URL` (outbound bridge) |

### `POST /agent/apply`

Takes `{"actions": [...]}` in the exact shape the homepage orchestrator returns
(`OrchestratorAction`), and closes the gaps that used to need a browser:

| Action | Server effect |
|---|---|
| `save_memory` | writes `memories` (deduped, `source=orchestrator`) |
| `create_schedule` | writes `schedules` — reminders now reach Telegram without a tab open |
| `menu_order`, `menu_visibility`, `menu_rename`, `reset_menu`, `set_theme` | writes `orchestrator_state`; the sidebar and the theme read it on next load |
| `navigate`, `new_conversation` (with `prompt`) | enqueues an `agent_jobs` row and returns its id |
| `focus_menu` | nothing (pure UI highlight) → reported in `skipped` |

```bash
curl -s -H "X-API-Key: $API_TOKEN" -H "Content-Type: application/json" \
  -X POST $B/agent/apply \
  -d '{"actions":[{"type":"set_theme","theme":"dark"},
                  {"type":"new_conversation","mode":"general","prompt":"ringkas tugas hari ini"}]}'
```

## Why jobs, not a synchronous chat call

A Vercel function is capped at 300s, so a long answer would be cut off. The job
is stored, `GET /agent/jobs/{id}` polls it, and the tick delivers the finished
answer to every enabled Telegram chat through `notification_outbox` (which
retries).

## Ticker

`/api/cron/minutely` fires reminders, drains the Telegram outbox, and runs up to
three queued agent jobs. Vercel's own cron (`vercel.json`) only runs
`/api/cron/tick` once a day, so `.github/workflows/axtra-ticker.yml` calls the
minutely endpoint every 5 minutes.

Repo secrets: `AXTRA_API_URL` (`https://axtra1.vercel.app`) and
`AXTRA_API_TOKEN` (the backend's `API_TOKEN`). Both `/api/cron/*` endpoints
accept `X-API-Key: <API_TOKEN>` as an alternative to `Bearer <CRON_SECRET>`, so
the ticker never needs the server-only `CRON_SECRET`:

```bash
gh secret set AXTRA_API_URL --repo Itzfebry/axtra --body "https://axtra1.vercel.app"
gh secret set AXTRA_API_TOKEN --repo Itzfebry/axtra --body "<API_TOKEN>"
gh workflow run axtra-ticker --repo Itzfebry/axtra
```

Hermes can drive the ticker instead, if a GitHub schedule is not wanted — a
cron job that POSTs the same URL with the same `X-API-Key` header.

## One bot, not two

Axtra's own Telegram bot (`TELEGRAM_ENABLED`) stays OFF: Hermes already owns the
chat surface. Axtra is the backend (`API_TOKEN`), Hermes is the messenger
(`@hermes_iyx2khd6d3jjeteb_bot`). Two bots polling the same chat is two sources
of truth; `/start` is silently ignored by the Hermes gateway on purpose, so use
plain text or `/help`.
