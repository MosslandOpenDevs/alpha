/**
 * PM2 ecosystem for Alpha (alpha.moss.land).
 *
 * `cwd: __dirname` resolves to wherever this file lives, so the same
 * config works on any host (Mac mini, Lightsail, VPS, etc.).
 *
 * Cron schedules are interpreted in the host's *local* timezone, and the
 * production host — a Linux VM, not a Mac mini — is on **Etc/UTC**.
 * Verified with `timedatectl`, not assumed.
 *
 * So every `cron_restart` below is written in **UTC**, and the comment on
 * each app states the KST time it is meant to land on. KST is UTC+9, so a
 * morning-KST job runs the previous evening in UTC (06:00 KST = 21:00 UTC
 * the day before).
 *
 * History: the 2026-05-07 note here claimed the box was a KST Mac mini and
 * rewrote every schedule into KST wall-clock. The box was already UTC, so
 * that change moved the jobs 9 hours the wrong way — the daily brief
 * "08:30 KST" was firing at 17:30 KST. Corrected, this time against the
 * host's actual timezone.
 */
const ROOT = __dirname;

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
    {
      // IndexNow weekly ping — every Monday 04:00 KST
      name: "alpha-indexnow-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/indexnow-cron.ts",
      cron_restart: "0 19 * * 0", // UTC = 04:00 KST 익일
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Macro 데이터 daily fetch — 매일 06:00 KST
      name: "alpha-macro-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/fetch-macro.ts",
      cron_restart: "0 21 * * *", // UTC = 06:00 KST 익일
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Synthesis 자동 갱신 — 매일 07:00 KST (top 30 entity)
      name: "alpha-synthesis-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/generate-synthesis.ts top --limit=30",
      cron_restart: "0 22 * * *", // UTC = 07:00 KST 익일
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Dynamic Q&A seeding — 매일 07:15 KST.
      // Generates ~20 new /ask/q/[hash] pages per day from top
      // topics/events/entities. Idempotent (skips cached). ~$0.005/run.
      name: "alpha-seed-qa-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/seed-qa-dynamic.ts --limit=20",
      cron_restart: "15 22 * * *", // UTC = 07:15 KST 익일
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Daily brief — 매일 08:30 KST. Generates yesterday-in-KST (the day
      // that just ended). yesterday() in the script is KST-aware.
      name: "alpha-brief-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/generate-brief.ts",
      cron_restart: "30 23 * * *", // UTC = 08:30 KST 익일
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // English brief 번역 — 매일 08:40 KST (Korean brief 10분 후).
      // Daily Korean brief 직후 영문 자동 번역. Cached by source-hash.
      name: "alpha-translate-briefs-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/translate-briefs.ts --days=14",
      cron_restart: "40 23 * * *", // UTC = 08:40 KST 익일
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Persona 일일 tick — 매일 09:00 KST (페르소나 발화 10건). Daily cap
      // resets at KST midnight (lib/persona-post todayPostCount uses KST).
      name: "alpha-persona-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/persona-tick.ts --pages=10",
      cron_restart: "0 0 * * *", // UTC = 09:00 KST
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Persona 답글 — 매일 12:00 KST (페르소나끼리 8개 답글)
      name: "alpha-persona-reply-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/persona-replies.ts --max=8",
      cron_restart: "0 3 * * *", // UTC = 12:00 KST
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Trackable calls — 매일 13:00 KST.
      // 1) 신규 asset post에 call 레코드 backfill
      // 2) target_date 도달한 pending call 자동 resolve
      name: "alpha-calls-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/track-calls.ts",
      cron_restart: "0 4 * * *", // UTC = 13:00 KST
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Why-moved — 매일 08:45 KST (brief 직후, pulse → article 자동 생성)
      name: "alpha-why-moved-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/generate-why-moved.ts",
      cron_restart: "45 23 * * *", // UTC = 08:45 KST 익일
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Connection 가설 자동 갱신 — 매일 07:15 KST (synthesis 직후)
      // top 80 co-mention pair 의 인과 가설 1줄 생성.
      name: "alpha-connections-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/generate-connections.ts top --limit=80",
      cron_restart: "15 22 * * *", // UTC = 07:15 KST 익일
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // LLM citation audit 주간 측정 — 매주 월요일 11:00 KST
      // OpenAI gpt-4o web_search 로 30 query × alpha 인용 여부 체크.
      // 결과: docs/audit-results/[YYYY-MM-DD]-auto.json
      name: "alpha-audit-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/audit-auto.ts",
      cron_restart: "0 2 * * 1", // UTC = 11:00 KST
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
  ],
};
