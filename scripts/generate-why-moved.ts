/**
 * Why-moved article 일괄 생성기.
 *
 * 사용법:
 *   pnpm tsx scripts/generate-why-moved.ts                          # 자동: 미생성 + 최근 stale 최대 20개
 *   pnpm tsx scripts/generate-why-moved.ts --limit=50               # 무인 실행 상한 재지정
 *   pnpm tsx scripts/generate-why-moved.ts --dry-run                # KST 캐시 정합성 점검 (쓰기 없음)
 *   pnpm tsx scripts/generate-why-moved.ts --stale-only             # 명시적으로 stale 캐시 전부 재생성 (운영자)
 *   pnpm tsx scripts/generate-why-moved.ts btc 2026-05-04            # 특정
 *
 * pm2 cron: 매일 23:45 UTC = 다음날 08:45 KST.
 *
 * 자동 모드 정책:
 *   - missing  : 기사 없음 → 생성. 아직 안 끝난 KST 당일도 포함한다 (아침 cron이
 *                밤사이 움직임을 "오늘" 기사로 먼저 낸다).
 *   - stale    : 기사는 있으나 pulse 집합이 바뀜. 최근 AUTO_REFRESH_DAYS일 이내면
 *                자동 재생성 (당일 부분 기사가 다음날 완성됨). 그보다 오래된 stale은
 *                운영자가 --stale-only 로만 처리 — 과거 기사 대량 재작성 방지.
 *   - relocated: pulse 가 다른 날짜 키 아래 저장돼 있음 → 감사된 KST repair 전용.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_AUTOMATIC_LIMIT = 20;
/** Stale articles this many KST days old (or newer) are refreshed by the
 *  automatic run; older stale rows are an explicit operator action. Wide
 *  enough to survive a couple of missed cron runs. */
const AUTO_REFRESH_DAYS = 3;

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

type ParsedArgs = {
  positional: string[];
  limit: number;
  dryRun: boolean;
  staleOnly: boolean;
  /** Unattended pm2 invocation: no positional args, not dry-run/stale-only. */
  automatic: boolean;
};

class UsageError extends Error {}

/** Thrown when an automatic run finished but not every selected combo
 *  succeeded; `summary` carries the counters into the error heartbeat. */
class RunIncompleteError extends Error {
  constructor(
    message: string,
    readonly summary: string
  ) {
    super(message);
  }
}

function parseArgs(args: string[]): ParsedArgs {
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
    throw new UsageError(`Unknown option: ${unknownFlags.join(", ")}`);
  }

  const limit = limitFlag
    ? Number(limitFlag.slice("--limit=".length))
    : dryRun
      ? Number.POSITIVE_INFINITY
      : DEFAULT_AUTOMATIC_LIMIT;
  if (limitFlag && (!Number.isInteger(limit) || limit < 1)) {
    throw new UsageError("--limit must be a positive integer");
  }

  if (positional.length === 2) {
    if (dryRun || staleOnly || limitFlag) {
      throw new UsageError(
        "--dry-run, --stale-only and --limit are only available in automatic mode"
      );
    }
  } else if (positional.length > 0) {
    throw new UsageError(
      "Expected either <asset> <YYYY-MM-DD> or --limit=<count>"
    );
  }

  return {
    positional,
    limit,
    dryRun,
    staleOnly,
    automatic: positional.length === 0 && !dryRun && !staleOnly,
  };
}

async function main(parsed: ParsedArgs) {
  const { positional, limit, dryRun, staleOnly } = parsed;

  const {
    generateWhyMoved,
    getWhyMoved,
    kstDateForTimestamp,
    kstDayBounds,
    listAllWhyMoved,
  } = await import("../lib/why-moved");
  const { formatPulseLoadDiagnostics, getAllPulses, getPulseLoadDiagnostics } =
    await import("../lib/mic");

  if (positional.length === 2) {
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

  // 자동: 모든 pulse의 unique (asset, KST date) 조합
  const pulses = getAllPulses();
  const diagnostics = getPulseLoadDiagnostics();
  if (diagnostics.invalidFiles.length || diagnostics.duplicateIds.length) {
    throw new Error(
      `Pulse input integrity check failed: ${formatPulseLoadDiagnostics(diagnostics)}`
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
  for (const p of pulses) {
    // getAllPulses() already rejects pulses without a parseable detectedAt.
    const date = kstDateForTimestamp(p.detectedAt);
    if (!date) continue;
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

  const now = Date.now();
  const refreshFloor = kstDateForTimestamp(
    new Date(now - AUTO_REFRESH_DAYS * 24 * 3600_000).toISOString()
  );
  if (!refreshFloor) throw new Error("Cannot determine current KST date");
  const isOpenDay = (date: string) => kstDayBounds(date).end > now;

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
    /** stale rows inside the AUTO_REFRESH_DAYS window are auto-eligible */
    autoRefresh: boolean;
  };
  const pending = orderedCombos.flatMap<PendingCombo>((combo) => {
    const article = getWhyMoved(combo.asset, combo.date);
    if (!article) {
      const reason = combo.pulseIds.some((id) => storedPulseIds.has(id))
        ? "relocated"
        : "missing";
      return [{ ...combo, reason, autoRefresh: false }];
    }
    if (!samePulseIds(article.pulses, combo.pulseIds)) {
      return [
        {
          ...combo,
          reason: "stale" as const,
          autoRefresh: combo.date >= refreshFloor,
        },
      ];
    }
    return [];
  });
  const staleEntries = pending.filter((combo) => combo.reason === "stale");
  const staleRecent = staleEntries.filter((combo) => combo.autoRefresh);
  const relocatedEntries = pending.filter(
    (combo) => combo.reason === "relocated"
  );
  const missingEntries = pending.filter((combo) => combo.reason === "missing");
  // Automatic: missing (incl. the still-open KST day) + recently stale, in
  // date-desc order so today/yesterday win the run cap over the backlog.
  const eligible = staleOnly
    ? staleEntries
    : pending.filter(
        (combo) => combo.reason === "missing" || combo.autoRefresh
      );
  const candidates = dryRun && !staleOnly ? pending : eligible;
  const selected = candidates.slice(0, limit);
  const cached = combos.size - pending.length;
  const stale = staleEntries.length;
  const relocated = relocatedEntries.length;
  const missing = missingEntries.length;

  console.log(`Pulse asset×KST-date combos: ${combos.size}`);
  console.log(
    `Pending: ${pending.length} (missing ${missing}, stale ${stale} [auto-refresh ${staleRecent.length}, floor ${refreshFloor}], relocated ${relocated}); run cap: ${Number.isFinite(limit) ? limit : "unlimited"}`
  );
  if (staleOnly) console.log(`Eligible stale entries: ${eligible.length}`);
  else if (!dryRun) console.log(`Eligible entries: ${eligible.length}`);

  if (dryRun) {
    for (const combo of selected) {
      const tags = [
        combo.reason.toUpperCase(),
        combo.reason === "stale" && combo.autoRefresh ? "auto-refresh" : "",
        isOpenDay(combo.date) ? "open-day" : "",
      ]
        .filter(Boolean)
        .join(" ");
      console.log(
        `  ${tags} ${combo.asset} × ${combo.date} (${combo.pulseIds.length} pulses)`
      );
    }
    return;
  }

  let created = 0;
  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const { asset, date, pulseIds, reason } of selected) {
    process.stdout.write(
      `  ${asset} × ${date}${reason === "stale" ? " (refresh)" : ""}${isOpenDay(date) ? " (open day)" : ""} ... `
    );
    try {
      const article = await generateWhyMoved(asset, date, {
        expectedPulseIds: pulseIds,
      });
      if (article && samePulseIds(article.pulses, pulseIds)) {
        if (reason === "stale") refreshed++;
        else created++;
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

  const done = created + refreshed;
  const remaining = eligible.length - done;
  const summary =
    `created=${created} refreshed=${refreshed} cached=${cached} ` +
    `stale_detected=${stale} stale_auto=${staleRecent.length} relocated_detected=${relocated} ` +
    `skipped=${skipped} failed=${failed} remaining=${remaining}`;
  console.log(
    `\nDone. Created ${created}, refreshed ${refreshed}, cached ${cached}, skipped ${skipped}, failed ${failed}, remaining ${remaining}.`
  );

  if (failed + skipped > 0) {
    throw new RunIncompleteError(
      `Why-moved run incomplete: failed=${failed} skipped=${skipped}`,
      summary
    );
  }

  if (parsed.automatic) {
    // Successful automatic attempts overwrite any prior error heartbeat.
    const { recordHeartbeat } = await import("../lib/cron-heartbeat");
    recordHeartbeat("alpha-why-moved-cron", done > 0 ? "ok" : "noop", summary);
  }
}

let parsedArgs: ParsedArgs;
try {
  parsedArgs = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

main(parsedArgs).catch(async (err) => {
  if (parsedArgs.automatic) {
    // Fail closed: any incomplete unattended run is surfaced on /health.
    // Usage errors never reach here (exit 2 above), so operator typos do
    // not flip the subsystem status.
    try {
      const { recordHeartbeat } = await import("../lib/cron-heartbeat");
      const note =
        err instanceof RunIncompleteError
          ? `${err.message}; ${err.summary}`
          : `automatic run exited non-zero: ${(err as Error).message ?? String(err)}`.slice(
              0,
              500
            );
      recordHeartbeat("alpha-why-moved-cron", "error", note);
    } catch (heartbeatError) {
      console.error("Failed to record error heartbeat:", heartbeatError);
    }
  }
  console.error(err);
  process.exit(1);
});
