/**
 * PM2 entry for the alpha auto-deploy poller. Kept out of ecosystem.config.cjs
 * on purpose:
 *
 *   - Releases run `pm2 start ecosystem.config.cjs` to (re)register the 13
 *     app processes. If the poller were in that file, a deploy would
 *     `pm2 delete` and restart the very process it is executing in.
 *   - The poller must run from ~/alpha (the object-store checkout), which
 *     `git fetch` keeps on origin/main, so scripts/deploy.sh updates itself.
 *     A release directory is frozen at one commit.
 *
 * Register once, on the box:
 *
 *   cd ~/alpha && pm2 start ecosystem.deploy.config.cjs && pm2 save
 *
 * All DEPLOY_* knobs are documented at the top of scripts/deploy.sh.
 */
const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: "alpha-deploy",
      cwd: ROOT,
      // A long-lived loop, NOT cron_restart. pm2's cron_restart restarts the
      // process on schedule whether or not it is mid-run — SIGINT, then
      // SIGKILL 1.6s later — which would kill a deploy in the middle of
      // install/build/swap and, worse, skip bash's EXIT trap and strand the
      // lock. The loop sleeps between ticks instead, so a tick that runs long
      // simply delays the next one. Same 5-minute cadence, offset from the
      // other pollers on this box by starting the sleep at 2 past.
      script: "./scripts/deploy-loop.sh",
      interpreter: "bash",
      autorestart: true,
      // Never let pm2 kill this on memory: `next build` runs inside this
      // process's budget and a SIGKILL mid-build strands the lock and a
      // half-built worktree. 3G is well above what the build uses.
      max_memory_restart: "3G",
      kill_timeout: 15000,
      env: {
        NODE_ENV: "production",
        PORT: "6900",
        DEPLOY_INTERVAL_SEC: process.env.DEPLOY_INTERVAL_SEC || "300",
        DEPLOY_REQUIRE_CI: process.env.DEPLOY_REQUIRE_CI || "1",
        DEPLOY_ALERT_WEBHOOK: process.env.DEPLOY_ALERT_WEBHOOK || "",
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
      },
    },
  ],
};
