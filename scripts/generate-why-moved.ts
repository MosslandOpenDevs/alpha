/**
 * Why-moved article 일괄 생성기.
 *
 * 사용법:
 *   pnpm tsx scripts/generate-why-moved.ts                          # 모든 pulse asset×date 자동
 *   pnpm tsx scripts/generate-why-moved.ts btc 2026-05-04            # 특정
 *
 * pm2 cron: 매일 23:45 UTC = 다음날 08:45 KST.
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
  const args = process.argv.slice(2);
  const { generateWhyMoved, getWhyMoved } = await import("../lib/why-moved");
  const { getAllPulses } = await import("../lib/mic");

  if (args.length === 2) {
    // 특정 자산·날짜
    const [asset, date] = args;
    process.stdout.write(`${asset.toLowerCase()} × ${date} ... `);
    try {
      const article = await generateWhyMoved(asset, date);
      if (article) {
        process.stdout.write(`OK — ${article.title}\n`);
      } else {
        process.stdout.write(`SKIP: pulse 없음\n`);
      }
    } catch (err) {
      process.stdout.write(`FAIL: ${(err as Error).message}\n`);
    }
    return;
  }

  // 자동: 모든 pulse의 unique (asset, date) 조합
  const pulses = getAllPulses();
  console.log(`Total pulses loaded: ${pulses.length}`);
  if (pulses.length === 0) {
    console.warn("No pulses found. Check MIC_DATA_PATH or signalmap output.");
    return;
  }
  const combos = new Map<string, { asset: string; date: string }>();
  for (const p of pulses) {
    if (!p.detectedAt || !p.asset) continue;
    const date = p.detectedAt.slice(0, 10);
    const asset = p.asset.toLowerCase();
    const key = `${asset}|${date}`;
    if (!combos.has(key)) combos.set(key, { asset, date });
  }

  console.log(`Pulse asset×date combos: ${combos.size}`);
  let total = 0;
  let cached = 0;
  let skipped = 0;
  let failed = 0;

  for (const { asset, date } of combos.values()) {
    if (getWhyMoved(asset, date)) {
      cached++;
      continue;
    }
    process.stdout.write(`  ${asset} × ${date} ... `);
    try {
      const article = await generateWhyMoved(asset, date);
      if (article) {
        total++;
        process.stdout.write(`OK [${article.pulses.length} pulses]\n`);
      } else {
        skipped++;
        process.stdout.write(`SKIP\n`);
      }
    } catch (err) {
      failed++;
      process.stdout.write(`FAIL: ${(err as Error).message}\n`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(
    `\nDone. Created ${total}, cached ${cached}, skipped ${skipped}, failed ${failed}.`
  );

  // Heartbeat — record that this cron ran successfully even if no new
  // articles were created (event-driven; quiet days are valid).
  const { recordHeartbeat } = await import("../lib/cron-heartbeat");
  recordHeartbeat(
    "alpha-why-moved-cron",
    total > 0 ? "ok" : "noop",
    `created=${total} cached=${cached} skipped=${skipped} failed=${failed}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
