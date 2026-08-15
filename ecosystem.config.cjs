/**
 * PM2 ecosystem for Alpha (alpha.moss.land).
 *
 * `cwd: __dirname` resolves to wherever this file lives, so the same
 * config works on any host (Mac mini, Lightsail, VPS, etc.).
 *
 * ── Timezone ────────────────────────────────────────────────────────────
 * `cron_restart` is evaluated by the PM2 *daemon*, in the daemon's local
 * timezone — an app-level `TZ` does not move it. The production host — the
 * Tailscale node `atrn-vm-linux`, not a Mac mini — is on **Etc/UTC**,
 * verified with `timedatectl`, not assumed. So every `cron_restart` below
 * is written in **UTC** and each comment states the KST time it lands on.
 * KST is UTC+9, so a morning-KST job runs the previous evening in UTC
 * (06:00 KST = 21:00 UTC the day before).
 *
 * Deploying on a host whose PM2 daemon is not UTC requires either pinning
 * the daemon's TZ (systemd unit) or converting these expressions.
 *
 * History: the 2026-05-07 note here claimed the box was a KST Mac mini and
 * rewrote every schedule into KST wall-clock. The box was already UTC, so
 * that change moved the jobs 9 hours the wrong way — the daily brief
 * "08:30 KST" was firing at 17:30 KST. Corrected, this time against the
 * host's actual timezone.
 *
 * ── Why `interpreter: "none"` ───────────────────────────────────────────
 * pnpm writes `node_modules/.bin/tsx` as a POSIX `#!/bin/sh` cmd-shim on
 * Linux. PM2 picks its interpreter from the file extension; `.bin/tsx` has
 * none, so PM2 defaults to `node` and its fork container `require()`s the
 * shim → `SyntaxError: basedir=$(dirname …)` and every cron app lands in
 * `errored`. `interpreter: "none"` makes PM2 exec the file directly, which
 * works for both pnpm's shell shim and npm's `#!/usr/bin/env node` symlink.
 *
 * The cron children also get `TZ: "Asia/Seoul"`: the scripts are written to
 * be TZ-independent (explicit UTC+9 math or `timeZone: "Asia/Seoul"`), and
 * this keeps any future `new Date()` formatting on Korean market days.
 */
const ROOT = __dirname;

/** One tsx cron app. `cronRestart` is UTC; `note` states the KST intent. */
function cronApp({ name, script, cronRestart, note }) {
  return {
    name,
    cwd: ROOT,
    script: "./node_modules/.bin/tsx",
    args: script,
    // See header: pnpm's .bin/tsx is a shell shim, not JavaScript.
    interpreter: "none",
    cron_restart: cronRestart,
    autorestart: false,
    env: { NODE_ENV: "production", TZ: "Asia/Seoul" },
    // Not used by PM2 — kept so `pm2 describe` output carries the intent.
    _kst: note,
  };
}

module.exports = {
  apps: [
    {
      name: "alpha-web",
      cwd: ROOT,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 6900",
      env: {
        NODE_ENV: "production",
        PORT: "6900",
        NEXT_PUBLIC_BASE_URL: "https://alpha.moss.land",
      },
      max_memory_restart: "768M",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
    },

    cronApp({
      name: "alpha-indexnow-cron",
      script: "scripts/indexnow-cron.ts",
      cronRestart: "0 19 * * 0",
      note: "매주 월요일 04:00 KST — IndexNow weekly ping",
    }),
    cronApp({
      name: "alpha-macro-cron",
      script: "scripts/fetch-macro.ts",
      cronRestart: "0 21 * * *",
      note: "매일 06:00 KST — Macro 데이터 fetch",
    }),
    cronApp({
      name: "alpha-synthesis-cron",
      script: "scripts/generate-synthesis.ts top --limit=30",
      cronRestart: "0 22 * * *",
      note: "매일 07:00 KST — top 30 entity synthesis",
    }),
    cronApp({
      name: "alpha-seed-qa-cron",
      script: "scripts/seed-qa-dynamic.ts --limit=20",
      cronRestart: "15 22 * * *",
      note: "매일 07:15 KST — ~20 new /ask/q/[hash] pages, idempotent, ~$0.005/run",
    }),
    cronApp({
      name: "alpha-connections-cron",
      script: "scripts/generate-connections.ts top --limit=80",
      // Staggered 15 min after seed QA so two Grok+SQLite jobs do not overlap.
      cronRestart: "30 22 * * *",
      note: "매일 07:30 KST — top 80 co-mention pair 인과 가설",
    }),
    cronApp({
      name: "alpha-brief-cron",
      script: "scripts/generate-brief.ts",
      cronRestart: "30 23 * * *",
      note: "매일 08:30 KST — 어제(KST) daily brief",
    }),
    cronApp({
      name: "alpha-translate-briefs-cron",
      script: "scripts/translate-briefs.ts --days=14",
      cronRestart: "40 23 * * *",
      note: "매일 08:40 KST — English brief 번역 (source-hash 캐시)",
    }),
    cronApp({
      // --limit is the script's own default; stated explicitly so a future
      // default change cannot silently unleash the whole backlog of Grok
      // calls in one unattended run.
      name: "alpha-why-moved-cron",
      script: "scripts/generate-why-moved.ts --limit=20",
      cronRestart: "45 23 * * *",
      note: "매일 08:45 KST — pulse → why-moved article",
    }),
    cronApp({
      // topic/event canonical IDs are paused pending SignalMap repairs.
      name: "alpha-persona-cron",
      script: "scripts/persona-tick.ts --pages=10 --types=entity,asset",
      cronRestart: "0 0 * * *",
      note: "매일 09:00 KST — 페르소나 발화 10건 (daily cap resets at KST midnight)",
    }),
    cronApp({
      name: "alpha-persona-reply-cron",
      script: "scripts/persona-replies.ts --max=8",
      cronRestart: "0 3 * * *",
      note: "매일 12:00 KST — 페르소나 답글 8건",
    }),
    cronApp({
      // Calls are created transactionally with each persona post. Spot-price
      // backfill cannot reconstruct an intraday reference price, so the
      // production cron only resolves calls that already exist.
      name: "alpha-calls-cron",
      script: "scripts/track-calls.ts --skip-backfill",
      cronRestart: "0 4 * * *",
      note: "매일 13:00 KST — call backfill + pending resolve",
    }),
    cronApp({
      // PM2 runs a job once when it is first registered; --scheduled makes
      // that first run free unless it really is Monday 11:xx KST, so a
      // redeploy cannot burn 30 gpt-4o web_search queries.
      name: "alpha-audit-cron",
      script: "scripts/audit-auto.ts --scheduled",
      cronRestart: "0 2 * * 1",
      note: "매주 월요일 11:00 KST — LLM citation audit (30 query × gpt-4o web_search)",
    }),
  ],
};
