/**
 * Daily brief 자동 생성기.
 *
 * 사용법:
 *   pnpm tsx scripts/generate-brief.ts                 # 어제 날짜
 *   pnpm tsx scripts/generate-brief.ts 2026-05-04      # 특정 날짜
 *   pnpm tsx scripts/generate-brief.ts backfill 7      # 지난 7일 backfill
 *
 * pm2 cron: 매일 23:00 UTC = 다음날 08:00 KST.
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

function dateAdd(date: string, days: number): string {
  const t = Date.parse(date + "T00:00:00Z") + days * 24 * 3600_000;
  return new Date(t).toISOString().slice(0, 10);
}

function yesterday(): string {
  const t = Date.now() - 24 * 3600_000;
  return new Date(t).toISOString().slice(0, 10);
}

async function main() {
  const { generateBriefSummary } = await import("../lib/brief");
  const args = process.argv.slice(2);

  if (args[0] === "backfill") {
    const days = Number(args[1] ?? "7");
    let totalCost = 0;
    let success = 0;
    for (let i = 1; i <= days; i++) {
      const d = dateAdd(yesterday(), -(i - 1));
      process.stdout.write(`  ${d} ... `);
      try {
        const r = await generateBriefSummary(d);
        totalCost += r.costUsd;
        success++;
        process.stdout.write(`OK ${r.cacheHit ? "[CACHE]" : `[${r.costUsd.toFixed(4)}$]`}\n`);
      } catch (err) {
        process.stdout.write(`SKIP: ${(err as Error).message}\n`);
      }
    }
    console.log(`\nDone. Cost: $${totalCost.toFixed(4)} · success: ${success}/${days}`);
  } else {
    const date = args[0] || yesterday();
    process.stdout.write(`${date} ... `);
    try {
      const r = await generateBriefSummary(date);
      process.stdout.write(`OK ${r.cacheHit ? "[CACHE]" : `[${r.costUsd.toFixed(4)}$]`}\n`);
      console.log("oneLine:", r.summary.oneLine);
      console.log("points:", r.summary.points.join(" / "));
    } catch (err) {
      console.error("FAIL:", (err as Error).message);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
