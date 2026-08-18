/**
 * Translate the last N Korean briefs to English.
 *
 * Run daily after the alpha-brief-cron (which produces fresh Korean
 * briefs at 08:30 KST). Translation is cached in alpha_brief_translations
 * so repeated runs are free.
 *
 * Usage:
 *   pnpm tsx scripts/translate-briefs.ts            # last 14 days
 *   pnpm tsx scripts/translate-briefs.ts 2026-05-10 # one date
 *   pnpm tsx scripts/translate-briefs.ts --days=30  # custom window
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));
process.env.NODE_ENV = process.env.NODE_ENV || "production";

function parseFlag(args: string[], name: string): string | undefined {
  const flag = `--${name}=`;
  for (const a of args) if (a.startsWith(flag)) return a.slice(flag.length);
  return undefined;
}

const KST_OFFSET_MS = 9 * 3600_000;
function todayKst(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
function dateAdd(date: string, days: number): string {
  const t = Date.parse(date + "T00:00:00Z") + days * 24 * 3600_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Intended KST hour of the pm2 cron (08:40 KST = 23:40 UTC). */
const SCHEDULED_KST_HOUR = 8;

/** True when this run is the unattended cron, i.e. the one that owns the
 *  heartbeat. An operator translating a single date by hand must not be able
 *  to stamp the scheduled run's status — success or failure. */
function isCronRun(args: string[]): boolean {
  return !args.some((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
}

async function main() {
  const args = process.argv.slice(2);

  // A redeploy re-registers every pm2 app, which would re-run this off-schedule
  // and overwrite the heartbeat with the deploy time.
  const { scheduledSkipReason } = await import("../lib/kst");
  const skip = scheduledSkipReason(args, SCHEDULED_KST_HOUR);
  if (skip) {
    console.log(skip);
    return;
  }

  const { generateBriefEn } = await import("../lib/brief-translate");

  // Single date mode
  const single = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (single) {
    const r = await generateBriefEn(single);
    if (!r) {
      console.log(`${single}: no source Korean brief — skipped`);
      return;
    }
    console.log(
      `${single}: ${r.cacheHit ? "[CACHE]" : `[$${r.costUsd.toFixed(4)}]`} ${r.en.oneLine.slice(0, 80)}`
    );
    return;
  }

  // Window mode (default 14)
  const days = Number(parseFlag(args, "days") ?? "14");
  let success = 0;
  let cached = 0;
  let skipped = 0;
  let failed = 0;
  let totalCost = 0;
  for (let i = 0; i < days; i++) {
    const d = dateAdd(todayKst(), -i);
    try {
      const r = await generateBriefEn(d);
      if (!r) {
        skipped++;
        continue;
      }
      totalCost += r.costUsd;
      if (r.cacheHit) cached++;
      else success++;
      process.stdout.write(
        `  ${d}: ${r.cacheHit ? "[CACHE]" : `[$${r.costUsd.toFixed(4)}]`} ${r.en.oneLine.slice(0, 80)}\n`
      );
    } catch (err) {
      // Counted, not just logged: every day failing used to still grade
      // "noop", i.e. indistinguishable from a genuinely quiet window.
      failed++;
      console.error(`  ${d}: FAIL — ${(err as Error).message}`);
    }
  }
  console.log(
    `\nDone. Translated ${success}, cached ${cached}, skipped ${skipped}, failed ${failed}. Cost: $${totalCost.toFixed(4)}`
  );

  const produced = success + cached;
  const summary = `success=${success} cached=${cached} skipped=${skipped} failed=${failed}`;
  // Same grading rule as the other crons: `error` means nothing got through,
  // partial failure is still a working run. `noop` is a genuinely empty window
  // (no Korean brief to translate yet).
  const status = failed > 0 && produced === 0 ? "error" : produced > 0 ? "ok" : "noop";
  console.log(`Heartbeat: ${status} — ${summary}`);

  const { recordHeartbeat } = await import("../lib/cron-heartbeat");
  recordHeartbeat("alpha-translate-briefs-cron", status, summary);
}

main().catch(async (err) => {
  // Fail closed, like the other crons — a crash must not leave the previous
  // "ok" heartbeat standing. Only for the cron path: a hand-run single date
  // that throws should not redden the subsystem.
  if (!isCronRun(process.argv.slice(2))) {
    console.error(err);
    process.exit(1);
  }
  try {
    const { recordHeartbeat } = await import("../lib/cron-heartbeat");
    recordHeartbeat(
      "alpha-translate-briefs-cron",
      "error",
      `run exited non-zero: ${(err as Error)?.message ?? String(err)}`.slice(0, 500)
    );
  } catch (heartbeatError) {
    console.error("Failed to record error heartbeat:", heartbeatError);
  }
  console.error(err);
  process.exit(1);
});
