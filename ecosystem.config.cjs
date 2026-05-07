/**
 * PM2 ecosystem for Alpha (alpha.moss.land).
 *
 * `cwd: __dirname` resolves to wherever this file lives, so the same
 * config works on any host (Mac mini, Lightsail, VPS, etc.).
 *
 * Cron schedules are interpreted in the host's *local* timezone — on the
 * production Mac mini that's KST. Times below are written in KST and the
 * comments explicitly state so. (An earlier version assumed the schedules
 * were UTC and silently fired 9 hours early. Fixed 2026-05-07.)
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
      cron_restart: "0 4 * * 1",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Macro 데이터 daily fetch — 매일 06:00 KST
      name: "alpha-macro-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/fetch-macro.ts",
      cron_restart: "0 6 * * *",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Synthesis 자동 갱신 — 매일 07:00 KST (top 30 entity)
      name: "alpha-synthesis-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/generate-synthesis.ts top --limit=30",
      cron_restart: "0 7 * * *",
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
      cron_restart: "30 8 * * *",
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
      cron_restart: "0 9 * * *",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Persona 답글 — 매일 12:00 KST (페르소나끼리 8개 답글)
      name: "alpha-persona-reply-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/persona-replies.ts --max=8",
      cron_restart: "0 12 * * *",
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
      cron_restart: "0 13 * * *",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Why-moved — 매일 08:45 KST (brief 직후, pulse → article 자동 생성)
      name: "alpha-why-moved-cron",
      cwd: ROOT,
      script: "./node_modules/.bin/tsx",
      args: "scripts/generate-why-moved.ts",
      cron_restart: "45 8 * * *",
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
      cron_restart: "0 11 * * 1",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
  ],
};
