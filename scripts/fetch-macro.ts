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
process.env.NODE_ENV = process.env.NODE_ENV || "production";

async function main() {
  const { fetchSeriesLatest, MACRO_SERIES, FRED_AVAILABLE } = await import("../lib/fred");
  const { fetchKrSeries, KR_MACRO_SERIES, ECOS_AVAILABLE } = await import("../lib/ecos");

  let totalRows = 0;

  if (FRED_AVAILABLE) {
    console.log(`Fetching ${MACRO_SERIES.length} series from FRED...`);
    for (const s of MACRO_SERIES) {
      process.stdout.write(`  FRED:${s.id} ... `);
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
      await new Promise((r) => setTimeout(r, 500));
    }
  } else {
    console.warn("FRED_API_KEY not set, skipping FRED.");
  }

  if (ECOS_AVAILABLE) {
    console.log(`\nFetching ${KR_MACRO_SERIES.length} series from ECOS...`);
    for (const s of KR_MACRO_SERIES) {
      process.stdout.write(`  ECOS:${s.id} ... `);
      try {
        const rows = await fetchKrSeries(s);
        totalRows += rows.length;
        process.stdout.write(`OK [${rows.length} obs]\n`);
      } catch (err) {
        process.stdout.write(`FAIL: ${(err as Error).message}\n`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } else {
    console.warn("ECOS_API_KEY not set, skipping ECOS.");
  }

  console.log(`\nDone. Stored ${totalRows} observations.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
