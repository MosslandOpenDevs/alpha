/**
 * PM2 ecosystem for Alpha (alpha.moss.land).
 *
 * Pattern matches `media-kr` and `comply` (project_deployment_manifest.md).
 * Tailscale routing — nginx on Lightsail proxies via <LOCAL_TAILSCALE_IP>:6900.
 */
module.exports = {
  apps: [
    {
      name: "alpha-web",
      cwd: "<PROJECT_ROOT>",
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
      // IndexNow weekly ping — 매주 월요일 04:00 KST = 일요일 19:00 UTC
      name: "alpha-indexnow-cron",
      cwd: "<PROJECT_ROOT>",
      script: "./node_modules/.bin/tsx",
      args: "scripts/indexnow-cron.ts",
      cron_restart: "0 19 * * 0",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Macro 데이터 daily fetch — 매일 06:00 KST = 21:00 UTC
      name: "alpha-macro-cron",
      cwd: "<PROJECT_ROOT>",
      script: "./node_modules/.bin/tsx",
      args: "scripts/fetch-macro.ts",
      cron_restart: "0 21 * * *",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Synthesis 자동 갱신 — 매일 07:00 KST = 22:00 UTC (top 30 entity)
      name: "alpha-synthesis-cron",
      cwd: "<PROJECT_ROOT>",
      script: "./node_modules/.bin/tsx",
      args: "scripts/generate-synthesis.ts top --limit=30",
      cron_restart: "0 22 * * *",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Daily brief AI 요약 — 매일 08:30 KST = 23:30 UTC (어제 자료 정리)
      name: "alpha-brief-cron",
      cwd: "<PROJECT_ROOT>",
      script: "./node_modules/.bin/tsx",
      args: "scripts/generate-brief.ts",
      cron_restart: "30 23 * * *",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
    {
      // Persona 일일 tick — 매일 09:00 KST = 00:00 UTC (페르소나 발화 10건)
      name: "alpha-persona-cron",
      cwd: "<PROJECT_ROOT>",
      script: "./node_modules/.bin/tsx",
      args: "scripts/persona-tick.ts --pages=10",
      cron_restart: "0 0 * * *",
      autorestart: false,
      env: { NODE_ENV: "production" },
    },
  ],
};
