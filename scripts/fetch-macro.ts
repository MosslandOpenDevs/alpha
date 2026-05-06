/**
 * Macro 데이터 fetch cron — 매일 1회 FRED에서 핵심 series 갱신.
 *
 * 사용:
 *   pnpm tsx scripts/fetch-macro.ts                   # 전체 series 갱신
 *   pnpm tsx scripts/fetch-macro.ts DFF DGS10         # 특정 series만
 *
 * pm2 cron: 매일 06:00 KST = 21:00 UTC.
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
if (!process.env.DB_PATH) {
  process.env.DB_PATH = "<DB_PATH>";
}
process.env.NODE_ENV = process.env.NODE_ENV || "production";

async function main() {
  const { fetchSeriesLatest, MACRO_SERIES, FRED_AVAILABLE } = await import("../lib/fred");

  if (!FRED_AVAILABLE) {
    console.error("FRED_API_KEY not set.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const filter = args.length > 0 ? args : null;
  const targets = filter
    ? MACRO_SERIES.filter((s) => filter.includes(s.id))
    : MACRO_SERIES;

  console.log(`Fetching ${targets.length} series from FRED...`);
  let totalRows = 0;
  for (const s of targets) {
    process.stdout.write(`  ${s.id} (${s.label}) ... `);
    try {
      const rows = await fetchSeriesLatest(s.id, 60);
      totalRows += rows.length;
      const latest = rows[0];
      process.stdout.write(
        latest
          ? `OK [${rows.length} obs, latest ${latest.date}=${latest.value}${s.unit}]\n`
          : `OK [no data]\n`
      );
    } catch (err) {
      process.stdout.write(`FAIL: ${(err as Error).message}\n`);
    }
    // simple rate-limit safety: 0.5s between calls
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\nDone. Stored ${totalRows} observations.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
