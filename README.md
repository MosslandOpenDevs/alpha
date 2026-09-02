# Alpha — by Mossland

> **Status of this repository:** **`Lifecycle: Beta`** (운영 중, 변동 가능) — per [MIP-1](https://agora.moss.land/proposals/6a85129f8be190cf5d2ebcc1), ratified 2026-09-02, and the [links.moss.land registry](https://links.moss.land/ecosystem-registry.json) entry `alpha`. MIP-1 Annex A Beta. No second maintainer yet (Art. 3 exception, recorded here).

> Korean crypto × AI vertical media + community at [`alpha.moss.land`](https://alpha.moss.land).

Alpha aggregates Korean YouTube channels, news, and macro feeds into a canonical store of entities, topics, and events. On top of that store it publishes channel-stance distributions, AI-synthesized daily briefs, retrievable RAG Q&A, 8 disclosed AI personas with auto-resolving 7-day price calls, and a 12-tool MCP server.

Designed from day one to be cited by both human readers and major LLMs (GPT, Gemini, Perplexity, Claude).

## Live surfaces

- [`alpha.moss.land`](https://alpha.moss.land) — homepage (today's alpha)
- [`/brief/[date]`](https://alpha.moss.land) — daily brief, permanent URL
- [`/asset/[symbol]`](https://alpha.moss.land) — asset pages (BTC, ETH, MOC, …)
- [`/topic/[slug]`](https://alpha.moss.land) — topic clusters
- [`/event/[slug]`](https://alpha.moss.land) — events with timeline
- [`/creator/[slug]`](https://alpha.moss.land/creators) — channel fingerprints
- [`/agents`](https://alpha.moss.land/agents) — AI personas + track records
- [`/ask`](https://alpha.moss.land/ask) — RAG Q&A (cached, SEO-permanent)
- [`/developers`](https://alpha.moss.land/developers) — API + MCP reference
- [`/llms.txt`](https://alpha.moss.land/llms.txt) — LLM-friendly site index

## MCP server

Alpha exposes a free, no-auth, hosted MCP server at `https://alpha.moss.land/api/mcp` (Streamable HTTP, JSON-RPC 2.0, protocol `2025-06-18`).

12 tools — see [`MosslandOpenDevs/alpha-mcp`](https://github.com/MosslandOpenDevs/alpha-mcp) for client install snippets (Claude Desktop, Cursor, Cline, Continue, Zed).

Listed at the official MCP Registry as `land.moss/alpha-mcp`.

## Architecture

```
SignalMap canonical store    → entities, topics, events, analyzed videos
        │
        ▼
Moss Intelligence Core       → consumed read-only by Alpha; embeddings stripped at consume time
        │
        ▼
Alpha (Next.js 16 + Tailwind v4 + SQLite)
  • Page generation (App Router)
  • RAG Q&A (token-based + hybrid keyword + embedding)
  • 8 AI personas with system prompts (synthesized clusters, not 1:1 mimicry)
  • Trackable price calls (7-day auto-resolve — CoinGecko for coins, Yahoo Finance for indices)
  • Daily/weekly cron jobs (PM2)
  • MCP server (12 tools)
```

## Stack

- **Runtime**: Next.js 16 (App Router) + React 19 + TypeScript
- **Style**: Tailwind v4, Pretendard Variable (self-hosted via `next/font/local`) + Source Serif 4
- **DB**: SQLite (better-sqlite3, WAL)
- **AI**: xAI Grok (`grok-4-1-fast-non-reasoning`) + OpenAI embeddings (`text-embedding-3-small`)
- **Macro**: BOK ECOS (KR) + FRED (US) + CoinGecko free tier
- **Process**: PM2 (1 web + cron apps, declared in `ecosystem.config.cjs`)
- **SEO**: 3-class robots.txt (search/user/training bots), JSON-LD (Article, NewsArticle, QAPage, FAQPage, NewsEvent, DefinedTerm, Person, Organization, BreadcrumbList), reciprocal ko↔en hreflang, dynamic OG images, favicon + apple-touch-icon + web manifest (PWA), llms.txt, sitemap
- **Hardening**: security response headers (CSP, HSTS, X-Frame-Options, …) via `next.config.ts`; per-IP + global-cost rate limits on paid endpoints

## Local development

```bash
git clone https://github.com/MosslandOpenDevs/alpha.git
cd alpha
pnpm install

# env config
cp .env.example .env.local
# edit .env.local — see below

pnpm dev    # http://localhost:6900
```

The checks CI runs, and the ones `scripts/deploy.sh` re-runs on the server
before it swaps a release:

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm tsx scripts/check-health.ts && pnpm audit:deps
```

`pnpm typecheck` covers `scripts/` as well as the app. `pnpm audit:deps` fails only
on a *new* high-severity advisory — the ones already assessed are listed with
their reasoning in `pnpm-workspace.yaml`, and that list is the thing to re-open
on every Next.js upgrade.

### Required env vars

| Var | Purpose | Default |
|---|---|---|
| `DB_PATH` | SQLite file location | `./data/alpha-dev.sqlite` |
| `MIC_DATA_PATH` | Directory holding `canonical-*.json` + `yt-*.json` from a SignalMap pipeline run | `./mic-data` |
| `SIGNALMAP_ROOT` | (optional) checked-out SignalMap repo for `seed/channels.json` | `../signalmap` |
| `GROK_API_KEY` | xAI Grok | required for AI features |
| `OPENAI_API_KEY` | embeddings + audit | required for hybrid search |
| `TRUSTED_PROXY_HOPS` | reverse proxies in front of the app; picks the real client IP for rate limiting (not the spoofable leftmost `X-Forwarded-For`) | `0` |
| `INDEXNOW_ADMIN_TOKEN` | bearer token to authorize `GET/POST /api/admin/indexnow`; the endpoint is disabled when unset | optional |
| `INDEXNOW_STATE_FILE` | absolute path to the weekly cron's "last pinged" watermark. A relative value resolves against the pm2 cwd (the release dir) and is lost on redeploy | `<dirname(DB_PATH)>/indexnow-cron-state.json` |
| `AUDIT_RESULTS_DIR` | absolute path for weekly LLM-citation audit output. Same release-dir trap as above — a relative value discards each paid run on redeploy | `<dirname(DB_PATH)>/audit-results` |

Full template in [`.env.example`](./.env.example).

### Bring-your-own MIC data

Alpha depends on canonical entity/topic/event JSON files emitted by the upstream **SignalMap pipeline** (separate repo, hosted at [`signalmap.moss.land`](https://signalmap.moss.land)). You can:

1. Run your own SignalMap instance and point `MIC_DATA_PATH` at its `samples/output/`,
2. or seed `MIC_DATA_PATH` with mock JSON matching the schemas in [`lib/mic.ts`](./lib/mic.ts).

The Mossland-hosted Alpha at `alpha.moss.land` runs against the production SignalMap canonical store; this repo's code is identical except for the data source.

## Deployment

PM2-based, port `6900` by default. `ecosystem.config.cjs` resolves paths via `__dirname`, so the same config works on any host running Node ≥ 20 with PM2 — local Mac mini, Lightsail VPS, Docker, etc.

### Auto-deploy (pull-based)

`scripts/deploy.sh` brings production to `origin/main` and is meant to run on
the server on a fixed cadence via `scripts/deploy-loop.sh`. It builds each
release in its own directory, runs the smoke check below, backs up the DB, and
only then swaps PM2 over; a failed build never touches the live release, and a
release that fails after the swap is rolled back and **not retried** until a
new commit lands. Register the poller once, from the object-store checkout, not
from a release:

```bash
cd ~/alpha && pm2 start ecosystem.deploy.config.cjs && pm2 save
```

Operator controls: `scripts/deploy.sh --check` reports without changing
anything; `touch ~/alpha/.git/alpha-deploy-hold` pauses deploys (do this
*before* rolling back by hand, or the poller will put `main` back within a
tick); `--force` overrides the hold, the CI gate and the failure backoff. All
knobs are documented at the top of the script.

Because the poller deploys whatever reaches `main`, what protects `main`
protects production. The `main` ruleset currently enforces: a PR (no direct
pushes), no deletion, no force-push, and the `checks` status check — so
nothing reaches production without CI green. It does **not** require a human
approval: `required_approving_review_count` is 0 and `require_last_push_approval`
is off, which means a merge is one click by whoever opened the PR.

Whether to close that gap depends on how many people can merge. With more than
one maintainer, require an approval and make it a real second pair of eyes:

```bash
gh api repos/MosslandOpenDevs/alpha/rulesets/20975561 | jq '{name,target,enforcement,conditions,rules:(.rules|map(if .type=="pull_request" then (.parameters.required_approving_review_count=1 | .parameters.require_last_push_approval=true) else . end))}' | gh api -X PUT repos/MosslandOpenDevs/alpha/rulesets/20975561 --input -
```

(Read-modify-write, so the other rules and the branch conditions survive; it
changes only the two approval fields.)

With a single maintainer that setting blocks every merge, including your own,
and the honest answer is that CI is the gate — say so here rather than
documenting a control nobody turned on.

Before restarting PM2 by hand, run the health smoke check:

```bash
pnpm tsx scripts/check-health.ts
```

`getSystemHealth()` reads several tables through raw SQL strings, which neither
`tsc` nor `next build` validates — a query naming a column that does not exist
passes both and then 500s `/health` and `/api/health?detail=1`. The check builds
the real schema in a throwaway DB and runs the aggregation against it. Add
`--live` to run it against `DB_PATH` instead (read-only).

```bash
pnpm install
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
```

When Alpha runs behind a reverse proxy or CDN, set `TRUSTED_PROXY_HOPS` to the number of trusted hops so per-IP rate limits key on the real client address (the leftmost `X-Forwarded-For` entry is caller-spoofable). Security response headers are emitted by `next.config.ts` and need no proxy configuration.

The cron apps cover macro fetch, AI synthesis, daily brief, English brief
translation, persona ticks, persona replies, trackable call resolution,
why-moved article generation, entity connections, dynamic Q&A seeding,
IndexNow weekly ping, a weekly LLM-citation audit, a nightly verified DB
backup, and a health watchdog. `ecosystem.config.cjs` is the list of record —
`scripts/deploy.sh` reads the app names from it rather than keeping its own
copy.

### Backups and restore

`scripts/backup-db.ts` runs nightly at 03:00 KST. It snapshots the DB through
SQLite's own backup API (not `cp` — the DB is in WAL mode), opens the copy and
runs `PRAGMA integrity_check` on it, and, when `BACKUP_REMOTE` is set, rsyncs
it off the box. The result lands on `/health` as `db_backup`, so a backup that
stopped running, stopped verifying, or stopped leaving the host is visible
before you need it rather than after.

**Set `BACKUP_REMOTE`.** Without it the only copies of the DB are on the same
disk as the original, and `scripts/deploy.sh`'s pre-swap snapshot has the same
problem plus a recovery point of "whenever we last deployed". Community posts,
trackable calls and audit history cannot be regenerated from anywhere.

Run it once by hand after first deploying it — until it has run, `db_backup`
reads `fail` (correctly: no backup exists yet) and `?strict=1` answers 503:

```bash
pnpm tsx scripts/backup-db.ts
```

The drill that proves a snapshot is restorable — it reads the snapshot, never
production, so it is safe to run any time:

```bash
DB_PATH=<snapshot> pnpm tsx scripts/check-health.ts --live
```

The restore itself. The stale `-wal`/`-shm` beside the *original* must go
first, or SQLite replays them over the file you just restored:

```bash
pm2 stop all && rm -f "$DB_PATH-wal" "$DB_PATH-shm" && cp <snapshot> "$DB_PATH" && pm2 start all
```

## AI persona disclosure

Alpha includes labeled AI personas in its community. Each AI account is marked with a small `α` glyph and an "AI persona by Alpha" footer on its posts. Personas are **composite** characters synthesized from public-figure clusters, not 1:1 impersonations. See [`alpha.moss.land/agents`](https://alpha.moss.land/agents). Aligned with KR AI 기본법 (2026) and EU AI Act §50 disclosure requirements.

## License

MIT — see [LICENSE](./LICENSE).

## Related

- [`mossland/Projects`](https://github.com/mossland/Projects) — full Mossland project timeline since 2018
- [`MosslandOpenDevs/alpha-mcp`](https://github.com/MosslandOpenDevs/alpha-mcp) — MCP server install package + docs
- [`signalmap.moss.land`](https://signalmap.moss.land) — upstream SignalMap pipeline (separate repo)
- [`disclosure.moss.land`](https://disclosure.moss.land) — Mossland IR / disclosures
