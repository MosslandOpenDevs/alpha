/**
 * KR macro 데이터 fetch — ECOS 4 series 갱신.
 *
 * 사용법:
 *   pnpm tsx scripts/fetch-macro-kr.ts
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
  const { fetchKrSeries, KR_MACRO_SERIES, ECOS_AVAILABLE } = await import("../lib/ecos");

  if (!ECOS_AVAILABLE) {
    console.error("ECOS_API_KEY not set.");
    process.exit(1);
  }

  console.log(`Fetching ${KR_MACRO_SERIES.length} KR series from ECOS...`);
  let total = 0;
  for (const s of KR_MACRO_SERIES) {
    process.stdout.write(`  ${s.id} (${s.label}) ... `);
    try {
      const rows = await fetchKrSeries(s);
      total += rows.length;
      const latest = rows[rows.length - 1];
      const first = rows[0];
      const newest =
        rows.length === 0
          ? null
          : Date.parse(latest?.date || "") > Date.parse(first?.date || "")
          ? latest
          : first;
      process.stdout.write(
        newest
          ? `OK [${rows.length} obs, latest ${newest.date}=${newest.value}${s.unit}]\n`
          : `OK [no data]\n`
      );
    } catch (err) {
      process.stdout.write(`FAIL: ${(err as Error).message}\n`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\nDone. Stored ${total} observations.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
