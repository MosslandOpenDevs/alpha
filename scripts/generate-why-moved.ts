/**
 * Why-moved article 일괄 생성기.
 *
 * 사용법:
 *   pnpm tsx scripts/generate-why-moved.ts                          # 최근 미생성 조합 최대 20개
 *   pnpm tsx scripts/generate-why-moved.ts --limit=50               # 무인 실행 상한 재지정
 *   pnpm tsx scripts/generate-why-moved.ts --dry-run                # KST 캐시 정합성 점검
 *   pnpm tsx scripts/generate-why-moved.ts --stale-only             # 명시적으로 stale 캐시만 재생성
 *   pnpm tsx scripts/generate-why-moved.ts btc 2026-05-04            # 특정
 *
 * pm2 cron: 매일 23:45 UTC = 다음날 08:45 KST.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_AUTOMATIC_LIMIT = 20;

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
  const limitFlag = args.find((arg) => arg.startsWith("--limit="));
  const dryRun = args.includes("--dry-run");
  const staleOnly = args.includes("--stale-only");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const unknownFlags = args.filter(
    (arg) =>
      arg.startsWith("--") &&
      !arg.startsWith("--limit=") &&
      arg !== "--dry-run" &&
      arg !== "--stale-only"
  );

  if (unknownFlags.length > 0) {
    throw new Error(`Unknown option: ${unknownFlags.join(", ")}`);
  }

  const limit = limitFlag
    ? Number(limitFlag.slice("--limit=".length))
    : dryRun
      ? Number.POSITIVE_INFINITY
      : DEFAULT_AUTOMATIC_LIMIT;
  if (limitFlag && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  const {
    generateWhyMoved,
    getWhyMoved,
    kstDateForTimestamp,
    listAllWhyMoved,
  } = await import("../lib/why-moved");
  const { getAllPulses, getPulseLoadDiagnostics } = await import("../lib/mic");

  if (positional.length === 2) {
    if (dryRun || staleOnly) {
      throw new Error(
        "--dry-run and --stale-only are only available in automatic mode"
      );
    }
    // 특정 자산·날짜
    const [asset, date] = positional;
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
      throw err;
    }
    return;
  }

  if (positional.length > 0) {
    throw new Error("Expected either <asset> <YYYY-MM-DD> or --limit=<count>");
  }

  // 자동: 모든 pulse의 unique (asset, date) 조합
  const pulses = getAllPulses();
  const diagnostics = getPulseLoadDiagnostics();
  if (diagnostics.invalidFiles.length || diagnostics.duplicateIds.length) {
    throw new Error(
      `Pulse input integrity check failed: invalid_files=${diagnostics.invalidFiles.length} duplicate_ids=${diagnostics.duplicateIds.length}`
    );
  }
  console.log(`Total pulses loaded: ${pulses.length}`);
  if (pulses.length === 0) {
    throw new Error("No pulses found. Check MIC_DATA_PATH or signalmap output.");
  }
  const combos = new Map<
    string,
    { asset: string; date: string; pulseIds: string[] }
  >();
  let invalidPulses = 0;
  for (const p of pulses) {
    if (!p.detectedAt || !p.asset) {
      invalidPulses++;
      continue;
    }
    const date = kstDateForTimestamp(p.detectedAt);
    if (!date) {
      invalidPulses++;
      continue;
    }
    const asset = p.asset.toLowerCase();
    const key = `${asset}|${date}`;
    const combo = combos.get(key);
    if (combo) combo.pulseIds.push(p.id);
    else combos.set(key, { asset, date, pulseIds: [p.id] });
  }

  const samePulseIds = (
    stored: { id: string }[],
    expectedIds: string[]
  ): boolean => {
    const actual = stored.map((pulse) => pulse.id).sort();
    const expected = [...expectedIds].sort();
    return (
      actual.length === expected.length &&
      actual.every((id, index) => id === expected[index])
    );
  };

  const orderedCombos = [...combos.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.asset.localeCompare(b.asset)
  );
  const storedPulseIds = new Set(
    listAllWhyMoved().flatMap((article) =>
      article.pulses.map((pulse) => pulse.id)
    )
  );
  type PendingCombo = (typeof orderedCombos)[number] & {
    reason: "missing" | "stale" | "relocated";
  };
  const pending = orderedCombos.flatMap<PendingCombo>((combo) => {
    const article = getWhyMoved(combo.asset, combo.date);
    if (!article) {
      const reason = combo.pulseIds.some((id) => storedPulseIds.has(id))
        ? "relocated"
        : "missing";
      return [{ ...combo, reason }];
    }
    if (!samePulseIds(article.pulses, combo.pulseIds)) {
      return [{ ...combo, reason: "stale" as const }];
    }
    return [];
  });
  const staleEntries = pending.filter((combo) => combo.reason === "stale");
  const relocatedEntries = pending.filter(
    (combo) => combo.reason === "relocated"
  );
  const missingEntries = pending.filter((combo) => combo.reason === "missing");
  const eligible = staleOnly ? staleEntries : missingEntries;
  const candidates = dryRun && !staleOnly ? pending : eligible;
  const selected = candidates.slice(0, limit);
  const cached = combos.size - pending.length;
  const stale = staleEntries.length;
  const relocated = relocatedEntries.length;
  const missing = missingEntries.length;

  console.log(
    `Pulse asset×KST-date combos: ${combos.size}; invalid pulses: ${invalidPulses}`
  );
  console.log(
    `Pending: ${pending.length} (missing ${missing}, stale ${stale}, relocated ${relocated}); run cap: ${Number.isFinite(limit) ? limit : "unlimited"}`
  );
  if (staleOnly) console.log(`Eligible stale entries: ${eligible.length}`);
  else if (!dryRun) console.log(`Eligible missing entries: ${eligible.length}`);

  if (dryRun) {
    for (const combo of selected) {
      console.log(
        `  ${combo.reason.toUpperCase()} ${combo.asset} × ${combo.date} (${combo.pulseIds.length} pulses)`
      );
    }
    return;
  }

  let total = 0;
  let skipped = 0;
  let failed = 0;

  for (const { asset, date, pulseIds } of selected) {
    process.stdout.write(`  ${asset} × ${date} ... `);
    try {
      const article = await generateWhyMoved(asset, date, {
        expectedPulseIds: pulseIds,
      });
      if (article && samePulseIds(article.pulses, pulseIds)) {
        total++;
        process.stdout.write(`OK [${article.pulses.length} pulses]\n`);
      } else if (article) {
        failed++;
        process.stdout.write("FAIL: generated pulse set mismatch\n");
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

  const remaining = eligible.length - total;
  console.log(
    `\nDone. Created ${total}, cached ${cached}, skipped ${skipped}, failed ${failed}, remaining ${remaining}.`
  );

  if (failed + skipped > 0) {
    throw new Error(
      `Why-moved run incomplete: failed=${failed} skipped=${skipped}`
    );
  }

  // Successful automatic attempts overwrite any prior error heartbeat.
  const { recordHeartbeat } = await import("../lib/cron-heartbeat");
  recordHeartbeat(
    "alpha-why-moved-cron",
    total > 0 ? "ok" : "noop",
    `created=${total} cached=${cached} stale_detected=${stale} relocated_detected=${relocated} skipped=0 failed=0 remaining=${remaining}`
  );
}

function shouldRecordAutomaticFailure(args: string[]): boolean {
  return (
    !args.includes("--dry-run") &&
    args.every(
      (arg) => arg === "--stale-only" || arg.startsWith("--limit=")
    )
  );
}

main().catch(async (err) => {
  if (shouldRecordAutomaticFailure(process.argv.slice(2))) {
    try {
      const { recordHeartbeat } = await import("../lib/cron-heartbeat");
      recordHeartbeat(
        "alpha-why-moved-cron",
        "error",
        "automatic run exited non-zero; see PM2 stderr"
      );
    } catch (heartbeatError) {
      console.error("Failed to record error heartbeat:", heartbeatError);
    }
  }
  console.error(err);
  process.exit(1);
});
