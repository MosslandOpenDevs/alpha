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

async function main() {
  const args = process.argv.slice(2);
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
      console.error(`  ${d}: FAIL — ${(err as Error).message}`);
    }
  }
  console.log(
    `\nDone. Translated ${success}, cached ${cached}, skipped ${skipped}. Cost: $${totalCost.toFixed(4)}`
  );

  const { recordHeartbeat } = await import("../lib/cron-heartbeat");
  recordHeartbeat(
    "alpha-translate-briefs-cron",
    success + cached > 0 ? "ok" : "noop",
    `success=${success} cached=${cached} skipped=${skipped}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
